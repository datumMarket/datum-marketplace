require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: process.env.TESTNET_PRIVATE_KEY ? [process.env.TESTNET_PRIVATE_KEY] : [],
      chainId: 84532,
    },
    base: {
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      accounts: process.env.MAINNET_PRIVATE_KEY ? [process.env.MAINNET_PRIVATE_KEY] : [],
      chainId: 8453,
    },
  },
  // Etherscan V2 API: a SINGLE string key works across all chains, Base included.
  // Do NOT use an object ({ base: "..." }) — that forces the deprecated V1 explorer API.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};
