// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title EthPricePrediction
 */
contract EthPricePrediction is Ownable, ReentrancyGuard {
    AggregatorV3Interface public oracle; // chainlink oracle aggregator interface

    address public adminAddress; // address of the admin

    uint256 public intervalSeconds = 30; // interval in seconds between two prediction rounds

    uint256 public currentEpoch; // current epoch for prediction round

    uint256 public oracleLatestRoundId; // converted from uint80 (Chainlink)

    mapping(uint256 => mapping(address => BetInfo)) public ledger; // record user's bet info, ledger[epoch][user address]

    mapping(uint256 => Round) public rounds; // record rounds data, rounds[epoch]

    struct Round {
        uint256 epoch;
        uint256 startTimestamp;
        uint256 lockTimestamp;
        uint256 closeTimestamp;
        int256 lockPrice;
        int256 closePrice;
        uint256 lockOracleId;
        uint256 closeOracleId;
        uint256 totalAmount;
        uint256 bullAmount;
        uint256 bearAmount;
        uint256 rewardBaseCalAmount;
        uint256 rewardAmount;
        bool oracleCalled;
    }

    enum Position {
        Bull,
        Bear
    }

    struct BetInfo {
        Position position;
        uint256 amount;
        bool claimed; // default false
    }

    event Bet(
        address indexed sender,
        uint256 indexed epoch,
        uint256 amount,
        Position position
    );

    event StartRound(uint256 indexed epoch);

    event LockRound(
        uint256 indexed epoch,
        uint256 indexed roundId,
        int256 price
    );

    event EndRound(
        uint256 indexed epoch,
        uint256 indexed roundId,
        int256 price
    );

    event RewardsCalculated(
        uint256 indexed epoch,
        uint256 rewardBaseCalAmount,
        uint256 rewardAmount
    );

    event Claim(address indexed sender, uint256 indexed epoch, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == adminAddress, "Not admin");
        _;
    }

    modifier notContract() {
        require(!Address.isContract(msg.sender), "Contract not allowed");
        require(msg.sender == tx.origin, "Proxy contract not allowed");
        _;
    }

    constructor(
        address _adminAddress,
        address _oracleAddress,
        uint256 _intervalSeconds
    ) {
        adminAddress = _adminAddress;
        oracle = AggregatorV3Interface(_oracleAddress);
        intervalSeconds = _intervalSeconds;
    }

    /**
     * @notice Start round
     * Previous round must end
     */
    function startRound() public onlyAdmin {
        currentEpoch = currentEpoch + 1;

        if (currentEpoch > 1) {
            require(
                rounds[currentEpoch - 1].closeTimestamp != 0,
                "Can only start round after round n-2 has ended"
            );
            require(
                block.timestamp >= rounds[currentEpoch - 1].closeTimestamp,
                "Can only start new round after round n-2 closeTimestamp"
            );
        }

        Round storage round = rounds[currentEpoch];
        round.startTimestamp = block.timestamp;
        round.lockTimestamp = block.timestamp + intervalSeconds;
        round.closeTimestamp = block.timestamp + (2 * intervalSeconds);
        round.epoch = currentEpoch;
        round.totalAmount = 0;

        emit StartRound(currentEpoch);
    }

    /**
     * @notice Lock round
     */
    function lockRound() public onlyAdmin {
        require(
            rounds[currentEpoch].startTimestamp != 0,
            "Can only lock round after round has started"
        );
        require(
            block.timestamp >= rounds[currentEpoch].lockTimestamp,
            "Can only lock round after lockTimestamp"
        );

        (uint80 currentRoundId, int256 currentPrice) = _getPriceFromOracle();

        oracleLatestRoundId = uint256(currentRoundId);

        Round storage round = rounds[currentEpoch];
        round.closeTimestamp = block.timestamp + intervalSeconds;
        round.lockPrice = currentPrice;
        round.lockOracleId = currentRoundId;

        emit LockRound(currentEpoch, round.lockOracleId, round.lockPrice);
    }

    /**
     * @notice End round
     */
    function endRound() public onlyAdmin {
        require(
            rounds[currentEpoch].lockTimestamp != 0,
            "Can only end round after round has locked"
        );
        require(
            block.timestamp >= rounds[currentEpoch].closeTimestamp,
            "Can only end round after closeTimestamp"
        );

        (uint80 currentRoundId, int256 currentPrice) = _getPriceFromOracle();

        oracleLatestRoundId = uint256(currentRoundId);

        Round storage round = rounds[currentEpoch];
        round.closePrice = currentPrice;
        round.closeOracleId = currentRoundId;
        round.oracleCalled = true;

        emit EndRound(currentEpoch, round.closeOracleId, round.closePrice);

        _calculateRewards(currentEpoch);
    }

    /**
     * @notice Bet bear/bull position
     * @param epoch: epoch
     * @param position: position
     */
    function bet(
        uint256 epoch,
        Position position
    ) external payable nonReentrant notContract {
        require(epoch == currentEpoch, "Bet is too early/late");
        require(_bettable(epoch), "Round not bettable");
        require(
            ledger[epoch][msg.sender].amount == 0,
            "Can only bet once per round"
        );

        // Update round data
        uint256 amount = msg.value;
        Round storage round = rounds[epoch];
        round.totalAmount = round.totalAmount + amount;
        if (position == Position.Bear) {
            round.bearAmount = round.bearAmount + amount;
        } else {
            round.bullAmount = round.bullAmount + amount;
        }

        // Update user's bet info
        BetInfo storage betInfo = ledger[epoch][msg.sender];
        betInfo.position = position;
        betInfo.amount = amount;

        emit Bet(msg.sender, epoch, amount, position);
    }

    /**
     * @notice Determine if a round is valid for receiving bets
     * Current timestamp must be within startTimestamp and lockTimestamp
     */
    function _bettable(uint256 epoch) internal view returns (bool) {
        return
            rounds[epoch].startTimestamp != 0 &&
            rounds[epoch].lockTimestamp != 0 &&
            block.timestamp > rounds[epoch].startTimestamp &&
            block.timestamp < rounds[epoch].lockTimestamp;
    }

    /**
     * @notice Claim reward for an array of epochs
     * @param epochs: array of epochs
     */
    function claim(
        uint256[] calldata epochs
    ) external nonReentrant notContract {
        uint256 reward; // Initializes reward

        for (uint256 i = 0; i < epochs.length; i++) {
            require(
                rounds[epochs[i]].startTimestamp != 0,
                "Round has not started"
            );
            require(
                block.timestamp > rounds[epochs[i]].closeTimestamp,
                "Round has not ended"
            );

            uint256 addedReward = 0;

            // Round valid, claim rewards
            if (rounds[epochs[i]].oracleCalled) {
                require(claimable(epochs[i], msg.sender), "Not allow to claim");
                Round memory round = rounds[epochs[i]];
                addedReward =
                    (ledger[epochs[i]][msg.sender].amount *
                        round.rewardAmount) /
                    round.rewardBaseCalAmount;
            }
            // Round invalid, refund bet amount
            else {
                require(
                    refundable(epochs[i], msg.sender),
                    "Not allow to refund"
                );
                addedReward = ledger[epochs[i]][msg.sender].amount;
            }

            ledger[epochs[i]][msg.sender].claimed = true;
            reward += addedReward;

            emit Claim(msg.sender, epochs[i], addedReward);
        }

        if (reward > 0) {
            _safeTransferETH(address(msg.sender), reward);
        }
    }

    /**
     * @notice Get the claimable stats of specific epoch and user account
     * @param epoch: epoch
     * @param user: user address
     */
    function claimable(uint256 epoch, address user) public view returns (bool) {
        BetInfo memory betInfo = ledger[epoch][user];
        Round memory round = rounds[epoch];
        if (round.lockPrice == round.closePrice) {
            return false;
        }
        return
            round.oracleCalled &&
            betInfo.amount != 0 &&
            !betInfo.claimed &&
            ((round.closePrice > round.lockPrice &&
                betInfo.position == Position.Bull) ||
                (round.closePrice < round.lockPrice &&
                    betInfo.position == Position.Bear));
    }

    /**
     * @notice Get the refundable stats of specific epoch and user account
     * @param epoch: epoch
     * @param user: user address
     */
    function refundable(
        uint256 epoch,
        address user
    ) public view returns (bool) {
        BetInfo memory betInfo = ledger[epoch][user];
        Round memory round = rounds[epoch];
        return
            !round.oracleCalled &&
            !betInfo.claimed &&
            block.timestamp > round.closeTimestamp &&
            betInfo.amount != 0;
    }

    /**
     * @notice Transfer ETH in a safe way
     * @param to: address to transfer ETH to
     * @param value: ETH amount to transfer (in wei)
     */
    function _safeTransferETH(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}("");
        require(success, "TransferHelper: ETH_TRANSFER_FAILED");
    }

    /**
     * @notice Calculate rewards for round
     * @param epoch: epoch
     */
    function _calculateRewards(uint256 epoch) internal {
        require(
            rounds[epoch].rewardBaseCalAmount == 0 &&
                rounds[epoch].rewardAmount == 0,
            "Rewards calculated"
        );
        Round storage round = rounds[epoch];
        uint256 rewardBaseCalAmount;
        uint256 rewardAmount;

        if (round.closePrice > round.lockPrice) {
            // Bull wins
            rewardBaseCalAmount = round.bullAmount;
            rewardAmount = round.totalAmount;
        } else if (round.closePrice < round.lockPrice) {
            // Bear wins
            rewardBaseCalAmount = round.bearAmount;
            rewardAmount = round.totalAmount;
        } else {
            // House wins
            rewardBaseCalAmount = 0;
            rewardAmount = 0;
        }
        round.rewardBaseCalAmount = rewardBaseCalAmount;
        round.rewardAmount = rewardAmount;

        emit RewardsCalculated(epoch, rewardBaseCalAmount, rewardAmount);
    }

    /**
     * @notice Get latest recorded price from oracle
     */
    function _getPriceFromOracle() public view returns (uint80, int256) {
        (uint80 roundId, int256 price, , uint256 timestamp, ) = oracle
            .latestRoundData();
        // If the round is not complete yet, timestamp is 0
        require(timestamp > 0, "Round not complete");
        require(
            uint256(roundId) > oracleLatestRoundId,
            "Oracle update roundId must be larger than oracleLatestRoundId"
        );

        return (roundId, price);
    }
}
