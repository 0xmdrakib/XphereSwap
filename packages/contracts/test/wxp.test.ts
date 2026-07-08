import { expect } from "chai";
import { ethers } from "hardhat";

describe("WXP", function () {
  it("wraps and unwraps native XP", async function () {
    const [owner] = await ethers.getSigners();
    const WXP = await ethers.getContractFactory("WXP");
    const wxp = (await WXP.deploy()) as any;
    await wxp.waitForDeployment();

    const amount = ethers.parseEther("1.5");
    await expect(wxp.deposit({ value: amount }))
      .to.emit(wxp, "Deposit")
      .withArgs(owner.address, amount);

    expect(await wxp.balanceOf(owner.address)).to.equal(amount);
    expect(await wxp.totalSupply()).to.equal(amount);

    await expect(wxp.withdraw(ethers.parseEther("0.5"))).to.changeEtherBalances(
      [owner, wxp],
      [ethers.parseEther("0.5"), -ethers.parseEther("0.5")],
    );
    expect(await wxp.balanceOf(owner.address)).to.equal(ethers.parseEther("1"));
  });

  it("supports infinite allowance transferFrom", async function () {
    const [owner, spender, recipient] = await ethers.getSigners();
    const WXP = await ethers.getContractFactory("WXP");
    const wxp = (await WXP.deploy()) as any;
    await wxp.waitForDeployment();

    await wxp.deposit({ value: ethers.parseEther("2") });
    await wxp.approve(spender.address, ethers.MaxUint256);
    await wxp
      .connect(spender)
      .transferFrom(owner.address, recipient.address, ethers.parseEther("0.75"));

    expect(await wxp.balanceOf(recipient.address)).to.equal(ethers.parseEther("0.75"));
    expect(await wxp.allowance(owner.address, spender.address)).to.equal(ethers.MaxUint256);
  });
});
