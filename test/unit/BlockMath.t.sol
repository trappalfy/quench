// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {BlockMath} from "../../src/lib/BlockMath.sol";

contract BlockMathTest is Test {
    /// A pool at price 1.0 with liquidity L holds L wei of ETH in range.
    function test_inRangeEthReserveAtPriceOne() public pure {
        uint160 sqrtPriceX96 = uint160(FixedPoint96.Q96);
        assertEq(BlockMath.inRangeEthReserve(1e18, sqrtPriceX96), 1e18);
    }

    /// Price 4.0 means sqrtPrice 2.0, and the ETH side halves.
    function test_inRangeEthReserveScalesInverselyWithSqrtPrice() public pure {
        uint160 sqrtPriceX96 = uint160(2 * FixedPoint96.Q96);
        assertEq(BlockMath.inRangeEthReserve(1e18, sqrtPriceX96), 0.5e18);
    }

    function test_inRangeEthReserveIsZeroOnUninitializedPool() public pure {
        assertEq(BlockMath.inRangeEthReserve(0, uint160(FixedPoint96.Q96)), 0);
        assertEq(BlockMath.inRangeEthReserve(1e18, 0), 0);
    }

    function test_surgeFeeIsBaseWhenTradeIsInfinitesimal() public pure {
        assertEq(BlockMath.surgeFee(1, 1_000e18, 3_000, 100_000, 10_000), 3_000);
    }

    /// depthBps = 1000 (10% of reserve), surgeSens = 10000 (1x)
    /// surgeFactor = 1000 * 10000 / 10000 = 1000
    /// fee = 3000 + (100000 - 3000) * 1000 / 10000 = 3000 + 9700 = 12700
    function test_surgeFeeInterpolatesLinearly() public pure {
        assertEq(BlockMath.surgeFee(100e18, 1_000e18, 3_000, 100_000, 10_000), 12_700);
    }

    function test_surgeFeeSaturatesAtMax() public pure {
        assertEq(BlockMath.surgeFee(10_000e18, 1_000e18, 3_000, 100_000, 10_000), 100_000);
    }

    function test_surgeFeeIsBaseWhenBlockIsOff() public pure {
        assertEq(BlockMath.surgeFee(100e18, 1_000e18, 3_000, 100_000, 0), 3_000);
        assertEq(BlockMath.surgeFee(100e18, 1_000e18, 3_000, 3_000, 10_000), 3_000);
    }

    function test_surgeFeeIsBaseOnEmptyPool() public pure {
        assertEq(BlockMath.surgeFee(100e18, 0, 3_000, 100_000, 10_000), 3_000);
    }

    /// The clamp must hold even for a trade astronomically larger than the reserve,
    /// where depthBps * surgeSens would overflow a naive implementation.
    function test_surgeFeeDoesNotOverflowOnAbsurdDepth() public pure {
        assertEq(BlockMath.surgeFee(type(uint128).max, 1, 3_000, 100_000, 65_535), 100_000);
    }

    function test_maxBuyAndBpsCut() public pure {
        assertEq(BlockMath.maxBuy(1_000e18, 100), 10e18);
        assertEq(BlockMath.bpsCut(1_000e18, 250), 25e18);
        assertEq(BlockMath.bpsCut(1_000e18, 0), 0);
    }

    /// Rounding must always favour the pool, never the trader.
    function test_bpsCutRoundsDown() public pure {
        assertEq(BlockMath.bpsCut(9_999, 1), 0);
        assertEq(BlockMath.bpsCut(10_001, 1), 1);
    }

    function testFuzz_surgeFeeStaysWithinBounds(
        uint128 amountIn,
        uint128 reserve,
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint16 surgeSens
    ) public pure {
        baseFeePips = uint24(bound(baseFeePips, 0, 100_000));
        maxFeePips = uint24(bound(maxFeePips, baseFeePips, 100_000));
        uint24 fee = BlockMath.surgeFee(amountIn, reserve, baseFeePips, maxFeePips, surgeSens);
        assertGe(fee, baseFeePips);
        assertLe(fee, maxFeePips);
    }

    function testFuzz_bpsCutNeverExceedsAmount(uint128 amount, uint16 bps) public pure {
        bps = uint16(bound(bps, 0, 10_000));
        assertLe(BlockMath.bpsCut(amount, bps), amount);
    }
}
