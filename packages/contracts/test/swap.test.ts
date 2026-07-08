import { expect } from "chai";
import { ethers } from "hardhat";

const MAX_UINT = ethers.MaxUint256;

async function deployDexFixture() {
  const [owner, trader] = await ethers.getSigners();

  const WXP = await ethers.getContractFactory("WXP");
  const wxp = (await WXP.deploy()) as any;
  await wxp.waitForDeployment();

  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = (await Factory.deploy(owner.address)) as any;
  await factory.waitForDeployment();

  const Router = await ethers.getContractFactory("XphereV2Router02");
  const router = (await Router.deploy(await factory.getAddress(), await wxp.getAddress())) as any;
  await router.waitForDeployment();

  const Token = await ethers.getContractFactory("MintableERC20");
  const xusdc = (await Token.deploy("Xphere Bridged USDC", "xUSDC", 6, owner.address)) as any;
  await xusdc.waitForDeployment();

  const USDT = await ethers.getContractFactory("NonStandardUSDTMock");
  const xusdt = (await USDT.deploy()) as any;
  await xusdt.waitForDeployment();

  await xusdc.mint(owner.address, ethers.parseUnits("100000", 6));
  await xusdc.mint(trader.address, ethers.parseUnits("1000", 6));
  await xusdt.mint(owner.address, ethers.parseUnits("100000", 6));
  await xusdt.mint(trader.address, ethers.parseUnits("1000", 6));

  await xusdc.approve(await router.getAddress(), MAX_UINT);
  await xusdt.approve(await router.getAddress(), MAX_UINT);
  await xusdc.connect(trader).approve(await router.getAddress(), MAX_UINT);
  await xusdt.connect(trader).approve(await router.getAddress(), MAX_UINT);

  return { owner, trader, wxp, factory, router, xusdc, xusdt };
}

async function deadline() {
  const block = await ethers.provider.getBlock("latest");
  return BigInt((block?.timestamp ?? 0) + 1200);
}

describe("Xphere V2 swap", function () {
  it("creates pools and adds bridged stable liquidity", async function () {
    const { owner, factory, router, xusdc, xusdt } = await deployDexFixture();

    await router.addLiquidity(
      await xusdc.getAddress(),
      await xusdt.getAddress(),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
    );

    const pair = await factory.getPair(await xusdc.getAddress(), await xusdt.getAddress());
    expect(pair).to.not.equal(ethers.ZeroAddress);
  });

  it("swaps exact input through router", async function () {
    const { owner, trader, router, xusdc, xusdt } = await deployDexFixture();

    await router.addLiquidity(
      await xusdc.getAddress(),
      await xusdt.getAddress(),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
    );

    const amountIn = ethers.parseUnits("100", 6);
    const path = [await xusdc.getAddress(), await xusdt.getAddress()];
    const amounts = await router.getAmountsOut(amountIn, path);

    await router
      .connect(trader)
      .swapExactTokensForTokens(
        amountIn,
        (amounts[1] * 995n) / 1000n,
        path,
        trader.address,
        await deadline(),
      );

    expect(await xusdt.balanceOf(trader.address)).to.be.gt(ethers.parseUnits("1000", 6));
  });

  it("wraps native XP through the router when swapping XP for a token", async function () {
    const { owner, trader, wxp, router, xusdc } = await deployDexFixture();

    await router.addLiquidityETH(
      await xusdc.getAddress(),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
      { value: ethers.parseEther("100") },
    );

    const amountIn = ethers.parseEther("1");
    const path = [await wxp.getAddress(), await xusdc.getAddress()];
    const amounts = await router.getAmountsOut(amountIn, path);
    const before = await xusdc.balanceOf(trader.address);

    await router
      .connect(trader)
      .swapExactETHForTokens((amounts[1] * 995n) / 1000n, path, trader.address, await deadline(), {
        value: amountIn,
      });

    expect(await xusdc.balanceOf(trader.address)).to.be.gt(before);
  });

  it("unwraps WXP through the router when swapping a token for XP", async function () {
    const { owner, trader, wxp, router, xusdc } = await deployDexFixture();

    await router.addLiquidityETH(
      await xusdc.getAddress(),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
      { value: ethers.parseEther("100") },
    );

    const amountIn = ethers.parseUnits("100", 6);
    const path = [await xusdc.getAddress(), await wxp.getAddress()];
    const amounts = await router.getAmountsOut(amountIn, path);
    const beforeToken = await xusdc.balanceOf(trader.address);
    const beforeNative = await ethers.provider.getBalance(trader.address);

    const tx = await router
      .connect(trader)
      .swapExactTokensForETH(amountIn, (amounts[1] * 995n) / 1000n, path, trader.address, await deadline());
    const receipt = await tx.wait();
    const gasCost = BigInt(receipt?.gasUsed ?? 0) * BigInt(receipt?.gasPrice ?? 0);

    expect(await xusdc.balanceOf(trader.address)).to.equal(beforeToken - amountIn);
    expect(await ethers.provider.getBalance(trader.address)).to.be.gt(beforeNative - gasCost);
  });

  it("removes native XP liquidity through the router", async function () {
    const { owner, wxp, factory, router, xusdc } = await deployDexFixture();

    await router.addLiquidityETH(
      await xusdc.getAddress(),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
      { value: ethers.parseEther("100") },
    );

    const pairAddress = await factory.getPair(await xusdc.getAddress(), await wxp.getAddress());
    const pair = await ethers.getContractAt("UniswapV2Pair", pairAddress);
    const liquidity = (await pair.balanceOf(owner.address)) / 2n;
    const beforeToken = await xusdc.balanceOf(owner.address);
    const beforeNative = await ethers.provider.getBalance(owner.address);

    await pair.approve(await router.getAddress(), liquidity);
    const tx = await router.removeLiquidityETH(
      await xusdc.getAddress(),
      liquidity,
      0,
      0,
      owner.address,
      await deadline(),
    );
    const receipt = await tx.wait();
    const gasCost = BigInt(receipt?.gasUsed ?? 0) * BigInt(receipt?.gasPrice ?? 0);

    expect(await xusdc.balanceOf(owner.address)).to.be.gt(beforeToken);
    expect(await ethers.provider.getBalance(owner.address)).to.be.gt(beforeNative - gasCost);
  });

  it("reverts when slippage minimum is too high", async function () {
    const { owner, trader, router, xusdc, xusdt } = await deployDexFixture();

    await router.addLiquidity(
      await xusdc.getAddress(),
      await xusdt.getAddress(),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
    );

    const amountIn = ethers.parseUnits("100", 6);
    const path = [await xusdc.getAddress(), await xusdt.getAddress()];
    await expect(
      router
        .connect(trader)
        .swapExactTokensForTokens(
          amountIn,
          ethers.parseUnits("1000", 6),
          path,
          trader.address,
          await deadline(),
        ),
    ).to.be.revertedWith("XphereV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("reverts after deadline", async function () {
    const { owner, trader, router, xusdc, xusdt } = await deployDexFixture();

    await router.addLiquidity(
      await xusdc.getAddress(),
      await xusdt.getAddress(),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("10000", 6),
      0,
      0,
      owner.address,
      await deadline(),
    );

    const path = [await xusdc.getAddress(), await xusdt.getAddress()];
    await expect(
      router
        .connect(trader)
        .swapExactTokensForTokens(
          ethers.parseUnits("10", 6),
          0,
          path,
          trader.address,
          1,
        ),
    ).to.be.revertedWith("XphereV2Router: EXPIRED");
  });
});
