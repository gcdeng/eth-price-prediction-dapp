const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const { parseUnits } = require("ethers/lib/utils");

const DECIMALS = 8; // Chainlink default for ETH/USD
const INITIAL_PRICE = 10000000000; // $100, 8 decimal places
const LIVE_INTERVAL_SECONDS = 10;
const LOCK_INTERVAL_SECONDS = 7200;

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

  const oracleFactory = await ethers.getContractFactory("MockAggregatorV3");

  const oracle = await oracleFactory.deploy(DECIMALS, INITIAL_PRICE);

  await oracle.deployed();

  const ethPricePredictionContract = await EthPricePredictionFactory.deploy(
    owner.address,
    oracle.address
  );

  await ethPricePredictionContract.deployed();

  return {
    ethPricePredictionContract,
    oracle,
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
    let ethPricePredictionContract, owner;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFixture);
      ethPricePredictionContract = fixture.ethPricePredictionContract;
      owner = fixture.owner;
    });

    it("Initialize", async () => {
      assert.equal(await ethPricePredictionContract.currentEpoch(), 0);
      assert.equal(await ethPricePredictionContract.treasuryAmount(), 0);
    });

    it("Contract ETH balance (treasury amount) should equal to 0", async () => {
      const contractBalance = await ethers.provider.getBalance(
        ethPricePredictionContract.address
      );
      expect(contractBalance).to.equal(0);
    });

    it("Should set the right admin", async () => {
      expect(await ethPricePredictionContract.adminAddress()).to.equal(
        owner.address
      );
    });
  });

  describe("Oracle", () => {
    let ethPricePredictionContract, oracleContract;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFixture);
      ethPricePredictionContract = fixture.ethPricePredictionContract;
      oracleContract = fixture.oracle;
    });

    it("Should init the right oracle address", async () => {
      const oracle = await ethPricePredictionContract.oracle();
      expect(oracle).to.equal(oracleContract.address);
    });

    it("Should get the right ETH price from oracle", async () => {
      const [roundId, price] =
        await ethPricePredictionContract.getPriceFromOracle();
      const [oracleRoundId, oraclePrice] =
        await oracleContract.latestRoundData();
      expect(roundId).to.equal(oracleRoundId);
      expect(price).to.equal(oraclePrice);
    });
  });

  describe("Start round", () => {
    let ethPricePredictionContract,
      oracle,
      bullUser1,
      startTimestamp,
      lockTimestamp,
      closeTimestamp,
      currentEpoch = 0;

    it("Only admin can start round", async () => {
      const fixture = await loadFixture(deployFixture);
      ethPricePredictionContract = fixture.ethPricePredictionContract;
      bullUser1 = fixture.bullUser1;
      oracle = fixture.oracle;

      await expect(
        ethPricePredictionContract
          .connect(bullUser1)
          .startRound(LIVE_INTERVAL_SECONDS, LOCK_INTERVAL_SECONDS)
      ).to.revertedWith("Not admin");
    });

    it("Lock interval time should not less than 2 hours", async () => {
      await expect(
        ethPricePredictionContract.startRound(LIVE_INTERVAL_SECONDS, 10)
      ).to.revertedWith("Lock interval seconds must greater than 2 hours");
    });

    it("Should start round with right round data", async () => {
      // start first round
      currentEpoch++;
      await expect(
        ethPricePredictionContract.startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      )
        .to.emit(ethPricePredictionContract, "StartRound")
        .withArgs(currentEpoch);

      // check current round data
      const roundData = await ethPricePredictionContract.rounds(currentEpoch);

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
        ethPricePredictionContract.startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      ).to.revertedWith(
        "Can only start new round after previous round has ended"
      );
    });

    it("Should start n+1 round after n round has ended", async () => {
      await time.increaseTo(lockTimestamp);
      await oracle.updateAnswer(INITIAL_PRICE);

      await ethPricePredictionContract.lockRound();

      await time.increaseTo(closeTimestamp);
      await oracle.updateAnswer(INITIAL_PRICE);

      await ethPricePredictionContract.endRound();

      currentEpoch++;
      await expect(
        ethPricePredictionContract.startRound(
          LIVE_INTERVAL_SECONDS,
          LOCK_INTERVAL_SECONDS
        )
      )
        .to.emit(ethPricePredictionContract, "StartRound")
        .withArgs(currentEpoch);
    });
  });

  describe("Lock round", () => {
    let ethPricePredictionContract,
      oracle,
      bullUser1,
      startTimestamp,
      lockTimestamp,
      currentEpoch = 0;

    it("Only admin can lock round", async () => {
      const fixture = await loadFixture(deployFixture);
      ethPricePredictionContract = fixture.ethPricePredictionContract;
      bullUser1 = fixture.bullUser1;
      oracle = fixture.oracle;

      await expect(
        ethPricePredictionContract.connect(bullUser1).lockRound()
      ).to.revertedWith("Not admin");
    });

    it("Should not lock round before start round", async () => {
      await expect(ethPricePredictionContract.lockRound()).to.revertedWith(
        "Can only lock round after lockTimestamp"
      );
    });

    it("Should not lock round before lockTimestamp", async () => {
      await ethPricePredictionContract.startRound(
        LIVE_INTERVAL_SECONDS,
        LOCK_INTERVAL_SECONDS
      );

      currentEpoch++;
      startTimestamp = await time.latest();

      assert.equal(
        await ethPricePredictionContract.currentEpoch(),
        currentEpoch
      );

      await expect(ethPricePredictionContract.lockRound()).to.revertedWith(
        "Can only lock round after lockTimestamp"
      );
    });

    it("Should lock round after lockTimestamp", async () => {
      // update time and oracle
      lockTimestamp = startTimestamp + LIVE_INTERVAL_SECONDS + 100000;
      await time.increaseTo(lockTimestamp);
      const newPrice = INITIAL_PRICE + 10;
      await oracle.updateAnswer(newPrice);
      const latestRoundData = await oracle.latestRoundData();

      // lock round
      await expect(ethPricePredictionContract.lockRound())
        .to.emit(ethPricePredictionContract, "LockRound")
        .withArgs(
          currentEpoch,
          latestRoundData.roundId,
          latestRoundData.answer
        );

      // check round data
      const roundData = await ethPricePredictionContract.rounds(currentEpoch);
      expect(roundData.lockPrice).to.equal(latestRoundData.answer);
      expect(roundData.lockOracleId).to.equal(latestRoundData.roundId);
    });
  });

  describe("End round", () => {});

  describe("Bet", () => {});

  describe("Claim reward", () => {});

  describe("Claim treasury", () => {});
});
