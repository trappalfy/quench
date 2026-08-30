// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BlockMath} from "../lib/BlockMath.sol";
import {BaseHook} from "./BaseHook.sol";
import {BlockConfig, PoolState} from "../lib/BlockConfig.sol";
import {IBlockHook} from "../interfaces/IBlockHook.sol";
import {IPotVault} from "../interfaces/IPotVault.sol";
import {PotVault} from "../PotVault.sol";

/// @title BlockHook
/// @notice One immutable hook serving every launched pool. Behaviour per pool is
/// fixed at initialization and can never be changed, replaced or upgraded.
/// The hook holds no balance: every slice it takes is paid out in the same
/// transaction it was taken.
contract BlockHook is BaseHook, IBlockHook {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    error NotLaunchpad();
    error NoStagedConfig();
    error PoolMustBeNativeEth();
    error PoolMustBeDynamicFee();
    error BadFeeBounds();
    error EthCutTooLarge();
    error SnipeTaxTooLarge();
    error BurnTooLarge();
    error GuardTooLong();
    error BadPotEveryN();
    error BadMaxBuyBps();
    error BurnNeedsTrigger();
    error OnlyLaunchpadProvidesLiquidity();

    event PoolConfigured(PoolId indexed id, BlockConfig cfg);

    /// @dev An arbitrary transient slot, far from anything else in use.
    bytes32 internal constant STAGED_SLOT = 0x6b3a8f2f1a5f4ef1a3d0f4a7c9b2e8d5c4a1b6e3f0d7c2a9b8e5d4c1a0f7b6e3;

    address public immutable launchpad;
    address public immutable router;
    IPotVault public immutable potVault;

    mapping(PoolId => BlockConfig) internal _configOf;
    mapping(PoolId => PoolState) internal _stateOf;

    constructor(IPoolManager _manager, address _launchpad, address _router) BaseHook(_manager) {
        launchpad = _launchpad;
        router = _router;
        potVault = IPotVault(address(new PotVault()));
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @inheritdoc IBlockHook
    /// @dev beforeInitialize carries no hookData, so the launchpad hands the config
    /// over through transient storage immediately before calling initialize. It
    /// cannot outlive the transaction, so no other initialization can pick it up.
    function stageConfig(BlockConfig calldata cfg) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        bytes memory encoded = abi.encode(cfg);
        bytes32 slot = STAGED_SLOT;
        assembly ("memory-safe") {
            let len := mload(encoded)
            tstore(slot, len)
            for { let i := 0 } lt(i, len) { i := add(i, 32) } {
                tstore(add(slot, add(div(i, 32), 1)), mload(add(encoded, add(i, 32))))
            }
        }
    }

    function _readStagedConfig() internal returns (BlockConfig memory cfg) {
        bytes32 slot = STAGED_SLOT;
        uint256 len;
        assembly ("memory-safe") {
            len := tload(slot)
        }
        if (len == 0) revert NoStagedConfig();

        bytes memory encoded = new bytes(len);
        assembly ("memory-safe") {
            for { let i := 0 } lt(i, len) { i := add(i, 32) } {
                mstore(add(encoded, add(i, 32)), tload(add(slot, add(div(i, 32), 1))))
            }
            // Clear the length so a second initialize in the same tx cannot reuse it.
            tstore(slot, 0)
        }
        cfg = abi.decode(encoded, (BlockConfig));
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal override returns (bytes4) {
        if (sender != launchpad) revert NotLaunchpad();
        if (!key.currency0.isAddressZero()) revert PoolMustBeNativeEth();
        if (!key.fee.isDynamicFee()) revert PoolMustBeDynamicFee();

        BlockConfig memory cfg = _readStagedConfig();
        _validate(cfg);

        PoolId id = key.toId();
        _configOf[id] = cfg;
        _stateOf[id].startBlock = uint64(block.number);

        emit PoolConfigured(id, cfg);
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();
        BlockConfig memory cfg = _configOf[id];

        uint256 amountIn = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : 0;
        uint256 reserve = _ethReserve(id);
        uint24 fee = BlockMath.surgeFee(amountIn, reserve, cfg.baseFeePips, cfg.maxFeePips, cfg.surgeSens);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _afterSwap(
        address,
        PoolKey calldata,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        return (BaseHook.afterSwap.selector, 0);
    }

    /// @dev The one reserve every block measures itself against.
    function _ethReserve(PoolId id) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(id);
        return BlockMath.inRangeEthReserve(poolManager.getLiquidity(id), sqrtPriceX96);
    }

    /// @dev Liquidity comes from the launchpad and nowhere else: it is the launchpad
    /// that holds the LP position, and a position held by anyone else would not be locked.
    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) internal view override returns (bytes4) {
        if (sender != launchpad) revert OnlyLaunchpadProvidesLiquidity();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _validate(BlockConfig memory c) internal pure {
        if (c.baseFeePips > c.maxFeePips || c.maxFeePips > 100_000) revert BadFeeBounds();
        if (uint256(c.lpBps) + uint256(c.potBps) > 1_000) revert EthCutTooLarge();
        if (c.snipeTaxPips > 50_000) revert SnipeTaxTooLarge();
        if (c.burnBps > 1_000) revert BurnTooLarge();
        if (c.guardBlocks > 7_200) revert GuardTooLong();
        if (c.potEveryN > 0 && (c.potEveryN < 2 || c.potEveryN > 1_000)) revert BadPotEveryN();
        if (c.potBps > 0 && c.potEveryN < 2) revert BadPotEveryN();
        if (c.guardBlocks > 0 && (c.maxBuyBps == 0 || c.maxBuyBps > 10_000)) revert BadMaxBuyBps();
        if (c.burnBps > 0 && c.burnTriggerWei == 0) revert BurnNeedsTrigger();
    }

    /// @inheritdoc IBlockHook
    function configOf(PoolId id) external view returns (BlockConfig memory) {
        return _configOf[id];
    }

    /// @inheritdoc IBlockHook
    function stateOf(PoolId id) external view returns (PoolState memory) {
        return _stateOf[id];
    }

    /// @dev Needed to receive ETH slices taken from the PoolManager before they are
    /// forwarded in the same call. The balance is always zero between transactions.
    receive() external payable {}
}
