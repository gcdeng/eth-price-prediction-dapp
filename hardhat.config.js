// require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

// const ALCHEMY_KEY = process.env.ALCHEMY_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 99999,
      },
    },
  },
  // networks: {
  //   hardhat: {
  //     forking: {
  //       url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  //       blockNumber: 16146979,
  //       enabled: true,
  //     },
  //   },
  // },
};
