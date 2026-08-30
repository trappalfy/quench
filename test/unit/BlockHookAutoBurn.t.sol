// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract BlockHookAutoBurnTest is Fixtures {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    PoolKey internal key;
    address internal alice = makeAddr("alice");
    uint16 internal constant BURN_BPS = 500; // 5% of the token output

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = BURN_BPS;
        cfg.burnTriggerWei = 1 ether;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function test_qualifyingBuySendsShareOfOutputToDeadAddress() public {
        uint256 deadBefore = token.balanceOf(DEAD);
        uint256 out = buy(key, 2 ether, alice);
        uint256 burned = token.balanceOf(DEAD) - deadBefore;

        assertGt(burned, 0);
        // burned is exactly burnBps of the gross output; alice keeps the rest.
        assertEq(burned, ((out + burned) * uint256(BURN_BPS)) / 10_000);
    }

    function test_buyBelowTriggerBurnsNothing() public {
        uint256 deadBefore = token.balanceOf(DEAD);
        buy(key, 0.5 ether, alice);
        assertEq(token.balanceOf(DEAD), deadBefore);
    }

    /// Invariant 7 in miniature: the burn comes out of the buyer's output, and
    /// never out of the pool's reserves.
    function test_burnReducesRecipientOutputNotPoolReserves() public {
        uint256 poolBefore = token.balanceOf(address(manager));
        uint256 deadBefore = token.balanceOf(DEAD);

        uint256 out = buy(key, 2 ether, alice);
        uint256 burned = token.balanceOf(DEAD) - deadBefore;

        assertEq(poolBefore - token.balanceOf(address(manager)), out + burned);
        assertEq(token.balanceOf(alice), out);
    }

    function test_sellBurnsNothing() public {
        uint256 bought = buy(key, 2 ether, alice);
        uint256 deadAfterBuy = token.balanceOf(DEAD);
        sell(key, bought, alice);
        assertEq(token.balanceOf(DEAD), deadAfterBuy);
    }

    function test_exactOutputBuyBurnsNothing() public {
        uint256 deadBefore = token.balanceOf(DEAD);
        buyExactOutput(key, 10e18, alice);
        assertEq(token.balanceOf(DEAD), deadBefore);
    }

    function test_hookHoldsNoTokensAfterBurn() public {
        buy(key, 2 ether, alice);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
    }

    function testFuzz_burnIsAlwaysExactlyBurnBpsOfGrossOutput(uint96 amountIn) public {
        amountIn = uint96(bound(amountIn, 1 ether, 100 ether));
        uint256 deadBefore = token.balanceOf(DEAD);
        uint256 out = buy(key, amountIn, alice);
        uint256 burned = token.balanceOf(DEAD) - deadBefore;
        assertEq(burned, ((out + burned) * uint256(BURN_BPS)) / 10_000);
    }

    /// All five blocks switched on at once, on one pool, in one buy.
    function test_allFiveBlocksTogether() public {
        BlockConfig memory cfg;
        cfg.guardBlocks = 50;
        cfg.maxBuyBps = 500;
        cfg.snipeTaxPips = 10_000;
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 50_000;
        cfg.surgeSens = 10_000;
        cfg.burnBps = 500;
        cfg.burnTriggerWei = 0.1 ether;
        cfg.lpBps = 200;
        cfg.potBps = 100;
        cfg.potEveryN = 5;
        cfg.potMinBuyWei = 0.1 ether;

        PoolKey memory all = initSecondPoolWithConfig(cfg);
        addLiquidity(all, 1000e18);
        vm.roll(block.number + 50); // step outside the guard window

        uint256 deadBefore = token2.balanceOf(DEAD);
        uint256 out = buy(all, 1 ether, alice);

        assertGt(out, 0);
        assertGt(token2.balanceOf(DEAD) - deadBefore, 0, "burn fired");
        assertGt(hook.potVault().balanceOf(all.toId()), 0, "pot funded");
        assertEq(address(hook).balance, 0, "hook keeps no ETH");
        assertEq(token2.balanceOf(address(hook)), 0, "hook keeps no tokens");
    }
}
