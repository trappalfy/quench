// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixtures} from "../shared/SystemFixtures.sol";
import {Launchpad} from "../../src/Launchpad.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {LaunchRecord, Blueprint, InstantParams} from "../../src/interfaces/ILaunchpad.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

contract LaunchpadTest is SystemFixtures {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function setUp() public {
        deploySystem();
    }

    // --- hook deployment ---

    function test_deployHookLandsOnFlaggedAddress() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, 0x28CC);
        assertEq(hook.launchpad(), address(launchpad));
        assertEq(hook.router(), address(router));
    }

    function test_deployHookIsOneShot() public {
        vm.expectRevert(Launchpad.HookAlreadyDeployed.selector);
        launchpad.deployHook(bytes32(uint256(1)));
    }

    // --- instant launches ---

    function test_launchInstantOpensAPoolWithTheConfig() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 150;
        cfg.burnBps = 200;
        cfg.burnTriggerWei = 1 ether;

        InstantParams memory p = instantParams(cfg);
        vm.prank(creator);
        address token = launchpad.launchInstant{value: 100 ether}(p);

        PoolKey memory key = launchpad.poolKeyOf(token);
        assertGt(liquidityOf(key), 0, "pool has liquidity");

        BlockConfig memory live = hook.configOf(key.toId());
        assertEq(live.lpBps, 150);
        assertEq(live.burnBps, 200);
        assertEq(live.burnTriggerWei, 1 ether);
    }

    function test_launchInstantRecordsTheLaunch() public {
        (address token,) = launchInstant(100 ether);

        assertEq(launchpad.launchCount(), 1);
        assertEq(launchpad.tokenAt(0), token);

        LaunchRecord memory rec = launchpad.launchRecord(token);
        assertEq(rec.token, token);
        assertEq(rec.creator, creator);
        assertEq(rec.launchBlock, uint64(block.number));
        assertEq(rec.curve, address(0));
        assertTrue(rec.graduated);
    }

    function test_launchAboveMaxPoolEthIsRejected() public {
        vm.prank(creator);
        vm.expectRevert(Launchpad.PoolTooLarge.selector);
        launchpad.launchInstant{value: MAX_POOL_ETH + 1}(instantParams(defaultConfig()));
    }

    function test_creatorFeeAbove8000IsRejected() public {
        InstantParams memory p = instantParams(defaultConfig());
        p.creatorFeeBps = 8_001;
        vm.prank(creator);
        vm.expectRevert(Launchpad.CreatorFeeTooHigh.selector);
        launchpad.launchInstant{value: 1 ether}(p);
    }

    /// The launchpad keeps neither ETH nor tokens: leftovers go back to the
    /// creator or to the dead address, and only the LP position remains.
    function test_launchpadHoldsNothingAfterALaunch() public {
        (address token,) = launchInstant(100 ether);
        assertEq(address(launchpad).balance, 0, "no ETH parked");
        assertEq(LaunchToken(token).balanceOf(address(launchpad)), 0, "no tokens parked");
    }

    function test_surplusTokensAreBurnedNotParked() public {
        (address token,) = launchInstant(100 ether);
        assertGt(LaunchToken(token).balanceOf(DEAD), 0, "the unusable side is burned");
    }

    // --- blueprints ---

    function test_blueprintZeroIsASentinel() public view {
        assertEq(launchpad.blueprintCount(), 1);
        assertEq(launchpad.blueprintAt(0).author, address(0));
    }

    function test_publishBlueprintAssignsIncrementingIdsFromOne() public {
        BlockConfig memory cfg = defaultConfig();
        vm.prank(alice);
        uint256 first = launchpad.publishBlueprint(cfg, 500);
        assertEq(first, 1, "index 0 is reserved");

        vm.prank(bob);
        assertEq(launchpad.publishBlueprint(cfg, 100), 2);

        Blueprint memory bp = launchpad.blueprintAt(1);
        assertEq(bp.author, alice);
        assertEq(bp.royaltyBps, 500);
    }

    function test_royaltyAbove2000IsRejected() public {
        vm.expectRevert(Launchpad.RoyaltyTooHigh.selector);
        launchpad.publishBlueprint(defaultConfig(), 2_001);
    }

    function test_launchWithBlueprintUsesTheBlueprintConfig() public {
        BlockConfig memory bpCfg = defaultConfig();
        bpCfg.lpBps = 777;
        vm.prank(alice);
        uint256 id = launchpad.publishBlueprint(bpCfg, 500);

        InstantParams memory p = instantParams(defaultConfig()); // own cfg has lpBps 0
        p.blueprintId = uint64(id);
        vm.prank(creator);
        address token = launchpad.launchInstant{value: 100 ether}(p);

        assertEq(hook.configOf(launchpad.poolKeyOf(token).toId()).lpBps, 777);
    }

    // --- fees ---

    function test_claimFeesSplitsEthAndBurnsTheTokenSide() public {
        (address token, PoolKey memory key) = launchInstant(1_000 ether);

        buy(key, 50 ether, alice);
        sell(key, LaunchToken(token).balanceOf(alice), alice);

        uint256 creatorBefore = creator.balance;
        uint256 protocolBefore = protocolFeeRecipient.balance;
        uint256 deadBefore = LaunchToken(token).balanceOf(DEAD);

        launchpad.claimFees(token);

        uint256 toCreator = creator.balance - creatorBefore;
        uint256 toProtocol = protocolFeeRecipient.balance - protocolBefore;

        assertGt(toCreator, 0, "creator is paid");
        assertGt(toProtocol, 0, "protocol is paid");
        // creatorFeeBps is 5000, so the two ETH shares differ by at most rounding.
        assertApproxEqAbs(toCreator, toProtocol, 1);
        assertGt(LaunchToken(token).balanceOf(DEAD) - deadBefore, 0, "token side burned");
        assertEq(address(launchpad).balance, 0);
    }

    function test_claimFeesPaysTheBlueprintAuthorFirst() public {
        BlockConfig memory cfg = defaultConfig();
        vm.prank(alice);
        uint256 id = launchpad.publishBlueprint(cfg, 2_000); // 20% royalty

        InstantParams memory p = instantParams(cfg);
        p.blueprintId = uint64(id);
        vm.prank(creator);
        address token = launchpad.launchInstant{value: 1_000 ether}(p);
        PoolKey memory key = launchpad.poolKeyOf(token);

        buy(key, 50 ether, bob);

        uint256 authorBefore = alice.balance;
        uint256 creatorBefore = creator.balance;
        launchpad.claimFees(token);

        uint256 toAuthor = alice.balance - authorBefore;
        uint256 toCreator = creator.balance - creatorBefore;
        assertGt(toAuthor, 0, "author earns a royalty");
        // 20% royalty, then 50% of the rest: the creator gets twice the author.
        assertApproxEqRel(toCreator, toAuthor * 2, 0.01e18);
    }

    /// Invariant 8, asserted directly: collecting fees leaves the position alone.
    function test_claimFeesLeavesThePositionBodyUntouched() public {
        (address token, PoolKey memory key) = launchInstant(1_000 ether);
        buy(key, 50 ether, alice);

        uint128 before = liquidityOf(key);
        launchpad.claimFees(token);
        assertEq(liquidityOf(key), before, "the LP body must never move");
    }

    function test_claimFeesOnUnknownTokenReverts() public {
        vm.expectRevert(Launchpad.UnknownToken.selector);
        launchpad.claimFees(address(0xDEAD1));
    }

    /// The lock is structural: no function exists that could remove liquidity.
    function test_thereIsNoFunctionThatRemovesLiquidity() public view {
        bytes4[6] memory forbidden = [
            bytes4(keccak256("withdraw()")),
            bytes4(keccak256("removeLiquidity(address)")),
            bytes4(keccak256("emergencyExit()")),
            bytes4(keccak256("owner()")),
            bytes4(keccak256("rescue(address,uint256)")),
            bytes4(keccak256("setHook(address)"))
        ];
        for (uint256 i; i < forbidden.length; i++) {
            (bool ok,) = address(launchpad).staticcall(abi.encodeWithSelector(forbidden[i]));
            assertFalse(ok, "launchpad exposes an escape hatch");
        }
    }

    function test_onlyTheCurveCanGraduateItsToken() public {
        (address token,) = launchInstant(100 ether);
        vm.expectRevert(Launchpad.NotTheCurve.selector);
        launchpad.graduate(token, SQRT_PRICE_1_1);
    }
}
