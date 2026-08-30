// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

contract BlockHookPotTest is Fixtures {
    using PoolIdLibrary for PoolKey;

    PoolKey internal key;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint16 internal constant POT_BPS = 100; // 1% of the ETH input
    uint16 internal constant EVERY_N = 3;

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = POT_BPS;
        cfg.potEveryN = EVERY_N;
        cfg.potMinBuyWei = 0.5 ether;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function potOf() internal view returns (uint256) {
        return hook.potVault().balanceOf(key.toId());
    }

    function cutOf(uint256 amountIn) internal pure returns (uint256) {
        return (amountIn * uint256(POT_BPS)) / 10_000;
    }

    /// Each buy in its own block, which is how a real pot accumulates.
    function buyInNewBlock(address who, uint256 amount) internal {
        vm.roll(block.number + 1);
        buy(key, amount, who);
    }

    function test_everyBuyFundsThePot() public {
        buyInNewBlock(alice, 1 ether);
        assertEq(potOf(), cutOf(1 ether));
        assertEq(hook.stateOf(key.toId()).potBalance, cutOf(1 ether));
    }

    /// The winner takes everything accumulated, including their own contribution.
    function test_thirdQualifyingBuyWinsTheWholePot() public {
        buyInNewBlock(alice, 1 ether);
        buyInNewBlock(bob, 1 ether);

        uint256 potBefore = potOf();
        uint256 balBefore = alice.balance;
        buyInNewBlock(alice, 1 ether);

        assertEq(alice.balance - balBefore, potBefore + cutOf(1 ether), "winner takes the whole pot");
        assertEq(potOf(), 0);
        assertEq(hook.stateOf(key.toId()).potBalance, 0);
    }

    function test_buysBelowMinimumFundThePotButDoNotCount() public {
        buyInNewBlock(alice, 0.1 ether); // below potMinBuyWei
        assertEq(hook.stateOf(key.toId()).potBuyCount, 0);
        assertEq(potOf(), cutOf(0.1 ether), "the cut is still taken");
    }

    /// Without this, a sniper sends N-1 dust buys and the Nth big one in a single
    /// block and walks off with the pot.
    function test_counterMovesAtMostOncePerBlock() public {
        vm.roll(100);
        buy(key, 1 ether, alice);
        buy(key, 1 ether, alice);
        buy(key, 1 ether, alice);

        assertEq(hook.stateOf(key.toId()).potBuyCount, 1, "three buys in one block count once");
        assertGt(potOf(), 0, "but all three fund the pot");
    }

    function test_sellsNeitherFundNorCount() public {
        buyInNewBlock(alice, 1 ether);
        uint256 potAfterBuy = potOf();
        uint32 countAfterBuy = hook.stateOf(key.toId()).potBuyCount;

        vm.roll(block.number + 1);
        sell(key, 1_000e18, alice);

        assertEq(potOf(), potAfterBuy);
        assertEq(hook.stateOf(key.toId()).potBuyCount, countAfterBuy);
    }

    function test_vaultAccountingMatchesHookAccounting() public {
        buyInNewBlock(alice, 1 ether);
        buyInNewBlock(bob, 2 ether);
        assertEq(potOf(), hook.stateOf(key.toId()).potBalance);
    }

    function test_hookHoldsNothingAfterAPayout() public {
        buyInNewBlock(alice, 1 ether);
        buyInNewBlock(bob, 1 ether);
        buyInNewBlock(alice, 1 ether);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    function test_potIsPerPoolNotGlobal() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = POT_BPS;
        cfg.potEveryN = EVERY_N;
        PoolKey memory other = initSecondPoolWithConfig(cfg);
        addLiquidity(other, 1000e18);

        buyInNewBlock(alice, 1 ether);

        assertGt(potOf(), 0);
        assertEq(hook.potVault().balanceOf(other.toId()), 0, "pools do not share a pot");
    }

    /// The vault must always hold exactly the sum of what the pools are owed.
    function testFuzz_vaultTotalMatchesSumOfPools(uint96 a, uint96 b) public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = POT_BPS;
        cfg.potEveryN = 1000; // never pays out, so the pot only accumulates
        PoolKey memory other = initSecondPoolWithConfig(cfg);
        addLiquidity(other, 1000e18);

        buyInNewBlock(alice, bound(a, 1e12, 50 ether));
        vm.roll(block.number + 1);
        buy(other, bound(b, 1e12, 50 ether), bob);

        assertEq(
            address(hook.potVault()).balance,
            hook.potVault().balanceOf(key.toId()) + hook.potVault().balanceOf(other.toId())
        );
    }
}
