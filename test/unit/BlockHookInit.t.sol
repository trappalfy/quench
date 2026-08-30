// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract BlockHookInitTest is Fixtures {
    using PoolIdLibrary for PoolKey;

    function setUp() public {
        deployFixtures();
    }

    function test_hookAddressCarriesTheRequiredFlags() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, 0x28CC);
    }

    function test_hookDeployedItsOwnVault() public view {
        assertEq(hook.potVault().hook(), address(hook));
    }

    function test_wiringIsImmutableAndCorrect() public view {
        assertEq(hook.launchpad(), launchpad);
        assertEq(hook.router(), router);
    }

    function test_initializePersistsStagedConfig() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 150;
        cfg.potBps = 50;
        cfg.potEveryN = 7;
        cfg.burnBps = 250;
        cfg.burnTriggerWei = 1 ether;
        cfg.guardBlocks = 100;
        cfg.maxBuyBps = 300;

        PoolKey memory key = initPoolWithConfig(cfg);
        BlockConfig memory stored = hook.configOf(key.toId());

        assertEq(stored.baseFeePips, cfg.baseFeePips);
        assertEq(stored.maxFeePips, cfg.maxFeePips);
        assertEq(stored.surgeSens, cfg.surgeSens);
        assertEq(stored.lpBps, cfg.lpBps);
        assertEq(stored.potBps, cfg.potBps);
        assertEq(stored.potEveryN, cfg.potEveryN);
        assertEq(stored.burnBps, cfg.burnBps);
        assertEq(stored.burnTriggerWei, cfg.burnTriggerWei);
        assertEq(stored.guardBlocks, cfg.guardBlocks);
        assertEq(stored.maxBuyBps, cfg.maxBuyBps);
    }

    function test_initializeRecordsStartBlock() public {
        vm.roll(1234);
        PoolKey memory key = initPoolWithConfig(defaultConfig());
        assertEq(hook.stateOf(key.toId()).startBlock, 1234);
    }

    /// Initializing without staging must fail. Transient storage starts empty in
    /// every transaction, and forge runs each test as one, so this also covers the
    /// case of a config staged by an earlier transaction.
    function test_initializeWithoutStagingIsRejected() public {
        PoolKey memory key = poolKeyFor(address(token), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        vm.expectRevert();
        launchpadContract.initOnly(key, SQRT_PRICE_1_1);
    }

    /// One staged config initializes exactly one pool. Reading it clears the slot,
    /// so a second pool cannot ride in on the same staging within the same
    /// transaction — which is the only window where the slot is even readable.
    function test_stagedConfigIsConsumedExactlyOnce() public {
        launchpadContract.stageOnly(defaultConfig());

        PoolKey memory first = poolKeyFor(address(token), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        launchpadContract.initOnly(first, SQRT_PRICE_1_1);
        assertEq(hook.configOf(first.toId()).baseFeePips, 3_000);

        PoolKey memory second = poolKeyFor(address(token2), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        vm.expectRevert();
        launchpadContract.initOnly(second, SQRT_PRICE_1_1);
    }

    function test_onlyLaunchpadCanStageConfig() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(BlockHook.NotLaunchpad.selector);
        hook.stageConfig(defaultConfig());
    }

    function test_onlyLaunchpadCanInitializeAPool() public {
        PoolKey memory key = poolKeyFor(address(token), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        vm.expectRevert();
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    function test_rejectsNonNativeCurrency0() public {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0x1111)),
            currency1: Currency.wrap(address(0x2222)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        vm.expectRevert();
        launchpadContract.stageAndInit(defaultConfig(), key, SQRT_PRICE_1_1);
    }

    function test_rejectsStaticFeePool() public {
        PoolKey memory key = poolKeyFor(address(token), 3000);
        vm.expectRevert();
        launchpadContract.stageAndInit(defaultConfig(), key, SQRT_PRICE_1_1);
    }

    function test_onlyLaunchpadCanAddLiquidity() public {
        PoolKey memory key = initPoolWithConfig(defaultConfig());
        // The fixture routes liquidity through the launchpad; anyone else is refused.
        vm.expectRevert();
        manager.unlock(abi.encode(key, int256(1000e18), TICK_SPACING));
    }
}
