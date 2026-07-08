import { ethers } from "hardhat";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DeploymentArtifact } from "./shared/config";

async function main() {
  const artifactPath = resolve(__dirname, "../../../deployments/localhost.local.json");
  const deployment = JSON.parse(await readFile(artifactPath, "utf8")) as DeploymentArtifact;
  const [trader] = await ethers.getSigners();

  if (!deployment.router || !deployment.contracts.wXP || !deployment.tokens.xUSDC || !deployment.tokens.xUSDT) {
    throw new Error("Local deployment is missing router, WXP, xUSDC, or xUSDT");
  }

  const router = await ethers.getContractAt("XphereV2Router02", deployment.router);
  const wxp = await ethers.getContractAt("WXP", deployment.contracts.wXP);
  const xusdc = await ethers.getContractAt("MintableERC20", deployment.tokens.xUSDC);
  const xusdt = await ethers.getContractAt("MintableERC20", deployment.tokens.xUSDT);

  const amountIn = ethers.parseUnits("10", 6);
  const path = [deployment.tokens.xUSDC, deployment.tokens.xUSDT];
  const amounts = await router.getAmountsOut(amountIn, path);
  const quoteOut = amounts[amounts.length - 1];
  const before = await xusdt.balanceOf(trader.address);

  await (await xusdc.approve(deployment.router, amountIn)).wait();
  await (
    await router.swapExactTokensForTokens(
      amountIn,
      (quoteOut * 995n) / 1000n,
      path,
      trader.address,
      Math.floor(Date.now() / 1000) + 1200,
    )
  ).wait();

  const after = await xusdt.balanceOf(trader.address);
  const delta = after - before;
  if (delta <= 0n) {
    throw new Error("Swap produced no xUSDT output");
  }

  const nativeAmountIn = ethers.parseEther("1");
  const nativePath = [deployment.contracts.wXP, deployment.tokens.xUSDC];
  const nativeAmounts = await router.getAmountsOut(nativeAmountIn, nativePath);
  const beforeNativeSwap = await xusdc.balanceOf(trader.address);
  await (
    await router.swapExactETHForTokens(
      (nativeAmounts[nativeAmounts.length - 1] * 995n) / 1000n,
      nativePath,
      trader.address,
      Math.floor(Date.now() / 1000) + 1200,
      { value: nativeAmountIn },
    )
  ).wait();
  const nativeDelta = (await xusdc.balanceOf(trader.address)) - beforeNativeSwap;
  if (nativeDelta <= 0n) {
    throw new Error("Native XP swap produced no xUSDC output");
  }

  const tokenToNativeAmountIn = ethers.parseUnits("10", 6);
  const tokenToNativePath = [deployment.tokens.xUSDC, deployment.contracts.wXP];
  const tokenToNativeAmounts = await router.getAmountsOut(tokenToNativeAmountIn, tokenToNativePath);
  const beforeWxpSupply = await wxp.totalSupply();
  await (await xusdc.approve(deployment.router, tokenToNativeAmountIn)).wait();
  await (
    await router.swapExactTokensForETH(
      tokenToNativeAmountIn,
      (tokenToNativeAmounts[tokenToNativeAmounts.length - 1] * 995n) / 1000n,
      tokenToNativePath,
      trader.address,
      Math.floor(Date.now() / 1000) + 1200,
    )
  ).wait();
  const afterWxpSupply = await wxp.totalSupply();
  if (afterWxpSupply >= beforeWxpSupply) {
    throw new Error("Token to native swap did not unwrap WXP");
  }

  let xefRoute:
    | {
        amountIn: string;
        quoteOut: string;
        actualOut: string;
      }
    | undefined;

  if (deployment.tokens.XEF) {
    const xef = await ethers.getContractAt("MintableERC20", deployment.tokens.XEF);
    const xefAmountIn = ethers.parseEther("100");
    const xefPath = [deployment.tokens.XEF, deployment.contracts.wXP, deployment.tokens.xUSDC];
    const xefAmounts = await router.getAmountsOut(xefAmountIn, xefPath);
    const xefQuoteOut = xefAmounts[xefAmounts.length - 1];
    const beforeXefSwap = await xusdc.balanceOf(trader.address);

    await (await xef.approve(deployment.router, xefAmountIn)).wait();
    await (
      await router.swapExactTokensForTokens(
        xefAmountIn,
        (xefQuoteOut * 995n) / 1000n,
        xefPath,
        trader.address,
        Math.floor(Date.now() / 1000) + 1200,
      )
    ).wait();

    const afterXefSwap = await xusdc.balanceOf(trader.address);
    const xefDelta = afterXefSwap - beforeXefSwap;
    if (xefDelta <= 0n) {
      throw new Error("XEF multi-hop swap produced no xUSDC output");
    }
    xefRoute = {
      amountIn: ethers.formatEther(xefAmountIn),
      quoteOut: ethers.formatUnits(xefQuoteOut, 6),
      actualOut: ethers.formatUnits(xefDelta, 6),
    };
  }

  console.log(
    JSON.stringify(
      {
        trader: trader.address,
        amountIn: ethers.formatUnits(amountIn, 6),
        quoteOut: ethers.formatUnits(quoteOut, 6),
        actualOut: ethers.formatUnits(delta, 6),
        nativeXpToXusdc: {
          amountIn: ethers.formatEther(nativeAmountIn),
          quoteOut: ethers.formatUnits(nativeAmounts[nativeAmounts.length - 1], 6),
          actualOut: ethers.formatUnits(nativeDelta, 6),
        },
        xusdcToNativeXp: {
          amountIn: ethers.formatUnits(tokenToNativeAmountIn, 6),
          quoteOut: ethers.formatEther(tokenToNativeAmounts[tokenToNativeAmounts.length - 1]),
          wxpSupplyBefore: ethers.formatEther(beforeWxpSupply),
          wxpSupplyAfter: ethers.formatEther(afterWxpSupply),
        },
        xefToXusdc: xefRoute,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
