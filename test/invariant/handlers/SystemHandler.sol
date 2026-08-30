// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {BlockConfig} from "../../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../../src/hook/BlockHook.sol";
import {BoundedRouter} from "../../../src/BoundedRouter.sol";
import {Launchpad} from "../../../src/Launchpad.sol";
import {LaunchToken} from "../../../src/LaunchToken.sol";
import {InstantParams} from "../../../src/interfaces/ILaunchpad.sol";

/// @notice Drives the system with a bounded set of actions and records what
/// should have happened, so the invariants can compare the two.
contract SystemHandler is CommonBase, StdCheats, StdUtils {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    IPoolManager public immutable manager;
    BoundedRouter public immutable router;
    Launchpad public immutable launchpad;
    BlockHook public immutable hook;

    address[] internal actors;
    address[] internal tokens;
    PoolKey[] internal keys;

    // --- bookkeeping the invariants check against ---
    uint256 public totalEthIn;
    uint256 public totalPotFunded;
    uint256 public totalPotPaid;
    uint256 public totalFeesClaimed;
    bool public counterNeverJumped = true;
    bool public everyConfigStillMatches = true;

    mapping(PoolId => uint128) internal _peakLiquidity;
    mapping(PoolId => BlockConfig) internal _configAtLaunch;
    mapping(PoolId => mapping(uint256 => bool)) internal _blockSeen;
    mapping(PoolId => mapping(uint256 => uint32)) internal _countAtBlockStart;

    constructor(IPoolManager _manager, BoundedRouter _router, Launchpad _launchpad, BlockHook _hook) {
        manager = _manager;
        router = _router;
        launchpad = _launchpad;
        hook = _hook;

        actors.push(makeAddr("actorA"));
        actors.push(makeAddr("actorB"));
        actors.push(makeAddr("actorC"));
        for (uint256 i; i < actors.length; i++) {
            vm.deal(actors[i], 100_000 ether);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    // --- actions ---

    function launch(uint256 seed, uint16 lpBps, uint16 potBps, uint16 burnBps, uint96 ethIn) external {
        if (tokens.length >= 4) return;

        BlockConfig memory cfg;
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 50_000;
        cfg.surgeSens = 10_000;
        cfg.lpBps = uint16(bound(lpBps, 0, 500));
        cfg.potBps = uint16(bound(potBps, 0, 500));
        if (cfg.potBps > 0) cfg.potEveryN = 3;
        cfg.burnBps = uint16(bound(burnBps, 0, 1_000));
        if (cfg.burnBps > 0) cfg.burnTriggerWei = 0.01 ether;

        uint256 amount = bound(ethIn, 100 ether, 2_000 ether);
        address who = _actor(seed);

        vm.prank(who);
        try launchpad.launchInstant{value: amount}(
            InstantParams({
                name: "Fuzz",
                symbol: "FUZZ",
                cfg: cfg,
                creatorFeeBps: 5_000,
                blueprintId: 0,
                sqrtPriceX96: SQRT_PRICE_1_1
            })
        ) returns (address token) {
            PoolKey memory key = launchpad.poolKeyOf(token);
            tokens.push(token);
            keys.push(key);
            _configAtLaunch[key.toId()] = cfg;
            _peakLiquidity[key.toId()] = manager.getLiquidity(key.toId());
        } catch {}
    }

    function buy(uint256 poolSeed, uint256 actorSeed, uint96 amount) external {
        if (keys.length == 0) return;
        PoolKey memory key = keys[poolSeed % keys.length];
        address who = _actor(actorSeed);
        uint256 value = bound(amount, 1e12, 100 ether);

        _snapshotCounter(key);
        uint256 potBefore = hook.potVault().balanceOf(key.toId());

        vm.prank(who);
        try router.buy{value: value}(key, 0, who, block.timestamp) {
            totalEthIn += value;
            uint256 potAfter = hook.potVault().balanceOf(key.toId());
            if (potAfter > potBefore) totalPotFunded += potAfter - potBefore;
            _recordCounter(key);
            _recordPeak(key);
        } catch {}
    }

    function sellSome(uint256 poolSeed, uint256 actorSeed, uint96 amount) external {
        if (keys.length == 0) return;
        PoolKey memory key = keys[poolSeed % keys.length];
        address who = _actor(actorSeed);
        LaunchToken t = LaunchToken(Currency.unwrap(key.currency1));

        _snapshotCounter(key);
        uint256 held = t.balanceOf(who);
        if (held == 0) return;
        uint256 amt = bound(amount, 1, held);

        vm.startPrank(who);
        t.approve(address(router), amt);
        try router.sell(key, amt, 0, who, block.timestamp) {
            _recordCounter(key);
            _recordPeak(key);
        } catch {}
        vm.stopPrank();
    }

    function claim(uint256 poolSeed) external {
        if (tokens.length == 0) return;
        address token = tokens[poolSeed % tokens.length];
        try launchpad.claimFees(token) {
            _recordPeak(launchpad.poolKeyOf(token));
        } catch {}
    }

    function advanceBlock(uint8 by) external {
        vm.roll(block.number + bound(by, 1, 5));
    }

    // --- recording ---

    /// Invariant 5: the pot counter must never advance more than once per block.
    /// @dev Measured against the counter as it stood when this block began, not
    /// against the previous observation, which may be several blocks old.
    function _snapshotCounter(PoolKey memory key) internal {
        PoolId id = key.toId();
        if (!_blockSeen[id][block.number]) {
            _blockSeen[id][block.number] = true;
            _countAtBlockStart[id][block.number] = hook.stateOf(id).potBuyCount;
        }
    }

    function _recordCounter(PoolKey memory key) internal {
        PoolId id = key.toId();
        uint32 nowCount = hook.stateOf(id).potBuyCount;
        if (nowCount - _countAtBlockStart[id][block.number] > 1) counterNeverJumped = false;
    }

    /// Invariant 8: the LP body only ever grows.
    function _recordPeak(PoolKey memory key) internal {
        PoolId id = key.toId();
        uint128 live = manager.getLiquidity(id);
        if (live > _peakLiquidity[id]) _peakLiquidity[id] = live;
    }

    // --- readers for the invariant contract ---

    function poolCount() external view returns (uint256) {
        return keys.length;
    }

    function keyAt(uint256 i) external view returns (PoolKey memory) {
        return keys[i];
    }

    function tokenAt(uint256 i) external view returns (address) {
        return tokens[i];
    }

    function peakLiquidity(PoolId id) external view returns (uint128) {
        return _peakLiquidity[id];
    }

    function configAtLaunch(PoolId id) external view returns (BlockConfig memory) {
        return _configAtLaunch[id];
    }
}
