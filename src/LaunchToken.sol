// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @title LaunchToken
/// @notice Fixed-supply ERC20 minted in full at construction. No owner, no mint,
/// no pause, no blacklist, no transfer fee. Nothing about it can change.
contract LaunchToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    string private _name;
    string private _symbol;

    constructor(string memory name_, string memory symbol_, address recipient) {
        _name = name_;
        _symbol = symbol_;
        _mint(recipient, TOTAL_SUPPLY);
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
