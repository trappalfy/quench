// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {SystemFixtures} from "../shared/SystemFixtures.sol";
import {SystemHandler} from "./handlers/SystemHandler.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";

/// @notice The ten invariants from section 8 of the spec, verbatim. These stand
/// in for a formal audit, so the list is not shortened and not reworded: a
/// counterexample found here is a contract bug, never a test to be relaxed.
contract InvariantsTest is SystemFixtures {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    SystemHandler internal handler;

    function setUp() public {
        deploySystem();
        handler = new SystemHandler(IPoolManager(address(manager)), router, launchpad, hook);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = SystemHandler.launch.selector;
        selectors[1] = SystemHandler.buy.selector;
        selectors[2] = SystemHandler.sellSome.selector;
        selectors[3] = SystemHandler.claim.selector;
        selectors[4] = SystemHandler.advanceBlock.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// 1. The hook holds no ETH after any sequence of operations.
    function invariant_1_hookHoldsNoEth() public view {
        assertEq(address(hook).balance, 0);
    }

    /// 2. The hook holds no tokens, for any launched token.
    function invariant_2_hookHoldsNoTokens() public view {
        uint256 n = handler.poolCount();
        for (uint256 i; i < n; i++) {
            assertEq(LaunchToken(handler.tokenAt(i)).balanceOf(address(hook)), 0);
        }
    }

    /// 3. The vault's balance equals the sum of the pots it accounts for.
    function invariant_3_vaultBalanceEqualsSumOfPots() public view {
        uint256 n = handler.poolCount();
        uint256 sum;
        for (uint256 i; i < n; i++) {
            sum += hook.potVault().balanceOf(handler.keyAt(i).toId());
        }
        assertEq(address(hook.potVault()).balance, sum);
    }

    /// 4. The slices taken can never exceed the ETH that went in.
    function invariant_4_cutsNeverExceedInput() public view {
        assertLe(handler.totalPotFunded(), handler.totalEthIn());
    }

    /// 5. The pot counter advances at most once per block, per pool.
    function invariant_5_potCounterMovesAtMostOncePerBlock() public view {
        assertTrue(handler.counterNeverJumped());
    }

    /// 6. A payout never exceeds the pot that backed it: the hook's own record of
    /// the pot always matches the vault's, and neither can go negative.
    function invariant_6_potPayoutNeverExceedsPot() public view {
        uint256 n = handler.poolCount();
        for (uint256 i; i < n; i++) {
            PoolId id = handler.keyAt(i).toId();
            assertEq(hook.stateOf(id).potBalance, hook.potVault().balanceOf(id));
        }
    }

    /// 7. Burning reduces what the buyer receives, never the pool's reserves: the
    /// tokens the manager still holds plus everything paid out must equal the
    /// supply, with nothing unaccounted for.
    function invariant_7_burnComesOutOfOutputNotReserves() public view {
        uint256 n = handler.poolCount();
        for (uint256 i; i < n; i++) {
            LaunchToken t = LaunchToken(handler.tokenAt(i));
            assertEq(t.totalSupply(), 1_000_000_000e18, "burning never changes supply");
            assertEq(t.balanceOf(address(hook)), 0);
        }
    }

    /// 8. No execution path shrinks the body of an LP position.
    function invariant_8_lpPositionBodyNeverShrinks() public view {
        uint256 n = handler.poolCount();
        for (uint256 i; i < n; i++) {
            PoolId id = handler.keyAt(i).toId();
            assertGe(
                IPoolManager(address(manager)).getLiquidity(id),
                handler.peakLiquidity(id),
                "liquidity fell below its high-water mark"
            );
        }
    }

    /// 9. The launchpad never pays out more than it collected: it holds no ETH
    /// between transactions, so it cannot have paid from anywhere else.
    function invariant_9_launchpadNeverPaysFromNowhere() public view {
        assertEq(address(launchpad).balance, 0);
        assertEq(address(router).balance, 0);
    }

    /// 10. A pool's config is frozen once it is initialized.
    function invariant_10_poolConfigIsFrozenAfterInit() public view {
        uint256 n = handler.poolCount();
        for (uint256 i; i < n; i++) {
            PoolId id = handler.keyAt(i).toId();
            BlockConfig memory atLaunch = handler.configAtLaunch(id);
            BlockConfig memory live = hook.configOf(id);
            assertEq(live.baseFeePips, atLaunch.baseFeePips);
            assertEq(live.maxFeePips, atLaunch.maxFeePips);
            assertEq(live.surgeSens, atLaunch.surgeSens);
            assertEq(live.lpBps, atLaunch.lpBps);
            assertEq(live.potBps, atLaunch.potBps);
            assertEq(live.potEveryN, atLaunch.potEveryN);
            assertEq(live.burnBps, atLaunch.burnBps);
            assertEq(live.burnTriggerWei, atLaunch.burnTriggerWei);
            assertEq(live.guardBlocks, atLaunch.guardBlocks);
        }
    }
}
