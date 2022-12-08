// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title EthPricePrediction
 */
contract EthPricePrediction is Ownable, ReentrancyGuard {
    AggregatorV3Interface public oracle;
    address public adminAddress; // address of the admin

    modifier onlyAdmin() {
        require(msg.sender == adminAddress, "Not admin");
        _;
    }

    constructor(address _adminAddress, address _oracleAddress) {
        oracle = AggregatorV3Interface(_oracleAddress);
        adminAddress = _adminAddress;
    }

    /**
     * @notice Set Oracle address
     * @dev Callable by admin
     */
    function setOracle(address _oracle) external onlyAdmin {
        require(_oracle != address(0), "Cannot be zero address");
        // oracleLatestRoundId = 0;
        oracle = AggregatorV3Interface(_oracle);

        // Dummy check to make sure the interface implements this function properly
        oracle.latestRoundData();

        // emit NewOracle(_oracle);
    }

    /**
     * @notice Get latest recorded price from oracle
     */
    function _getPriceFromOracle() public view returns (uint80, int256) {
        (uint80 roundId, int256 price, , uint256 timestamp, ) = oracle
            .latestRoundData();
        // If the round is not complete yet, timestamp is 0
        require(timestamp > 0, "Round not complete");

        return (roundId, price);
    }
}
