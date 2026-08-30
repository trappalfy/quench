// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixtures} from "../shared/SystemFixtures.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {LaunchRecord} from "../../src/interfaces/ILaunchpad.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

contract BondingCurveTest is SystemFixtures {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// Chosen so a full sellout raises about 986 ETH, inside the pool cap.
    uint256 internal constant P0 = 43_000_000_000;

    BondingCurve internal curve;
    LaunchToken internal curveToken;

    function setUp() public {
        deploySystem();
        vm.prank(creator);
        (address token, address curveAddr) = launchpad.launchCurve(curveParams(defaultConfig(), P0));
        curve = BondingCurve(payable(curveAddr));
        curveToken = LaunchToken(token);
    }

    // --- the price table ---

    /// Exact, not approximate: 1.7^i * 1e18 == 17^i * 10^(18-i).
    function test_powerTableIsExact() public view {
        for (uint8 i = 0; i < 10; i++) {
            assertEq(curve.POW17(i), (17 ** uint256(i)) * (10 ** (18 - uint256(i))));
        }
    }

    function test_powerTableSumMatchesTheTable() public view {
        uint256 sum;
        for (uint8 i = 0; i < 10; i++) {
            sum += curve.POW17(i);
        }
        assertEq(sum, curve.POW17_SUM());
        assertEq(sum, 286_570557207000000000);
    }

    function test_fullSelloutCollectsTheSpecAmount() public view {
        uint256 expected = FullMath.mulDiv(P0, 80_000_000 * curve.POW17_SUM(), 1e18);
        assertEq(curve.totalRaiseAtFullSellout(P0), expected);
    }

    function test_trancheBoundaries() public view {
        assertEq(curve.trancheOf(0), 0);
        assertEq(curve.trancheOf(80_000_000e18 - 1), 0);
        assertEq(curve.trancheOf(80_000_000e18), 1);
        assertEq(curve.trancheOf(800_000_000e18 - 1), 9);
        assertEq(curve.trancheOf(800_000_000e18), 9, "clamped at the last tranche");
    }

    function test_eachTrancheIs1_7TimesThePrevious() public view {
        for (uint8 i = 1; i < 10; i++) {
            assertEq(curve.priceOfTranche(i), (curve.priceOfTranche(i - 1) * 17) / 10);
        }
    }

    // --- setup ---

    function test_curveHoldsExactlyEightyPercentOfSupply() public view {
        assertEq(curveToken.balanceOf(address(curve)), 800_000_000e18);
        assertEq(curveToken.balanceOf(address(launchpad)), 200_000_000e18);
    }

    function test_cloneCannotBeReinitialized() public {
        vm.expectRevert(BondingCurve.AlreadyInitialized.selector);
        vm.prank(address(launchpad));
        curve.initialize(address(curveToken), P0, creator);
    }

    // --- buying ---

    function test_buyInsideOneTranchePaysThatTranchePrice() public {
        uint256 ethIn = 1 ether;
        uint256 net = ethIn - (ethIn * 100) / 10_000;
        uint256 expected = FullMath.mulDiv(net, 1e18, curve.priceOfTranche(0));

        vm.prank(alice);
        uint256 out = curve.buy{value: ethIn}(0, alice);

        assertEq(out, expected);
        assertEq(curveToken.balanceOf(alice), out);
    }

    function test_quoteMatchesExecution() public {
        (uint256 quoted,,) = curve.quoteBuy(7 ether);
        vm.prank(alice);
        assertEq(curve.buy{value: 7 ether}(0, alice), quoted);
    }

    /// Enough to empty tranche 0 and buy exactly half of tranche 1: the second
    /// half-tranche costs 1.7x as much per token, which is the whole point.
    function test_buyCrossingATrancheBoundaryPaysBothPrices() public {
        uint256 cost0 = FullMath.mulDiv(80_000_000e18, curve.priceOfTranche(0), 1e18);
        uint256 cost1Half = FullMath.mulDiv(40_000_000e18, curve.priceOfTranche(1), 1e18);
        uint256 gross = ((cost0 + cost1Half) * 10_000) / 9_900;

        vm.prank(alice);
        uint256 out = curve.buy{value: gross}(0, alice);

        assertApproxEqRel(out, 120_000_000e18, 0.0001e18, "80M at price 0 plus 40M at price 1");
        assertEq(curve.trancheOf(curve.sold()), 1);

        // The same ETH spent entirely in tranche 0 would have bought more tokens.
        assertLt(out, FullMath.mulDiv(cost0 + cost1Half, 1e18, curve.priceOfTranche(0)));
    }

    function test_feeIsOnePercentSplitEvenly() public {
        uint256 creatorBefore = creator.balance;
        uint256 protocolBefore = protocolFeeRecipient.balance;

        vm.prank(alice);
        curve.buy{value: 100 ether}(0, alice);

        uint256 fee = (100 ether * 100) / 10_000;
        assertEq(creator.balance - creatorBefore, fee / 2);
        assertEq(protocolFeeRecipient.balance - protocolBefore, fee - fee / 2);
    }

    function test_curveHoldsExactlyWhatItRaised() public {
        vm.prank(alice);
        curve.buy{value: 100 ether}(0, alice);
        assertEq(address(curve).balance, curve.raised());
    }

    // --- selling ---

    function test_sellReturnsEthMinusTheFee() public {
        vm.prank(alice);
        uint256 bought = curve.buy{value: 10 ether}(0, alice);

        uint256 balBefore = alice.balance;
        vm.startPrank(alice);
        curveToken.approve(address(curve), bought);
        uint256 ethOut = curve.sell(bought, 0);
        vm.stopPrank();

        assertEq(alice.balance - balBefore, ethOut);
        assertEq(curve.sold(), 0, "the tokens went back onto the curve");
        // A buy then a sell costs exactly the two 1% fees.
        assertApproxEqRel(ethOut, 10 ether * 9_900 / 10_000 * 9_900 / 10_000, 0.0001e18);
    }

    // --- graduation ---

    function sellOutTheCurve() internal {
        uint256 gross = (curve.totalRaiseAtFullSellout(P0) * 10_000) / 9_900 + 1 ether;
        vm.deal(alice, gross);
        vm.prank(alice);
        curve.buy{value: gross}(0, alice);
        require(curve.graduated(), "curve did not graduate");
    }

    function test_graduationHappensInTheSameTxAsTheLastTranche() public {
        sellOutTheCurve();

        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        assertGt(liquidityOf(key), 0, "the pool is open and funded");
        assertEq(address(curve).balance, 0, "the curve keeps nothing");
        assertEq(curve.raised(), 0);
        assertTrue(launchpad.launchRecord(address(curveToken)).graduated);
    }

    function test_graduationPriceIsP0TimesOnePointSevenToTheNinth() public {
        sellOutTheCurve();

        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        (uint160 sqrtPriceX96,,,) = IPoolManager(address(manager)).getSlot0(key.toId());

        uint256 priceFinal = FullMath.mulDiv(P0, curve.POW17(9), 1e18);
        uint256 expected = FixedPointMathLib.sqrt(FullMath.mulDiv(1e18, 1 << 192, priceFinal));

        assertApproxEqAbs(uint256(sqrtPriceX96), expected, 1, "one unit of integer sqrt rounding, no more");
    }

    function test_graduatedPoolCarriesTheLaunchConfig() public {
        BlockConfig memory launched = launchpad.launchRecord(address(curveToken)).cfg;
        sellOutTheCurve();

        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        BlockConfig memory live = hook.configOf(key.toId());

        assertEq(live.baseFeePips, launched.baseFeePips);
        assertEq(live.maxFeePips, launched.maxFeePips);
        assertEq(live.surgeSens, launched.surgeSens);
    }

    function test_curveCannotBeTradedAfterGraduation() public {
        sellOutTheCurve();

        vm.prank(bob);
        vm.expectRevert(BondingCurve.AlreadyGraduated.selector);
        curve.buy{value: 1 ether}(0, bob);

        vm.prank(alice);
        vm.expectRevert(BondingCurve.AlreadyGraduated.selector);
        curve.sell(1e18, 0);
    }

    function test_graduatedPoolIsTradeable() public {
        sellOutTheCurve();
        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        assertGt(buy(key, 1 ether, bob), 0, "the pool trades after graduation");
    }

    function test_launchpadParksNothingAfterGraduation() public {
        sellOutTheCurve();
        assertEq(address(launchpad).balance, 0);
        assertEq(curveToken.balanceOf(address(launchpad)), 0);
    }

    function test_curveLaunchAboveThePoolCapIsRejected() public {
        // A p0 whose full sellout would exceed maxPoolEthWei.
        uint256 hugeP0 = P0 * 100;
        vm.prank(creator);
        vm.expectRevert();
        launchpad.launchCurve(curveParams(defaultConfig(), hugeP0));
    }
}
