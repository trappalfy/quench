// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {BlockConfig} from "./lib/BlockConfig.sol";
import {LiquidityAmounts} from "./lib/LiquidityAmounts.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {BlockHook} from "./hook/BlockHook.sol";
import {BondingCurve} from "./BondingCurve.sol";
import {ILaunchpad, LaunchRecord, Blueprint, InstantParams, CurveParams} from "./interfaces/ILaunchpad.sol";

/// @title Launchpad
/// @notice The only door into the system: it creates the token, opens the pool,
/// holds the LP position and keeps the registries the reading layer indexes.
/// @dev It has no owner and no upgrade path. The one function that can only be
/// called once, `deployHook`, cannot change anything that already exists: it
/// fails outright if a hook is already set, and the hook's own constructor
/// rejects a salt that does not produce the required permission bits.
contract Launchpad is ILaunchpad, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    error HookAlreadyDeployed();
    error HookNotDeployed();
    error PoolTooLarge();
    error CreatorFeeTooHigh();
    error RoyaltyTooHigh();
    error UnknownToken();
    error NotTheCurve();
    error AlreadyGraduated();
    error NotPoolManager();
    error NoLiquidity();
    error TransferFailed();

    event Launched(
        address indexed token, address indexed creator, address curve, uint64 blueprintId, uint160 sqrtPriceX96
    );
    event BlueprintPublished(uint256 indexed id, address indexed author, uint16 royaltyBps);
    event FeesClaimed(
        address indexed token, uint256 ethToCreator, uint256 ethToProtocol, uint256 ethToAuthor, uint256 tokensBurned
    );

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    int24 internal constant TICK_SPACING = 60;
    uint16 internal constant MAX_CREATOR_FEE_BPS = 8_000;
    uint16 internal constant MAX_ROYALTY_BPS = 2_000;
    uint256 internal constant GRADUATION_SUPPLY = 200_000_000e18; // the 20% the curve never sells

    enum Op {
        AddLiquidity,
        CollectFees
    }

    struct Job {
        Op op;
        PoolKey key;
        uint256 amount0;
        uint256 amount1;
    }

    IPoolManager public immutable poolManager;
    address public immutable router;
    address public immutable protocolFeeRecipient;
    uint256 public immutable maxPoolEthWei;
    address public immutable curveImplementation;

    address public hook;

    address[] internal _tokens;
    mapping(address => LaunchRecord) internal _records;
    mapping(address => PoolKey) internal _keys;
    Blueprint[] internal _blueprints;

    constructor(
        IPoolManager _poolManager,
        address _router,
        address _protocolFeeRecipient,
        uint256 _maxPoolEthWei
    ) {
        poolManager = _poolManager;
        router = _router;
        protocolFeeRecipient = _protocolFeeRecipient;
        maxPoolEthWei = _maxPoolEthWei;

        // The implementation records this contract as its launchpad; every clone
        // reads that from the implementation's code.
        curveImplementation = address(new BondingCurve());

        // Index 0 is a sentinel so that blueprintId 0 can mean "no blueprint".
        _blueprints.push();
    }

    /// @notice Deploys the hook at a mined salt. Callable once, by anyone: a wrong
    /// salt is rejected by the hook's constructor, so there is nothing to trust.
    function deployHook(bytes32 salt) external returns (address) {
        if (hook != address(0)) revert HookAlreadyDeployed();
        BlockHook deployed = new BlockHook{salt: salt}(poolManager, address(this), router);
        hook = address(deployed);
        return hook;
    }

    // --- launching ---

    function launchInstant(InstantParams calldata p) external payable returns (address token) {
        if (hook == address(0)) revert HookNotDeployed();
        if (msg.value > maxPoolEthWei) revert PoolTooLarge();
        if (p.creatorFeeBps > MAX_CREATOR_FEE_BPS) revert CreatorFeeTooHigh();

        BlockConfig memory cfg = _configFor(p.blueprintId, p.cfg);
        token = address(new LaunchToken(p.name, p.symbol, address(this)));

        PoolKey memory key = _keyFor(token);
        _keys[token] = key;

        _records[token] = LaunchRecord({
            token: token,
            creator: msg.sender,
            launchBlock: uint64(block.number),
            creatorFeeBps: p.creatorFeeBps,
            blueprintId: p.blueprintId,
            curve: address(0),
            graduated: true, // an instant launch is live from the first block
            sqrtPriceX96: p.sqrtPriceX96,
            cfg: cfg
        });
        _tokens.push(token);

        _openPool(key, cfg, p.sqrtPriceX96, msg.value, LaunchToken(token).totalSupply(), msg.sender);

        emit Launched(token, msg.sender, address(0), p.blueprintId, p.sqrtPriceX96);
    }

    function launchCurve(CurveParams calldata p) external returns (address token, address curve) {
        if (hook == address(0)) revert HookNotDeployed();
        if (p.creatorFeeBps > MAX_CREATOR_FEE_BPS) revert CreatorFeeTooHigh();

        BondingCurve impl = BondingCurve(payable(curveImplementation));
        if (impl.totalRaiseAtFullSellout(p.p0) > maxPoolEthWei) revert PoolTooLarge();

        BlockConfig memory cfg = _configFor(p.blueprintId, p.cfg);
        token = address(new LaunchToken(p.name, p.symbol, address(this)));
        curve = LibClone.clone(curveImplementation);
        BondingCurve(payable(curve)).initialize(token, p.p0, msg.sender);

        _keys[token] = _keyFor(token);
        _records[token] = LaunchRecord({
            token: token,
            creator: msg.sender,
            launchBlock: uint64(block.number),
            creatorFeeBps: p.creatorFeeBps,
            blueprintId: p.blueprintId,
            curve: curve,
            graduated: false,
            sqrtPriceX96: 0,
            cfg: cfg
        });
        _tokens.push(token);

        // 80% goes to the curve to sell; the remaining 20% stays here for the pool.
        if (!IERC20Minimal(token).transfer(curve, impl.CURVE_SUPPLY())) revert TransferFailed();

        emit Launched(token, msg.sender, curve, p.blueprintId, 0);
    }

    /// @notice Called by a launch's own curve when its last tranche sells out.
    function graduate(address token, uint160 sqrtPriceX96) external payable {
        LaunchRecord storage rec = _records[token];
        if (rec.token == address(0)) revert UnknownToken();
        if (msg.sender != rec.curve) revert NotTheCurve();
        if (rec.graduated) revert AlreadyGraduated();

        rec.graduated = true;
        rec.sqrtPriceX96 = sqrtPriceX96;

        _openPool(_keys[token], rec.cfg, sqrtPriceX96, msg.value, GRADUATION_SUPPLY, rec.creator);
    }

    // --- blueprints ---

    function publishBlueprint(BlockConfig calldata cfg, uint16 royaltyBps) external returns (uint256 id) {
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _blueprints.push(Blueprint({author: msg.sender, royaltyBps: royaltyBps, cfg: cfg}));
        id = _blueprints.length - 1;
        emit BlueprintPublished(id, msg.sender, royaltyBps);
    }

    // --- fees ---

    /// @notice Collects the position's accrued fees and splits them. The body of
    /// the position is never touched: this calls modifyLiquidity with a delta of
    /// zero, and no function in this contract ever passes a negative one.
    function claimFees(address token) external {
        LaunchRecord memory rec = _records[token];
        if (rec.token == address(0)) revert UnknownToken();

        bytes memory res = poolManager.unlock(abi.encode(Job(Op.CollectFees, _keys[token], 0, 0)));
        (uint256 fee0, uint256 fee1) = abi.decode(res, (uint256, uint256));

        // The token side of the fee is burned outright — the spec's choice, and it
        // keeps the launchpad from accumulating a balance in every launched token.
        if (fee1 > 0 && !IERC20Minimal(token).transfer(DEAD, fee1)) revert TransferFailed();

        uint256 toAuthor;
        if (rec.blueprintId != 0) {
            Blueprint memory bp = _blueprints[rec.blueprintId];
            toAuthor = (fee0 * bp.royaltyBps) / 10_000;
            if (toAuthor > 0) _send(bp.author, toAuthor);
        }

        uint256 remainder = fee0 - toAuthor;
        uint256 toCreator = (remainder * rec.creatorFeeBps) / 10_000;
        uint256 toProtocol = remainder - toCreator;

        _send(rec.creator, toCreator);
        _send(protocolFeeRecipient, toProtocol);

        emit FeesClaimed(token, toCreator, toProtocol, toAuthor, fee1);
    }

    // --- pool plumbing ---

    function _openPool(
        PoolKey memory key,
        BlockConfig memory cfg,
        uint160 sqrtPriceX96,
        uint256 ethAmount,
        uint256 tokenAmount,
        address refundTo
    ) internal {
        BlockHook(payable(hook)).stageConfig(cfg);
        poolManager.initialize(key, sqrtPriceX96);

        poolManager.unlock(abi.encode(Job(Op.AddLiquidity, key, ethAmount, tokenAmount)));

        // Only one side of the pair binds the position, so some of the other side
        // is left over. The creator's ETH goes back to them; the surplus tokens are
        // burned rather than parked here forever.
        uint256 ethLeft = address(this).balance;
        if (ethLeft > 0) _send(refundTo, ethLeft);

        address token = Currency.unwrap(key.currency1);
        uint256 tokensLeft = IERC20Minimal(token).balanceOf(address(this));
        if (tokensLeft > 0 && !IERC20Minimal(token).transfer(DEAD, tokensLeft)) revert TransferFailed();
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Job memory job = abi.decode(raw, (Job));

        if (job.op == Op.AddLiquidity) {
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(job.key.toId());
            uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
                sqrtPriceX96,
                TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(TICK_SPACING)),
                TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(TICK_SPACING)),
                job.amount0,
                job.amount1
            );
            if (liquidity == 0) revert NoLiquidity();

            (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                job.key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: TickMath.minUsableTick(TICK_SPACING),
                    tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                    liquidityDelta: int256(uint256(liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );

            _resolve(job.key.currency0, addDelta.amount0());
            _resolve(job.key.currency1, addDelta.amount1());
            return "";
        }

        // CollectFees: a zero liquidity delta collects what has accrued and leaves
        // the position itself exactly as it was.
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            job.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                liquidityDelta: 0,
                salt: bytes32(0)
            }),
            ""
        );

        uint256 fee0 = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
        uint256 fee1 = delta.amount1() > 0 ? uint256(uint128(delta.amount1())) : 0;
        _resolve(job.key.currency0, delta.amount0());
        _resolve(job.key.currency1, delta.amount1());

        return abi.encode(fee0, fee1);
    }

    function _resolve(Currency currency, int128 amount) internal {
        if (amount == 0) return;
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (currency.isAddressZero()) {
                poolManager.settle{value: owed}();
            } else {
                poolManager.sync(currency);
                if (!IERC20Minimal(Currency.unwrap(currency)).transfer(address(poolManager), owed)) {
                    revert TransferFailed();
                }
                poolManager.settle();
            }
        } else {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }

    function _keyFor(address token) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function _configFor(uint64 blueprintId, BlockConfig calldata own) internal view returns (BlockConfig memory) {
        if (blueprintId == 0) return own;
        return _blueprints[blueprintId].cfg;
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // --- reading ---

    function launchCount() external view returns (uint256) {
        return _tokens.length;
    }

    function tokenAt(uint256 i) external view returns (address) {
        return _tokens[i];
    }

    function launchRecord(address token) external view returns (LaunchRecord memory) {
        return _records[token];
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        return _keys[token];
    }

    function blueprintCount() external view returns (uint256) {
        return _blueprints.length;
    }

    function blueprintAt(uint256 i) external view returns (Blueprint memory) {
        return _blueprints[i];
    }

    receive() external payable {}
}
