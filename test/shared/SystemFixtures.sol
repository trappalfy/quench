// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {HookMiner} from "./HookMiner.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {BoundedRouter} from "../../src/BoundedRouter.sol";
import {Launchpad} from "../../src/Launchpad.sol";
import {HookDeployer} from "../../src/hook/HookDeployer.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {InstantParams, CurveParams} from "../../src/interfaces/ILaunchpad.sol";

/// @notice The whole system, wired exactly the way the deploy script wires it.
abstract contract SystemFixtures is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2^96
    uint160 internal constant HOOK_FLAGS = 0x28CC;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MAX_POOL_ETH = 10_000 ether;

    PoolManager internal manager;
    BoundedRouter internal router;
    Launchpad internal launchpad;
    BlockHook internal hook;
    HookDeployer internal hookDeployer;
    address internal protocolFeeRecipient = makeAddr("protocolFees");

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    /// Mirrors script/Deploy.s.sol: router, launchpad, mined salt, deployHook.
    function deploySystem() internal {
        manager = new PoolManager(address(this));
        router = new BoundedRouter(IPoolManager(address(manager)));
        hookDeployer = new HookDeployer(IPoolManager(address(manager)));
        launchpad = new Launchpad(
            IPoolManager(address(manager)), address(router), protocolFeeRecipient, MAX_POOL_ETH, hookDeployer
        );

        // The HookDeployer is the CREATE2 deployer, so the salt is mined against it.
        bytes memory args = abi.encode(IPoolManager(address(manager)), address(launchpad), address(router));
        (address expected, bytes32 salt) =
            HookMiner.find(address(hookDeployer), HOOK_FLAGS, type(BlockHook).creationCode, args);

        address deployed = launchpad.deployHook(salt);
        require(deployed == expected, "system: hook address mismatch");
        hook = BlockHook(payable(deployed));

        vm.deal(creator, 100_000 ether);
        vm.deal(alice, 100_000 ether);
        vm.deal(bob, 100_000 ether);
    }

    function defaultConfig() internal pure returns (BlockConfig memory cfg) {
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 30_000;
        cfg.surgeSens = 10_000;
    }

    function instantParams(BlockConfig memory cfg) internal pure returns (InstantParams memory) {
        return InstantParams({
            name: "Instant",
            symbol: "INST",
            cfg: cfg,
            creatorFeeBps: 5_000,
            blueprintId: 0,
            sqrtPriceX96: SQRT_PRICE_1_1
        });
    }

    function curveParams(BlockConfig memory cfg, uint256 p0) internal pure returns (CurveParams memory) {
        return CurveParams({
            name: "Curved",
            symbol: "CURV",
            cfg: cfg,
            creatorFeeBps: 5_000,
            blueprintId: 0,
            p0: p0
        });
    }

    function launchInstant(uint256 ethIn) internal returns (address token, PoolKey memory key) {
        vm.prank(creator);
        token = launchpad.launchInstant{value: ethIn}(instantParams(defaultConfig()));
        key = launchpad.poolKeyOf(token);
    }

    function buy(PoolKey memory key, uint256 amountIn, address who) internal returns (uint256 out) {
        vm.prank(who);
        out = router.buy{value: amountIn}(key, 0, who, block.timestamp);
    }

    function sell(PoolKey memory key, uint256 amountIn, address who) internal returns (uint256 ethOut) {
        LaunchToken t = LaunchToken(Currency.unwrap(key.currency1));
        vm.startPrank(who);
        t.approve(address(router), amountIn);
        ethOut = router.sell(key, amountIn, 0, who, block.timestamp);
        vm.stopPrank();
    }

    function liquidityOf(PoolKey memory key) internal view returns (uint128) {
        return IPoolManager(address(manager)).getLiquidity(key.toId());
    }
}
