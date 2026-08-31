// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixtures} from "../shared/SystemFixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice What each block costs a buyer in gas, measured rather than guessed.
///
/// The builder quotes a gas figure next to the fee figure, and a made-up number
/// there is the same kind of lie as a made-up fee. These are the numbers it
/// quotes; `web/src/lib/hookConfig.ts` carries them with a pointer back here.
/// Re-run with -vv after any change to the hook and update that table.
contract BlockGasTest is SystemFixtures {
    uint256 constant POOL_ETH = 10 ether;
    uint256 constant BUY = 0.1 ether;

    function setUp() public {
        deploySystem();
    }

    /// A buy on a fresh pool pays for cold storage that a real, traded pool has
    /// long since warmed. The second buy is the honest figure.
    function _measure(BlockConfig memory cfg) internal returns (uint256) {
        vm.prank(creator);
        address token = launchpad.launchInstant{value: POOL_ETH}(instantParams(cfg));
        PoolKey memory key = launchpad.poolKeyOf(token);

        buy(key, BUY, alice);
        vm.roll(block.number + 1);

        uint256 before = gasleft();
        buy(key, BUY, bob);
        return before - gasleft();
    }

    function _diff(BlockConfig memory cfg, uint256 base) internal returns (int256) {
        return int256(_measure(cfg)) - int256(base);
    }

    function _off() internal pure returns (BlockConfig memory cfg) {
        // Every block off. A flat fee still has to be set: the pool is created
        // with the dynamic-fee flag and the hook always overrides.
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 3_000;
    }

    function test_gasPerBlock() public {
        // The first pool measured also pays to warm shared state — the hook's
        // code, the router, the vault. Discard it and take the baseline from the
        // second, so the differences below are the blocks and not the order.
        _measure(_off());
        uint256 base = _measure(_off());

        BlockConfig memory snipe = _off();
        snipe.guardBlocks = 50;
        snipe.maxBuyBps = 5_000;
        snipe.snipeTaxPips = 10_000;

        BlockConfig memory surge = _off();
        surge.maxFeePips = 50_000;
        surge.surgeSens = 10_000;

        BlockConfig memory burn = _off();
        burn.burnBps = 500;
        burn.burnTriggerWei = 0.01 ether;

        BlockConfig memory lp = _off();
        lp.lpBps = 200;

        BlockConfig memory pot = _off();
        pot.potBps = 100;
        pot.potEveryN = 3;
        pot.potMinBuyWei = 0.01 ether;

        BlockConfig memory all = _off();
        all.guardBlocks = 50;
        all.maxBuyBps = 5_000;
        all.snipeTaxPips = 10_000;
        all.maxFeePips = 50_000;
        all.surgeSens = 10_000;
        all.burnBps = 500;
        all.burnTriggerWei = 0.01 ether;
        all.lpBps = 200;
        all.potBps = 100;
        all.potEveryN = 3;
        all.potMinBuyWei = 0.01 ether;

        emit log_named_uint("base (all blocks off)", base);
        emit log_named_int("01 anti-snipe", _diff(snipe, base));
        emit log_named_int("02 surge fees", _diff(surge, base));
        emit log_named_int("03 auto burn", _diff(burn, base));
        emit log_named_int("04 lp rewards", _diff(lp, base));
        emit log_named_int("05 nth-buy pot", _diff(pot, base));
        emit log_named_int("all five together", _diff(all, base));
    }
}
