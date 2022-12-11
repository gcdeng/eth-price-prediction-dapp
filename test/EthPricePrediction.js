const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const { parseUnits } = require("ethers/lib/utils");

const ORACLE_ADDRESS = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // Chainlink Ethereum Mainnet Price Feed Contract Address https://docs.chain.link/data-feeds/price-feeds/addresses
const DECIMALS = 8; // Chainlink default for ETH/USD
const INTERVAL_SECONDS = 10;

async function deployFixture() {
  const [owner, otherAccount] = await ethers.getSigners();

  const EthPricePredictionFactory = await ethers.getContractFactory(
    "EthPricePrediction"
  );
  const EthPricePrediction = await EthPricePredictionFactory.deploy(
    owner.address,
    ORACLE_ADDRESS,
    INTERVAL_SECONDS
  );
  await EthPricePrediction.deployed();

  return { EthPricePrediction, owner, otherAccount };
}

describe("EthPricePrediction", () => {
  describe("Deployment", () => {
    let EthPricePrediction, owner;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFixture);
      EthPricePrediction = fixture.EthPricePrediction;
      owner = fixture.owner;
    });

    it("Initialize", async () => {
      assert.equal(await EthPricePrediction.currentEpoch(), 0);
      assert.equal(
        await EthPricePrediction.intervalSeconds(),
        INTERVAL_SECONDS
      );
      assert.equal(await EthPricePrediction.treasuryAmount(), 0);
    });

    it("Contract ETH balance (treasury amount) should equal to 0", async () => {
      const contractBalance = await ethers.provider.getBalance(
        EthPricePrediction.address
      );
      expect(contractBalance).to.equal(0);
    });

    it("Should set the right admin", async () => {
      expect(await EthPricePrediction.adminAddress()).to.equal(owner.address);
    });
  });

  describe("Oracle", () => {
    let EthPricePrediction;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFixture);
      EthPricePrediction = fixture.EthPricePrediction;
    });

    it("Should init the right oracle address", async () => {
      const oracle = await EthPricePrediction.oracle();
      expect(oracle).to.equal(ORACLE_ADDRESS);
    });

    it("Should get the right ETH price from oracle", async () => {
      const [, price] = await EthPricePrediction.getPriceFromOracle();
      const answerPrice = parseUnits("1289.85", DECIMALS); // ETH price is $1,289.85 at block number 16146979 which is configured in hardhat.config.js
      expect(price).to.equal(answerPrice);
    });
  });

  describe("Start round", () => {});
  describe("Lock round", () => {});
  describe("End round", () => {});
  describe("Bet", () => {});
  describe("Claim reward", () => {});
  describe("Claim treasury", () => {});
});
