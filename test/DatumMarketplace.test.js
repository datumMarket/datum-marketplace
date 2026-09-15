const { expect } = require("chai");
const { ethers } = require("hardhat");

const SUPPLY = 100_000_000n * 10n ** 18n;
const FEE_BPS = 250n; // 2.5%
const units = (n) => ethers.parseUnits(n.toString(), 18);

describe("DatumMarketplace", function () {
  async function deploy() {
    const [owner, seller, buyer, newTreasury] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DatumToken");
    const token = await Token.deploy(SUPPLY);
    const Market = await ethers.getContractFactory("DatumMarketplace");
    const market = await Market.deploy(token.target, owner.address, FEE_BPS);
    // fund the buyer
    await token.transfer(buyer.address, units(10_000));
    return { token, market, owner, seller, buyer, newTreasury };
  }

  it("stores token, treasury, and fee at deploy", async function () {
    const { token, market, owner } = await deploy();
    expect(await market.token()).to.equal(token.target);
    expect(await market.treasury()).to.equal(owner.address);
    expect(await market.feeBps()).to.equal(FEE_BPS);
    expect(await market.MAX_FEE_BPS()).to.equal(1000n);
  });

  it("routes payment: fee to treasury, rest to seller, emits Purchase", async function () {
    const { token, market, buyer, seller, owner } = await deploy();
    const amount = units(400); // 2.5% = 10 tokens
    await token.connect(buyer).approve(market.target, amount);

    await expect(market.connect(buyer).purchase(1, seller.address, amount))
      .to.emit(market, "Purchase")
      .withArgs(1, buyer.address, seller.address, amount, units(10));

    expect(await token.balanceOf(seller.address)).to.equal(units(390));
    expect(await token.balanceOf(owner.address)).to.equal(SUPPLY - units(10_000) + units(10));
  });

  it("handles rounding on odd amounts (fee rounds down)", async function () {
    const { token, market, buyer, seller, owner } = await deploy();
    const amount = 101n; // tiny odd amount: fee = 101*250/10000 = 2 (rounds down)
    await token.connect(buyer).approve(market.target, amount);
    await market.connect(buyer).purchase(2, seller.address, amount);
    expect(await token.balanceOf(seller.address)).to.equal(99n);
    expect(await token.balanceOf(owner.address)).to.equal(SUPPLY - units(10_000) + 2n);
  });

  it("reverts purchase without allowance", async function () {
    const { market, buyer, seller } = await deploy();
    await expect(market.connect(buyer).purchase(1, seller.address, units(100)))
      .to.be.reverted;
  });

  it("reverts zero seller / zero amount", async function () {
    const { token, market, buyer, seller } = await deploy();
    await token.connect(buyer).approve(market.target, units(100));
    await expect(market.connect(buyer).purchase(1, ethers.ZeroAddress, units(100)))
      .to.be.revertedWith("seller=0");
    await expect(market.connect(buyer).purchase(1, seller.address, 0))
      .to.be.revertedWith("amount=0");
  });

  it("owner can change fee within the 10% cap", async function () {
    const { market } = await deploy();
    await market.setFeeBps(500);
    expect(await market.feeBps()).to.equal(500n);
  });

  it("reverts fee change above the hard cap — even for owner", async function () {
    const { market } = await deploy();
    await expect(market.setFeeBps(1001)).to.be.revertedWith("fee>cap");
    await expect(market.setFeeBps(1000)).to.not.be.reverted; // exactly at cap is allowed
  });

  it("non-owner cannot change fee or treasury", async function () {
    const { market, buyer, newTreasury } = await deploy();
    await expect(market.connect(buyer).setFeeBps(500)).to.be.reverted;
    await expect(market.connect(buyer).setTreasury(newTreasury.address)).to.be.reverted;
  });

  it("owner can update treasury, zero address reverts", async function () {
    const { market, newTreasury } = await deploy();
    await market.setTreasury(newTreasury.address);
    expect(await market.treasury()).to.equal(newTreasury.address);
    await expect(market.setTreasury(ethers.ZeroAddress)).to.be.revertedWith("treasury=0");
  });

  it("fee paid to updated treasury after change", async function () {
    const { token, market, buyer, seller, newTreasury } = await deploy();
    await market.setTreasury(newTreasury.address);
    const amount = units(200); // fee 5 tokens
    await token.connect(buyer).approve(market.target, amount);
    await market.connect(buyer).purchase(3, seller.address, amount);
    expect(await token.balanceOf(newTreasury.address)).to.equal(units(5));
    expect(await token.balanceOf(seller.address)).to.equal(units(195));
  });
});
