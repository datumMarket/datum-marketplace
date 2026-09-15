const { expect } = require("chai");
const { ethers } = require("hardhat");

const SUPPLY = 100_000_000n * 10n ** 18n; // 100M with 18 decimals

describe("DatumToken", function () {
  it("has name Datum, symbol DTM, 18 decimals", async function () {
    const Token = await ethers.getContractFactory("DatumToken");
    const token = await Token.deploy(SUPPLY);
    expect(await token.name()).to.equal("Datum");
    expect(await token.symbol()).to.equal("DTM");
    expect(await token.decimals()).to.equal(18n);
  });

  it("mints the full supply to the deployer", async function () {
    const [deployer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DatumToken");
    const token = await Token.deploy(SUPPLY);
    expect(await token.totalSupply()).to.equal(SUPPLY);
    expect(await token.balanceOf(deployer.address)).to.equal(SUPPLY);
  });

  it("cannot mint more — supply is fixed", async function () {
    const Token = await ethers.getContractFactory("DatumToken");
    const token = await Token.deploy(SUPPLY);
    // no mint() exists on the contract; try calling one anyway
    expect(token.mint).to.equal(undefined);
    expect(await token.totalSupply()).to.equal(SUPPLY);
  });

  it("transfers between accounts", async function () {
    const [deployer, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("DatumToken");
    const token = await Token.deploy(SUPPLY);
    const amount = ethers.parseUnits("1000", 18);
    await token.transfer(other.address, amount);
    expect(await token.balanceOf(other.address)).to.equal(amount);
    expect(await token.balanceOf(deployer.address)).to.equal(SUPPLY - amount);
  });
});
