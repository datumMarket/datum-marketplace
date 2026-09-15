// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DatumMarketplace — payment router for agent-to-agent data sales
/// @notice Buyers approve this contract, then `purchase()` pulls payment:
///         fee skims to treasury, remainder forwards to seller, one event
///         emits for off-chain verification. Fee is owner-adjustable but
///         hard-capped at MAX_FEE_BPS — trust-preserving flexibility.
contract DatumMarketplace is Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 1000; // 10% hard cap, never changeable
    IERC20 public immutable token;
    address public treasury;
    uint16 public feeBps; // 250 = 2.5%

    event Purchase(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 fee
    );
    event FeeUpdated(uint16 newFeeBps);
    event TreasuryUpdated(address newTreasury);

    constructor(address token_, address treasury_, uint16 feeBps_) Ownable(msg.sender) {
        require(token_ != address(0), "token=0");
        require(treasury_ != address(0), "treasury=0");
        require(feeBps_ <= MAX_FEE_BPS, "fee>cap");
        token = IERC20(token_);
        treasury = treasury_;
        feeBps = feeBps_;
    }

    /// @notice Buy a listing. Buyer must have approved this contract for `amount`.
    function purchase(uint256 listingId, address seller, uint256 amount) external {
        require(seller != address(0), "seller=0");
        require(amount > 0, "amount=0");

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 toSeller = amount - fee;

        // effects before interactions: no state mutated above, so no reentrancy window
        token.safeTransferFrom(msg.sender, seller, toSeller);
        token.safeTransferFrom(msg.sender, treasury, fee);

        emit Purchase(listingId, msg.sender, seller, amount, fee);
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "fee>cap");
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }
}
