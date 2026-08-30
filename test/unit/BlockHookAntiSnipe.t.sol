// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

contract BlockHookAntiSnipeTest is Fixtures {
    using PoolIdLibrary for PoolKey;

    PoolKey internal key;
    address internal alice = makeAddr("alice");
    uint32 internal constant GUARD = 100;
    uint16 internal constant MAX_BUY_BPS = 100; // 1% of the in-range reserve

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = GUARD;
        cfg.maxBuyBps = MAX_BUY_BPS;
        cfg.snipeTaxPips = 20_000; // +2%
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function capNow() internal view returns (uint256) {
        return (ethReserveOf(key) * MAX_BUY_BPS) / 10_000;
    }

    function test_buyAtTheCapSucceedsInsideTheWindow() public {
        buy(key, capNow(), alice);
    }

    function test_buyOneWeiOverTheCapRevertsInsideTheWindow() public {
        uint256 over = capNow() + 1;
        vm.deal(alice, over);
        vm.prank(alice);
        vm.expectRevert();
        boundedRouter.buy{value: over}(key, 0, alice, block.timestamp);
    }

    function test_capNoLongerAppliesAfterTheWindow() public {
        uint256 big = capNow() * 50;
        vm.roll(block.number + GUARD);
        buy(key, big, alice);
    }

    function test_snipeTaxIsAddedInsideTheWindowOnly() public {
        uint24 inside = chargedFee(key, 0.0001 ether, alice);
        vm.roll(block.number + GUARD);
        uint24 outside = chargedFee(key, 0.0001 ether, alice);
        assertEq(inside - outside, 20_000, "snipe tax must be exactly snipeTaxPips");
    }

    /// The guard bounds buys. A sell of any size must pass.
    function test_guardAppliesToBuysOnlyNotSells() public {
        buy(key, capNow(), alice);
        sell(key, 100_000e18, alice);
    }

    function test_windowBoundaryIsExclusiveAtStartPlusGuard() public {
        uint64 start = hook.stateOf(key.toId()).startBlock;

        vm.roll(start + GUARD - 1); // last guarded block
        uint256 over = capNow() + 1;
        vm.deal(alice, over);
        vm.prank(alice);
        vm.expectRevert();
        boundedRouter.buy{value: over}(key, 0, alice, block.timestamp);

        vm.roll(start + GUARD); // first free block
        buy(key, over * 10, alice);
    }

    /// A pool with the block off has no cap and no tax at any block height.
    function test_guardOffMeansNoCapAndNoTax() public {
        BlockConfig memory cfg = defaultConfig();
        PoolKey memory free = initSecondPoolWithConfig(cfg);
        addLiquidity(free, 1000e18);

        uint24 fee = chargedFee(free, 0.0001 ether, alice);
        assertEq(fee, 3_000, "no snipe tax when the block is off");
        buy(free, 500 ether, alice);
    }
}
