require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000001";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    rhTestnet: {
      url: process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    rhMainnet: {
      url: process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      rhTestnet: "empty",
      rhMainnet: "empty",
    },
    customChains: [
      {
        network: "rhTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com/",
        },
      },
      {
        network: "rhMainnet",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com/",
        },
      },
    ],
  },
  paths: {
    tests: "./test",
  },
};