import { expect } from "chai";
import { ethers } from "hardhat";

describe("LocalFaucet", function () {
  it("claims native gas and configured demo tokens", async function () {
    const [owner, user] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MintableERC20");
    const token = (await Token.deploy("Demo USD", "dUSD", 6, owner.address)) as any;
    await token.waitForDeployment();

    const Faucet = await ethers.getContractFactory("LocalFaucet");
    const faucet = (await Faucet.deploy(owner.address, ethers.parseEther("1"), {
      value: ethers.parseEther("10"),
    })) as any;
    await faucet.waitForDeployment();

    const tokenClaim = ethers.parseUnits("5000", 6);
    await token.mint(await faucet.getAddress(), ethers.parseUnits("100000", 6));
    await faucet.setTokenAmount(await token.getAddress(), tokenClaim);

    const beforeNative = await ethers.provider.getBalance(user.address);
    const tx = await faucet.connect(user).claimAll();
    const receipt = await tx.wait();
    const gasCost = BigInt(receipt?.gasUsed ?? 0) * BigInt(receipt?.gasPrice ?? 0);

    expect(await token.balanceOf(user.address)).to.equal(tokenClaim);
    expect(await ethers.provider.getBalance(user.address)).to.equal(beforeNative + ethers.parseEther("1") - gasCost);
    expect(await faucet.tokenCount()).to.equal(1);
  });

  it("keeps faucet configuration owner-only", async function () {
    const [owner, user] = await ethers.getSigners();
    const Faucet = await ethers.getContractFactory("LocalFaucet");
    const faucet = (await Faucet.deploy(owner.address, ethers.parseEther("1"))) as any;
    await faucet.waitForDeployment();

    await expect(faucet.connect(user).setNativeAmount(ethers.parseEther("2"))).to.be.revertedWith(
      "LocalFaucet: not owner",
    );
    await expect(faucet.connect(user).setTokenAmount(user.address, 1)).to.be.revertedWith("LocalFaucet: not owner");
  });
});
