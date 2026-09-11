// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 that taxes every non-mint/non-burn transfer by 2%,
///         simulating a tax-on-all-transfers token for testing.
contract MockFeeOnTransfer is ERC20 {
    address constant DEAD = address(0xdead);
    uint256 public constant FEE_BPS = 200;

    constructor() ERC20("RACKS", "RACKS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Mints (from == 0) and burns (to == 0) are fee-free.
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * FEE_BPS) / 10_000;
        if (fee > 0) {
            super._update(from, DEAD, fee);
        }
        super._update(from, to, value - fee);
    }
}