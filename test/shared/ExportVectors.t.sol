// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BlockMath} from "../../src/lib/BlockMath.sol";

/// @notice Writes a set of Solidity-computed vectors to disk so the TypeScript
/// simulator can be checked against them. Not a test of behaviour: the assertion
/// that matters lives on the TypeScript side, in ts/test/simulate.diff.test.ts.
contract ExportVectorsTest is Test {
    struct Vector {
        uint256 amountIn;
        uint256 reserve;
        uint256 liquidity;
        uint256 sqrtPriceX96;
        uint24 baseFeePips;
        uint24 maxFeePips;
        uint16 surgeSens;
        uint16 lpBps;
        uint16 potBps;
        uint16 maxBuyBps;
        uint24 expectedFeePips;
        uint256 expectedLpCut;
        uint256 expectedPotCut;
        uint256 expectedMaxBuy;
        uint256 expectedReserve;
    }

    /// @dev Written line by line: accumulating 2000 objects into one string is
    /// quadratic in memory and runs the EVM out of gas.
    function test_exportVectors() public {
        uint256 count = 2000;
        string memory path = "ts/test/vectors.json";

        vm.writeFile(path, "[");
        for (uint256 i; i < count; i++) {
            string memory line = _encode(_vector(i));
            if (i + 1 < count) line = string.concat(line, ",");
            vm.writeLine(path, line);
        }
        vm.writeLine(path, "]");

        assertGt(bytes(vm.readFile(path)).length, 1000);
    }

    function _vector(uint256 seed) internal pure returns (Vector memory v) {
        uint256 h = uint256(keccak256(abi.encode(seed)));

        v.amountIn = (h % 1e24) + 1;
        v.reserve = ((h >> 32) % 1e24) + 1;
        v.liquidity = ((h >> 64) % 1e24) + 1;
        // Keep the sqrt price inside the range v4 itself accepts.
        v.sqrtPriceX96 = ((h >> 96) % 1e29) + 4295128740;
        v.baseFeePips = uint24((h >> 128) % 100_001);
        v.maxFeePips = uint24(v.baseFeePips + ((h >> 144) % (100_001 - v.baseFeePips)));
        v.surgeSens = uint16((h >> 160) % 65_536);
        v.lpBps = uint16((h >> 176) % 1_001);
        v.potBps = uint16((h >> 192) % 1_001);
        v.maxBuyBps = uint16(((h >> 208) % 10_000) + 1);

        v.expectedFeePips =
            BlockMath.surgeFee(v.amountIn, v.reserve, v.baseFeePips, v.maxFeePips, v.surgeSens);
        v.expectedLpCut = BlockMath.bpsCut(v.amountIn, v.lpBps);
        v.expectedPotCut = BlockMath.bpsCut(v.amountIn, v.potBps);
        v.expectedMaxBuy = BlockMath.maxBuy(v.reserve, v.maxBuyBps);
        v.expectedReserve = BlockMath.inRangeEthReserve(uint128(v.liquidity), uint160(v.sqrtPriceX96));
    }

    function _encode(Vector memory v) internal pure returns (string memory) {
        return string.concat(
            '{"amountIn":"',
            vm.toString(v.amountIn),
            '","reserve":"',
            vm.toString(v.reserve),
            '","liquidity":"',
            vm.toString(v.liquidity),
            '","sqrtPriceX96":"',
            vm.toString(v.sqrtPriceX96),
            '","baseFeePips":',
            vm.toString(uint256(v.baseFeePips)),
            ',"maxFeePips":',
            vm.toString(uint256(v.maxFeePips)),
            ',"surgeSens":',
            vm.toString(uint256(v.surgeSens)),
            ',"lpBps":',
            vm.toString(uint256(v.lpBps)),
            ',"potBps":',
            vm.toString(uint256(v.potBps)),
            ',"maxBuyBps":',
            vm.toString(uint256(v.maxBuyBps)),
            _encodeExpected(v)
        );
    }

    function _encodeExpected(Vector memory v) internal pure returns (string memory) {
        return string.concat(
            ',"expectedFeePips":',
            vm.toString(uint256(v.expectedFeePips)),
            ',"expectedLpCut":"',
            vm.toString(v.expectedLpCut),
            '","expectedPotCut":"',
            vm.toString(v.expectedPotCut),
            '","expectedMaxBuy":"',
            vm.toString(v.expectedMaxBuy),
            '","expectedReserve":"',
            vm.toString(v.expectedReserve),
            '"}'
        );
    }
}
