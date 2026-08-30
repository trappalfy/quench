// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";

/// Every row of the validation table in section 6 of the spec, as a pair:
/// the boundary value is accepted, one step past it is refused.
contract BlockConfigValidationTest is Fixtures {
    function setUp() public {
        deployFixtures();
    }

    function _expectReject(BlockConfig memory cfg) internal {
        vm.expectRevert();
        initPoolWithConfig(cfg);
    }

    function test_maxFeeAt100000IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 100_000;
        initPoolWithConfig(cfg);
    }

    function test_maxFeeAbove100000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.maxFeePips = 100_001;
        _expectReject(cfg);
    }

    function test_baseFeeAboveMaxFeeIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 50_000;
        cfg.maxFeePips = 49_999;
        _expectReject(cfg);
    }

    function test_ethCutSumAt1000IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 600;
        cfg.potBps = 400;
        cfg.potEveryN = 5;
        initPoolWithConfig(cfg);
    }

    function test_ethCutSumAbove1000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 600;
        cfg.potBps = 401;
        cfg.potEveryN = 5;
        _expectReject(cfg);
    }

    function test_snipeTaxAt50000IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 10;
        cfg.maxBuyBps = 100;
        cfg.snipeTaxPips = 50_000;
        initPoolWithConfig(cfg);
    }

    function test_snipeTaxAbove50000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 10;
        cfg.maxBuyBps = 100;
        cfg.snipeTaxPips = 50_001;
        _expectReject(cfg);
    }

    function test_burnBpsAt1000IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = 1_000;
        cfg.burnTriggerWei = 1;
        initPoolWithConfig(cfg);
    }

    function test_burnBpsAbove1000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = 1_001;
        cfg.burnTriggerWei = 1;
        _expectReject(cfg);
    }

    function test_guardBlocksAt7200IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 7_200;
        cfg.maxBuyBps = 100;
        initPoolWithConfig(cfg);
    }

    function test_guardBlocksAbove7200IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 7_201;
        cfg.maxBuyBps = 100;
        _expectReject(cfg);
    }

    function test_potEveryNBelow2IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 1;
        _expectReject(cfg);
    }

    function test_potEveryNAbove1000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 1_001;
        _expectReject(cfg);
    }

    function test_potBpsWithoutEveryNIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 0;
        _expectReject(cfg);
    }

    function test_guardWithoutMaxBuyBpsIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 100;
        cfg.maxBuyBps = 0;
        _expectReject(cfg);
    }

    function test_maxBuyBpsAbove10000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 100;
        cfg.maxBuyBps = 10_001;
        _expectReject(cfg);
    }

    function test_burnWithoutTriggerIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = 100;
        cfg.burnTriggerWei = 0;
        _expectReject(cfg);
    }

    /// All blocks off is a legitimate configuration: a plain dynamic-fee pool.
    function test_allBlocksOffIsAccepted() public {
        BlockConfig memory cfg;
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 3_000;
        initPoolWithConfig(cfg);
    }
}
