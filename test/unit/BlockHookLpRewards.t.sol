// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {Vm} from "forge-std/Vm.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract BlockHookLpRewardsTest is Fixtures {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolKey internal key;
    address internal alice = makeAddr("alice");
    uint16 internal constant LP_BPS = 200; // 2% of the ETH input to LPs

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = LP_BPS;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function feeGrowth0() internal view returns (uint256 g) {
        (g,) = IPoolManager(address(manager)).getFeeGrowthGlobals(key.toId());
    }

    /// The donation alone contributes lpCut * 2^128 / liquidity; ordinary swap
    /// fees add more on top, so assert the floor.
    function test_buyRaisesFeeGrowthByAtLeastTheLpCut() public {
        uint128 liquidity = IPoolManager(address(manager)).getLiquidity(key.toId());
        uint256 before = feeGrowth0();

        buy(key, 10 ether, alice);

        uint256 lpCut = (10 ether * uint256(LP_BPS)) / 10_000;
        uint256 minDelta = (lpCut << 128) / liquidity;
        assertGe(feeGrowth0() - before, minDelta);
    }

    function test_hookHoldsNothingAfterTheBuy() public {
        buy(key, 10 ether, alice);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    /// The cut comes out of the buyer's input, so the same ETH buys fewer tokens
    /// than it would in an otherwise identical pool with the block switched off.
    function test_buyerReceivesLessTokenBecauseOfTheCut() public {
        BlockConfig memory off = defaultConfig();
        PoolKey memory noCut = initSecondPoolWithConfig(off);
        addLiquidity(noCut, 1000e18);

        uint256 withCut = buy(key, 10 ether, alice);
        uint256 withoutCut = buy(noCut, 10 ether, makeAddr("bob"));

        assertLt(withCut, withoutCut, "the LP cut must come out of the buyer's input");
    }

    /// @dev The hook pays LPs by calling donate(), so the presence or absence of a
    /// Donate event is an exact statement about whether a slice was taken. Fee
    /// growth alone is not: ordinary swap fees move it too.
    function donateAmount0() internal returns (uint256 total) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Donate(bytes32,address,uint256,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == sig && logs[i].topics[2] == bytes32(uint256(uint160(address(hook))))) {
                (uint256 amount0,) = abi.decode(logs[i].data, (uint256, uint256));
                total += amount0;
            }
        }
    }

    function test_buyDonatesExactlyTheLpCut() public {
        vm.recordLogs();
        buy(key, 10 ether, alice);
        assertEq(donateAmount0(), (10 ether * uint256(LP_BPS)) / 10_000);
    }

    function test_sellDonatesNothing() public {
        buy(key, 10 ether, alice);
        vm.recordLogs();
        sell(key, 1_000e18, alice);
        assertEq(donateAmount0(), 0, "sells carry no slice");
    }

    function test_exactOutputBuyDonatesNothing() public {
        vm.recordLogs();
        buyExactOutput(key, 10e18, alice);
        assertEq(donateAmount0(), 0, "exact-output buys carry no slice");
        assertEq(address(hook).balance, 0);
    }

    function testFuzz_hookNeverKeepsAnythingWhateverTheSize(uint96 amountIn) public {
        amountIn = uint96(bound(amountIn, 1e12, 200 ether));
        buy(key, amountIn, alice);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }
}
