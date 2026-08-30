// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockMath} from "../../src/lib/BlockMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

contract BlockHookSurgeTest is Fixtures {
    using PoolIdLibrary for PoolKey;

    PoolKey internal key;
    address internal alice = makeAddr("alice");

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 100_000;
        cfg.surgeSens = 10_000;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function test_tinyBuyPaysBaseFee() public {
        assertEq(expectedFee(0.0001 ether), 3_000);
        assertEq(chargedFee(key, 0.0001 ether, alice), 3_000);
    }

    function test_deepBuyPaysMoreThanBaseFee() public {
        uint24 charged = chargedFee(key, 50 ether, alice);
        assertGt(charged, 3_000);
        assertLe(charged, 100_000);
    }

    function test_chargedFeeMatchesBlockMathExactly() public {
        uint256 amountIn = 7.5 ether;
        uint24 expected = expectedFee(amountIn);
        assertEq(chargedFee(key, amountIn, alice), expected);
    }

    function test_feeSaturatesAtMaxOnAnEnormousBuy() public {
        assertEq(chargedFee(key, 5_000 ether, alice), 100_000);
    }

    /// Sells ride the same fee curve; they simply carry no ETH slices.
    function test_sellIsChargedTooAndNeverBelowBase() public {
        buy(key, 10 ether, alice);
        vm.recordLogs();
        sell(key, 1_000e18, alice);
        assertGe(feeFromLastSwapEvent(), 3_000);
    }

    /// A pool with the block off pays exactly baseFeePips whatever the size.
    function test_surgeOffMeansFlatFee() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 5_000;
        cfg.maxFeePips = 5_000;
        cfg.surgeSens = 0;
        PoolKey memory flat = initSecondPoolWithConfig(cfg);
        addLiquidity(flat, 1000e18);

        assertEq(chargedFee(flat, 0.001 ether, alice), 5_000);
        assertEq(chargedFee(flat, 100 ether, alice), 5_000);
    }

    function expectedFee(uint256 amountIn) internal view returns (uint24) {
        BlockConfig memory cfg = hook.configOf(key.toId());
        return BlockMath.surgeFee(amountIn, ethReserveOf(key), cfg.baseFeePips, cfg.maxFeePips, cfg.surgeSens);
    }
}
