// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Datum (DTM) — agent data marketplace utility token
/// @notice Fixed supply, minted entirely to the deployer at construction.
///         No mint function exists — supply can never increase.
contract DatumToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Datum", "DTM") {
        _mint(msg.sender, initialSupply);
    }
}
