// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

/// @title BlockMath
/// @notice Every number the five blocks produce. Pure, poolless and mirrored
/// one-for-one by the TypeScript simulator, which a differential test enforces.
library BlockMath {
    uint256 internal constant BPS = 10_000;

    /// @notice ETH-side virtual reserve of the liquidity active at the current price.
    /// @dev ETH is always currency0 (the zero address sorts first), so this is
    /// amount0 = L * 2^96 / sqrtPriceX96. Single source of truth for every block:
    /// there is no separate notion of "pool reserve" anywhere in the system.
    function inRangeEthReserve(uint128 liquidity, uint160 sqrtPriceX96) internal pure returns (uint256) {
        if (liquidity == 0 || sqrtPriceX96 == 0) return 0;
        return FullMath.mulDiv(liquidity, FixedPoint96.Q96, sqrtPriceX96);
    }

    /// @notice Block 2 - Surge Fees. Fee grows linearly with how deep the trade
    /// bites into the in-range reserve, capped at maxFeePips.
    function surgeFee(uint256 amountIn, uint256 reserve, uint24 baseFeePips, uint24 maxFeePips, uint16 surgeSens)
        internal
        pure
        returns (uint24)
    {
        if (reserve == 0 || surgeSens == 0 || maxFeePips <= baseFeePips) return baseFeePips;

        uint256 depthBps = FullMath.mulDiv(amountIn, BPS, reserve);

        // Clamp before multiplying: a trade far larger than the reserve would
        // otherwise overflow, and it saturates the fee anyway.
        uint256 surgeFactor = BPS;
        if (depthBps < type(uint256).max / surgeSens) {
            surgeFactor = (depthBps * surgeSens) / BPS;
            if (surgeFactor > BPS) surgeFactor = BPS;
        }

        return uint24(baseFeePips + ((uint256(maxFeePips - baseFeePips) * surgeFactor) / BPS));
    }

    /// @notice Block 1 - Anti-Snipe. Largest buy allowed inside the guard window.
    function maxBuy(uint256 reserve, uint16 maxBuyBps) internal pure returns (uint256) {
        return (reserve * maxBuyBps) / BPS;
    }

    /// @notice A basis-point slice, rounded down so the pool never loses to rounding.
    function bpsCut(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return (amount * bps) / BPS;
    }
}
