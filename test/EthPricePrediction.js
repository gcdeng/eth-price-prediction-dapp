const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const { parseUnits } = require("ethers/lib/utils");

const ORACLE_ADDRESS = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // Chainlink Ethereum Mainnet Price Feed Contract Address https://docs.chain.link/data-feeds/price-feeds/addresses
const DECIMALS = 8; // Chainlink default for ETH/USD
const LIVE_INTERVAL_SECONDS = 10;
const LOCK_INTERVAL_SECONDS = 20;

// Enum: 0 = Bull, 1 = Bear
const Position = {
  Bull: 0,
  Bear: 1,
};

async function deployFixture() {
  const [
    owner,
    bullUser1,
    bullUser2,
    bullUser3,
    bearUser1,
    bearUser2,
    bearUser3,
  ] = await ethers.getSigners();

  const EthPricePredictionFactory = await ethers.getContractFactory(
    "EthPricePrediction"
  );
  const EthPricePrediction = await EthPricePredictionFactory.deploy(
    owner.address,
    ORACLE_ADDRESS
  );
  await EthPricePrediction.deployed();

  return {
    EthPricePrediction,
    owner,
    bullUser1,
    bullUser2,
    bullUser3,
    bearUser1,
    bearUser2,
    bearUser3,
  };
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

  describe("Start round", () => {
    let EthPricePrediction,
      bullUser1,
      startTimestamp,
      lockTimestamp,
      closeTimestamp;

    const currentEpoch = 1;

    it("Should start round with right round data", async () => {
      const fixture = await loadFixture(deployFixture);
      EthPricePrediction = fixture.EthPricePrediction;
      bullUser1 = fixture.bullUser1;

      // start first round
      await expect(
        EthPricePrediction.startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      )
        .to.emit(EthPricePrediction, "StartRound")
        .withArgs(currentEpoch);

      // check current round data
      const roundData = await EthPricePrediction.rounds(currentEpoch);

      startTimestamp = await time.latest();
      lockTimestamp = startTimestamp + LIVE_INTERVAL_SECONDS;
      closeTimestamp = lockTimestamp + LOCK_INTERVAL_SECONDS;

      expect(roundData.epoch).to.equal(1);
      expect(roundData.startTimestamp).to.equal(startTimestamp);
      expect(roundData.lockTimestamp).to.equal(lockTimestamp);
      expect(roundData.closeTimestamp).to.equal(closeTimestamp);
      expect(roundData.totalAmount).to.equal(0);
      expect(roundData.bullAmount).to.equal(0);
      expect(roundData.bearAmount).to.equal(0);
      expect(roundData.rewardBaseCalAmount).to.equal(0);
      expect(roundData.rewardAmount).to.equal(0);
      expect(roundData.oracleCalled).to.equal(false);
    });

    it("Should not start new round before previous round has ended", async () => {
      await expect(
        EthPricePrediction.startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      ).to.revertedWith(
        "Can only start new round after previous round has ended"
      );
    });

    it("Should start n+1 round after n round has ended", async () => {
      await time.increaseTo(lockTimestamp);
      await EthPricePrediction.lockRound();
      await time.increaseTo(closeTimestamp);
      await EthPricePrediction.endRound();
      await expect(
        EthPricePrediction.startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      )
        .to.emit(EthPricePrediction, "StartRound")
        .withArgs(currentEpoch + 1);
    });

    it("Only admin can start round", async () => {
      await expect(
        EthPricePrediction.connect(bullUser1).startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      ).to.revertedWith("Not admin");
    });
  });

  describe("Lock round", () => {});

  describe("End round", () => {});

  describe("Bet", () => {});

  describe("Claim reward", () => {});

  describe("Claim treasury", () => {});
});
