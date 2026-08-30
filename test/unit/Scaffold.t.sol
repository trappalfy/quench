// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";

contract ScaffoldTest is Test {
    /// The whole deployment strategy rests on this number. If v4-core ever
    /// renumbers a flag, this test fails before anything else does.
    function test_hookFlagBitmapIs0x28CC() public pure {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        assertEq(flags, uint160(0x28CC));
    }

    function test_transientStorageIsAvailable() public {
        uint256 slot = 0x1234;
        uint256 read;
        assembly ("memory-safe") {
            tstore(slot, 42)
            read := tload(slot)
        }
        assertEq(read, 42, "cancun transient storage required");
    }

    function test_blockConfigFitsExpectedShape() public pure {
        BlockConfig memory c;
        c.guardBlocks = type(uint32).max;
        c.maxFeePips = 100_000;
        assertEq(c.guardBlocks, type(uint32).max);
        assertEq(c.maxFeePips, 100_000);
    }
}
