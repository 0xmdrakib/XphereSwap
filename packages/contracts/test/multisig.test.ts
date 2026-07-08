import { expect } from "chai";
import { ethers } from "hardhat";

describe("ProtocolMultisig", function () {
  it("executes owner-only calls after threshold confirmations", async function () {
    const [owner1, owner2, owner3, outsider] = await ethers.getSigners();
    const Multisig = await ethers.getContractFactory("ProtocolMultisig");
    const multisig = (await Multisig.deploy([owner1.address, owner2.address, owner3.address], 2)) as any;
    await multisig.waitForDeployment();

    const Faucet = await ethers.getContractFactory("LocalFaucet");
    const faucet = (await Faucet.deploy(await multisig.getAddress(), ethers.parseEther("1"))) as any;
    await faucet.waitForDeployment();

    const data = faucet.interface.encodeFunctionData("setNativeAmount", [ethers.parseEther("2")]);
    await multisig.connect(owner1).submitTransaction(await faucet.getAddress(), 0, data);
    await expect(multisig.connect(owner1).executeTransaction(0)).to.be.revertedWith("ProtocolMultisig: below threshold");
    await expect(multisig.connect(outsider).confirmTransaction(0)).to.be.revertedWith("ProtocolMultisig: not owner");

    await multisig.connect(owner2).confirmTransaction(0);
    await multisig.connect(owner3).executeTransaction(0);

    expect(await faucet.nativeAmount()).to.equal(ethers.parseEther("2"));
    await expect(multisig.connect(owner2).executeTransaction(0)).to.be.revertedWith("ProtocolMultisig: executed");
  });

  it("rejects duplicate owners and invalid thresholds", async function () {
    const [owner1, owner2] = await ethers.getSigners();
    const Multisig = await ethers.getContractFactory("ProtocolMultisig");

    await expect(Multisig.deploy([owner1.address, owner1.address], 2)).to.be.revertedWith(
      "ProtocolMultisig: duplicate owner",
    );
    await expect(Multisig.deploy([owner1.address, owner2.address], 3)).to.be.revertedWith(
      "ProtocolMultisig: bad threshold",
    );
  });
});
