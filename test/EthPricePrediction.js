const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const { parseUnits } = require("ethers/lib/utils");

const DECIMALS = 8; // Chainlink default for ETH/USD
const INITIAL_PRICE = 10000000000; // $100, 8 decimal places
const LIVE_INTERVAL_SECONDS = 10;
const LOCK_INTERVAL_SECONDS = 7200; // 2 hours

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
      lockTimestamp = startTimestamp + LIVE_INTERVAL_SECONDS;
      await time.increaseTo(lockTimestamp);
      const newPrice = INITIAL_PRICE + 10;
      await oracle.updateAnswer(newPrice);
      const latestRoundData = await oracle.latestRoundData();

      // check round data
      let roundData = await ethPricePredictionContract.rounds(currentEpoch);
      expect(roundData.lockPrice).to.equal(0);
      expect(roundData.lockOracleId).to.equal(0);

      // lock round
      await expect(ethPricePredictionContract.lockRound())
        .to.emit(ethPricePredictionContract, "LockRound")
        .withArgs(
          currentEpoch,
          latestRoundData.roundId,
          latestRoundData.answer
        );

      // check round data
      roundData = await ethPricePredictionContract.rounds(currentEpoch);
      expect(roundData.lockPrice).to.equal(latestRoundData.answer);
      expect(roundData.lockOracleId).to.equal(latestRoundData.roundId);
    });
  });

  describe("End round", () => {
    let ethPricePredictionContract,
      oracle,
      bullUser1,
      startTimestamp,
      lockTimestamp,
      closeTimestamp,
      currentEpoch = 0;

    it("Only admin can end round", async () => {
      const fixture = await loadFixture(deployFixture);
      ethPricePredictionContract = fixture.ethPricePredictionContract;
      bullUser1 = fixture.bullUser1;
      oracle = fixture.oracle;

      await expect(
        ethPricePredictionContract.connect(bullUser1).endRound()
      ).to.revertedWith("Not admin");
    });

    it("Should not end round before round has locked", async () => {
      await expect(ethPricePredictionContract.endRound()).to.revertedWith(
        "Can only end round after round has locked"
      );

      await ethPricePredictionContract.startRound(
        LIVE_INTERVAL_SECONDS,
        LOCK_INTERVAL_SECONDS
      );
      currentEpoch++;
      startTimestamp = await time.latest();
      lockTimestamp = startTimestamp + LIVE_INTERVAL_SECONDS;
      closeTimestamp = lockTimestamp + LOCK_INTERVAL_SECONDS;

      await expect(ethPricePredictionContract.endRound()).to.revertedWith(
        "Can only end round after round has locked"
      );
    });

    it("Should not end round before closeTimestamp", async () => {
      await time.increaseTo(lockTimestamp);
      await oracle.updateAnswer(INITIAL_PRICE);
      await ethPricePredictionContract.lockRound();
      await expect(ethPricePredictionContract.endRound()).to.revertedWith(
        "Can only end round after closeTimestamp"
      );
    });

    it("Should end round after closeTimestamp", async () => {
      await time.increaseTo(closeTimestamp);
      await oracle.updateAnswer(INITIAL_PRICE);
      const latestRoundData = await oracle.latestRoundData();

      // check round data before end round
      let roundData = await ethPricePredictionContract.rounds(currentEpoch);
      expect(roundData.closePrice).to.equal(0);
      expect(roundData.closeOracleId).to.equal(0);
      expect(roundData.oracleCalled).to.be.false;

      await expect(ethPricePredictionContract.endRound())
        .to.emit(ethPricePredictionContract, "EndRound")
        .withArgs(
          currentEpoch,
          latestRoundData.roundId,
          latestRoundData.answer
        );

      // check round data after round
      roundData = await ethPricePredictionContract.rounds(currentEpoch);
      expect(roundData.closePrice).to.equal(latestRoundData.answer);
      expect(roundData.closeOracleId).to.equal(latestRoundData.roundId);
      expect(roundData.oracleCalled).to.be.true;
    });
  });

  describe("Bet and claim reward by user", () => {
    let ethPricePredictionContract,
      oracle,
      bullUser1,
      bullUser2,
      bearUser1,
      bearUser2,
      startTimestamp,
      lockTimestamp,
      closeTimestamp,
      currentEpoch = 0;

    const betAmount = parseUnits("1", 18); // 1 ETH

    it("Should not bet if round is not started", async () => {
      const fixture = await loadFixture(deployFixture);
      ethPricePredictionContract = fixture.ethPricePredictionContract;
      oracle = fixture.oracle;
      bullUser1 = fixture.bullUser1;
      bullUser2 = fixture.bullUser2;
      bearUser1 = fixture.bearUser1;
      bearUser2 = fixture.bearUser2;

      await expect(
        ethPricePredictionContract
          .connect(bullUser1)
          .bet(Position.Bull, { value: betAmount })
      ).to.revertedWith("Round not bettable");
    });

    it("Should not bet with 0 amount", async () => {
      await ethPricePredictionContract.startRound(
        LIVE_INTERVAL_SECONDS,
        LOCK_INTERVAL_SECONDS
      );
      currentEpoch++;
      startTimestamp = await time.latest();
      lockTimestamp = startTimestamp + LIVE_INTERVAL_SECONDS;
      closeTimestamp = lockTimestamp + LOCK_INTERVAL_SECONDS;

      await expect(
        ethPricePredictionContract
          .connect(bullUser1)
          .bet(Position.Bull, { value: parseUnits("0", 18) })
      ).to.revertedWith("Bet amount must be greater than 0");
    });

    it("Should able to bet if round is started and not locked", async () => {
      expect(
        await ethPricePredictionContract
          .connect(bullUser1)
          .bet(Position.Bull, { value: betAmount })
      )
        .to.emit("Bet")
        .withArgs(bullUser1.address, currentEpoch, betAmount, Position.Bull);

      // check ledger
      const bullUser1Ledger = await ethPricePredictionContract.ledger(
        currentEpoch,
        bullUser1.address
      );
      expect(bullUser1Ledger.position).to.equal(Position.Bull);
      expect(bullUser1Ledger.amount).to.equal(betAmount);
      expect(bullUser1Ledger.claimed).to.equal(false);

      expect(
        await ethPricePredictionContract
          .connect(bullUser2)
          .bet(Position.Bull, { value: betAmount })
      )
        .to.emit("Bet")
        .withArgs(bullUser2.address, currentEpoch, betAmount, Position.Bull);

      expect(
        await ethPricePredictionContract
          .connect(bearUser1)
          .bet(Position.Bear, { value: betAmount })
      )
        .to.emit("Bet")
        .withArgs(bearUser1.address, currentEpoch, betAmount, Position.Bear);

      expect(
        await ethPricePredictionContract
          .connect(bearUser2)
          .bet(Position.Bear, { value: betAmount })
      )
        .to.emit("Bet")
        .withArgs(bearUser2.address, currentEpoch, betAmount, Position.Bear);

      // check round data
      const roundData = await ethPricePredictionContract.rounds(currentEpoch);
      expect(roundData.totalAmount).to.equal(parseUnits("4", 18));
      expect(roundData.bearAmount).to.equal(parseUnits("2", 18));
      expect(roundData.bullAmount).to.equal(parseUnits("2", 18));
    });

    it("User should not bet twice", async () => {
      await expect(
        ethPricePredictionContract
          .connect(bullUser1)
          .bet(Position.Bull, { value: betAmount })
      ).to.revertedWith("Can only bet once per round");
    });

    it("Should not bet if round is locked", async () => {
      await time.increaseTo(lockTimestamp);
      await ethPricePredictionContract.lockRound();

      await expect(
        ethPricePredictionContract
          .connect(bullUser1)
          .bet(Position.Bull, { value: betAmount })
      ).to.revertedWith("Round not bettable");
    });

    it("Should not claim before round has ended", async () => {
      await expect(
        ethPricePredictionContract.connect(bullUser1).claim([currentEpoch])
      ).to.revertedWith("Round has not ended");
    });

    it("Winners should able to claim reward after round has ended", async () => {
      await time.increaseTo(closeTimestamp);
      await oracle.updateAnswer(INITIAL_PRICE + 100); // bull win
      await ethPricePredictionContract.endRound();

      const rewardAmount = parseUnits("2", 18); // 1 bet amount * 4 total reward amount / 2 rewardBaseCalAmount = 2 ETH

      let originalBullUser1Balance = await ethers.provider.getBalance(
        bullUser1.address
      );

      expect(
        await ethPricePredictionContract
          .connect(bullUser1)
          .claim([currentEpoch])
      )
        .to.emit("Claim")
        .withArgs(bullUser1.address, currentEpoch, rewardAmount);

      let currentBullUser1Balance = await ethers.provider.getBalance(
        bullUser1.address
      );

      expect(currentBullUser1Balance).to.greaterThan(originalBullUser1Balance);

      let originalBullUser2Balance = await ethers.provider.getBalance(
        bullUser2.address
      );

      expect(
        await ethPricePredictionContract
          .connect(bullUser2)
          .claim([currentEpoch])
      )
        .to.emit("Claim")
        .withArgs(bullUser2.address, currentEpoch, rewardAmount);

      let currentBullUser2Balance = await ethers.provider.getBalance(
        bullUser2.address
      );

      expect(currentBullUser2Balance).to.greaterThan(originalBullUser2Balance);
    });

    it("Winner should not claim twice", async () => {
      await expect(
        ethPricePredictionContract.connect(bullUser1).claim([currentEpoch])
      ).to.revertedWith("Not allow to claim");
    });

    it("Loser should not claim", async () => {
      await expect(
        ethPricePredictionContract.connect(bearUser1).claim([currentEpoch])
      ).to.revertedWith("Not allow to claim");
    });
  });

  describe("Claim treasury by admin", () => {});
});
