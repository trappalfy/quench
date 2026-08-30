// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {HookMiner} from "./HookMiner.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockMath} from "../../src/lib/BlockMath.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";

/// @notice Stand-in for the real Launchpad until Task 12 builds it. It exists
/// because the hook identifies the launchpad by `msg.sender`, and `vm.prank`
/// does not survive the hop through `PoolManager.unlock`.
contract TestLaunchpad is IUnlockCallback {
    IPoolManager public immutable manager;
    BlockHook public hook;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    function setHook(BlockHook _hook) external {
        hook = _hook;
    }

    function stageAndInit(BlockConfig calldata cfg, PoolKey calldata key, uint160 sqrtPriceX96) external {
        hook.stageConfig(cfg);
        manager.initialize(key, sqrtPriceX96);
    }

    function stageOnly(BlockConfig calldata cfg) external {
        hook.stageConfig(cfg);
    }

    function initOnly(PoolKey calldata key, uint160 sqrtPriceX96) external {
        manager.initialize(key, sqrtPriceX96);
    }

    function addLiquidity(PoolKey calldata key, int256 liquidityDelta, int24 tickSpacing) external payable {
        manager.unlock(abi.encode(key, liquidityDelta, tickSpacing));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        (PoolKey memory key, int256 liquidityDelta, int24 tickSpacing) =
            abi.decode(raw, (PoolKey, int256, int24));

        (BalanceDelta delta,) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(tickSpacing),
                tickUpper: TickMath.maxUsableTick(tickSpacing),
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return "";
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount == 0) return;
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (currency.isAddressZero()) {
                manager.settle{value: owed}();
            } else {
                manager.sync(currency);
                LaunchToken(Currency.unwrap(currency)).transfer(address(manager), owed);
                manager.settle();
            }
        } else {
            manager.take(currency, address(this), uint256(uint128(amount)));
        }
    }

    receive() external payable {}
}

abstract contract Fixtures is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2^96
    uint160 internal constant HOOK_FLAGS = 0x28CC;
    int24 internal constant TICK_SPACING = 60;

    PoolManager internal manager;
    BlockHook internal hook;
    TestLaunchpad internal launchpadContract;
    LaunchToken internal token;
    LaunchToken internal token2;
    address internal launchpad;
    address internal router;

    function deployFixtures() internal {
        manager = new PoolManager(address(this));
        launchpadContract = new TestLaunchpad(IPoolManager(address(manager)));
        launchpad = address(launchpadContract);
        router = makeAddr("router");

        token = new LaunchToken("Test", "TEST", address(this));
        token2 = new LaunchToken("Test2", "TEST2", address(this));

        // Mine a salt so that the hook lands on an address carrying 0x28CC.
        bytes memory args = abi.encode(IPoolManager(address(manager)), launchpad, router);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(BlockHook).creationCode, args);
        hook = new BlockHook{salt: salt}(IPoolManager(address(manager)), launchpad, router);
        require(address(hook) == expected, "fixture: hook address mismatch");

        launchpadContract.setHook(hook);
    }

    function defaultConfig() internal pure returns (BlockConfig memory cfg) {
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 30_000;
        cfg.surgeSens = 10_000;
    }

    function poolKeyFor(address token1, uint24 fee) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    /// Stage the config as the launchpad would, then initialize in the same tx.
    function initPoolWithConfig(BlockConfig memory cfg) internal returns (PoolKey memory key) {
        key = poolKeyFor(address(token), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        launchpadContract.stageAndInit(cfg, key, SQRT_PRICE_1_1);
    }

    function initSecondPoolWithConfig(BlockConfig memory cfg) internal returns (PoolKey memory key) {
        key = poolKeyFor(address(token2), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        launchpadContract.stageAndInit(cfg, key, SQRT_PRICE_1_1);
    }

    /// Funds the launchpad and adds a full-range position on its behalf.
    function addLiquidity(PoolKey memory key, int256 liquidityDelta) internal {
        vm.deal(address(launchpadContract), address(launchpadContract).balance + 10_000 ether);
        LaunchToken t = LaunchToken(Currency.unwrap(key.currency1));
        t.transfer(address(launchpadContract), 500_000_000e18);
        launchpadContract.addLiquidity(key, liquidityDelta, TICK_SPACING);
    }

    function ethReserveOf(PoolKey memory key) internal view returns (uint256) {
        IPoolManager pm = IPoolManager(address(manager));
        PoolId id = key.toId();
        (uint160 sqrtPriceX96,,,) = pm.getSlot0(id);
        return BlockMath.inRangeEthReserve(pm.getLiquidity(id), sqrtPriceX96);
    }
}
