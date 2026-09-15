// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Imported so Hardhat compiles OpenZeppelin's VestingWallet artifact for
// scripts/lock-team.js. Not deployed itself — lock-team deploys VestingWallet.
import "@openzeppelin/contracts/finance/VestingWallet.sol";
