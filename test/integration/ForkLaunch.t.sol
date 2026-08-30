// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {HookMiner} from "../shared/HookMiner.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {BoundedRouter} from "../../src/BoundedRouter.sol";
import {Launchpad} from "../../src/Launchpad.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {InstantParams, CurveParams} from "../../src/interfaces/ILaunchpad.sol";

/// @notice The whole system against the PoolManager that is actually deployed on
/// Robinhood Chain, not a fresh one built in memory. Everything up to here proves
/// the code is self-consistent; this proves it works with what is really there.
contract ForkLaunchTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint256 internal constant MAX_POOL_ETH = 10_000 ether;

    IPoolManager internal manager;
    BoundedRouter internal router;
    Launchpad internal launchpad;
    BlockHook internal hook;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal protocolFees = makeAddr("protocolFees");

    bool internal forked;

    function setUp() public {
        try vm.createSelectFork(vm.rpcUrl("robinhood")) {
            forked = true;
        } catch {
            forked = false;
            return;
        }

        assertEq(block.chainid, 4663, "wrong chain");
        assertGt(POOL_MANAGER.code.length, 0, "PoolManager is not deployed here");
        assertGt(CREATE2_DEPLOYER.code.length, 0, "CREATE2 deployer is missing");

        manager = IPoolManager(POOL_MANAGER);
        router = new BoundedRouter(manager);
        launchpad = new Launchpad(manager, address(router), protocolFees, MAX_POOL_ETH);

        bytes memory args = abi.encode(manager, address(launchpad), address(router));
        (address expected, bytes32 salt) =
            HookMiner.find(address(launchpad), 0x28CC, type(BlockHook).creationCode, args);
        address deployed = launchpad.deployHook(salt);
        assertEq(deployed, expected, "mined salt did not produce the expected address");
        hook = BlockHook(payable(deployed));

        vm.deal(creator, 100_000 ether);
        vm.deal(alice, 100_000 ether);
        vm.deal(bob, 100_000 ether);
    }

    modifier onlyForked() {
        if (!forked) {
            emit log("SKIPPED: the Robinhood Chain RPC is unreachable");
            return;
        }
        _;
    }

    function allBlocksConfig() internal pure returns (BlockConfig memory cfg) {
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
        cfg.potEveryN = 3;
        cfg.potMinBuyWei = 0.1 ether;
    }

    /// The full path of an instant launch with all five blocks on: the guard
    /// window, the pot cycle, a sell, and a fee claim.
    function test_instantLaunchFullLifecycle() public onlyForked {
        vm.prank(creator);
        address token = launchpad.launchInstant{value: 1_000 ether}(
            InstantParams({
                name: "Fork",
                symbol: "FORK",
                cfg: allBlocksConfig(),
                creatorFeeBps: 5_000,
                blueprintId: 0,
                sqrtPriceX96: SQRT_PRICE_1_1
            })
        );
        PoolKey memory key = launchpad.poolKeyOf(token);
        assertGt(manager.getLiquidity(key.toId()), 0);

        // Inside the guard window: a buy at the cap passes, one over it does not.
        uint256 cap = (_ethReserve(key) * 500) / 10_000;
        vm.prank(alice);
        router.buy{value: cap}(key, 0, alice, block.timestamp);

        vm.prank(bob);
        vm.expectRevert();
        router.buy{value: cap * 2}(key, 0, bob, block.timestamp);

        // Outside the window the cap is gone and the pot cycle can complete.
        // Alice's buy above already counted as the first, so the payout lands on
        // the second of these three.
        vm.roll(block.number + 50);
        for (uint256 i; i < 3; i++) {
            vm.roll(block.number + 1);
            vm.prank(bob);
            router.buy{value: 5 ether}(key, 0, bob, block.timestamp);
        }
        assertEq(hook.stateOf(key.toId()).potBuyCount, 4, "four qualifying buys, one per block");
        assertEq(
            hook.potVault().balanceOf(key.toId()),
            (5 ether * 100) / 10_000,
            "emptied on the payout, then refilled by the buy after it"
        );
        assertGt(LaunchToken(token).balanceOf(DEAD), 0, "auto burn fired");

        // Selling back, then claiming the fees that all of it accrued.
        uint256 held = LaunchToken(token).balanceOf(bob);
        vm.startPrank(bob);
        LaunchToken(token).approve(address(router), held);
        router.sell(key, held, 0, bob, block.timestamp);
        vm.stopPrank();

        uint256 creatorBefore = creator.balance;
        launchpad.claimFees(token);
        assertGt(creator.balance, creatorBefore, "the creator earned fees");

        // The three custody rules, on a live PoolManager.
        assertEq(address(hook).balance, 0, "hook holds no ETH");
        assertEq(LaunchToken(token).balanceOf(address(hook)), 0, "hook holds no tokens");
        assertEq(address(router).balance, 0, "router holds nothing");
        assertEq(
            address(hook.potVault()).balance,
            hook.potVault().balanceOf(key.toId()),
            "vault matches its bookkeeping"
        );
    }

    /// A curve sale from the first tranche through graduation and out the far
    /// side, trading in the pool the graduation created.
    function test_curveLaunchThroughGraduation() public onlyForked {
        uint256 p0 = 43_000_000_000;

        vm.prank(creator);
        (address token, address curveAddr) = launchpad.launchCurve(
            CurveParams({
                name: "ForkCurve",
                symbol: "FCRV",
                cfg: allBlocksConfig(),
                creatorFeeBps: 5_000,
                blueprintId: 0,
                p0: p0
            })
        );
        BondingCurve curve = BondingCurve(payable(curveAddr));

        // Walk the first tranches, checking the price steps up as specified.
        vm.prank(alice);
        curve.buy{value: 1 ether}(0, alice);
        assertEq(curve.trancheOf(curve.sold()), 0);

        uint256 toFinish = (curve.totalRaiseAtFullSellout(p0) * 10_000) / 9_900;
        vm.deal(alice, toFinish + 100 ether);
        vm.prank(alice);
        curve.buy{value: toFinish}(0, alice);

        assertTrue(curve.graduated(), "the last tranche graduates in the same tx");
        assertEq(address(curve).balance, 0, "the curve keeps nothing");

        PoolKey memory key = launchpad.poolKeyOf(token);
        assertGt(manager.getLiquidity(key.toId()), 0, "the pool is open");

        // The config survives graduation untouched.
        BlockConfig memory live = hook.configOf(key.toId());
        assertEq(live.lpBps, 200);
        assertEq(live.potBps, 100);
        assertEq(live.burnBps, 500);

        vm.roll(block.number + 50); // past the guard window
        vm.prank(bob);
        assertGt(router.buy{value: 1 ether}(key, 0, bob, block.timestamp), 0, "the pool trades");

        assertEq(address(hook).balance, 0);
        assertEq(address(launchpad).balance, 0);
    }

    function _ethReserve(PoolKey memory key) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        return (uint256(manager.getLiquidity(key.toId())) << 96) / sqrtPriceX96;
    }
}
