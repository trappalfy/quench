// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

/// @title LiquidityAmounts
/// @notice Converts a pair of token amounts into the liquidity they support.
/// @dev Vendored from Uniswap's periphery, which we do not depend on: its main
/// branch expects core types that postdate the v4.0.0 release we build against.
library LiquidityAmounts {
    function getLiquidityForAmount0(uint160 sqrtA, uint160 sqrtB, uint256 amount0)
        internal
        pure
        returns (uint128)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        uint256 intermediate = FullMath.mulDiv(sqrtA, sqrtB, FixedPoint96.Q96);
        return uint128(FullMath.mulDiv(amount0, intermediate, sqrtB - sqrtA));
    }

    function getLiquidityForAmount1(uint160 sqrtA, uint160 sqrtB, uint256 amount1)
        internal
        pure
        returns (uint128)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        return uint128(FullMath.mulDiv(amount1, FixedPoint96.Q96, sqrtB - sqrtA));
    }

    /// @notice The largest liquidity both amounts can support at the given price.
    function getLiquidityForAmounts(
        uint160 sqrtPriceX96,
        uint160 sqrtA,
        uint160 sqrtB,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);

        if (sqrtPriceX96 <= sqrtA) {
            liquidity = getLiquidityForAmount0(sqrtA, sqrtB, amount0);
        } else if (sqrtPriceX96 < sqrtB) {
            uint128 l0 = getLiquidityForAmount0(sqrtPriceX96, sqrtB, amount0);
            uint128 l1 = getLiquidityForAmount1(sqrtA, sqrtPriceX96, amount1);
            liquidity = l0 < l1 ? l0 : l1;
        } else {
            liquidity = getLiquidityForAmount1(sqrtA, sqrtB, amount1);
        }
    }
}
