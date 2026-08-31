// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {Launchpad} from "../src/Launchpad.sol";
import {BoundedRouter} from "../src/BoundedRouter.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {BlockConfig} from "../src/lib/BlockConfig.sol";
import {InstantParams, CurveParams} from "../src/interfaces/ILaunchpad.sol";

/// @notice Puts realistic state on a *fork* so the reading layer can be checked
/// against something other than an empty registry. Never run this against the
/// real chain: it launches throwaway tokens.
contract SeedScript is Script {
    Launchpad constant PAD = Launchpad(payable(0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c));
    BoundedRouter constant ROUTER = BoundedRouter(payable(0xD689c128506611e05bf72212eA94B7Df4f9C7C17));
    /// 5 gwei per whole token: 5 ETH against a billion supply, so nearly all
    /// of it fits the opening position instead of being burned as leftover.
    ///
    /// Deliberately not 1:1. A 1:1 seed is the one price at which an inverted
    /// price formula reads correctly, and the reading layer had exactly that
    /// bug while every fork check passed.
    uint160 constant SQRT_PRICE_5_GWEI = 1120455419495722798374638764549163;
    uint256 constant OPENING_PRICE_WEI = 5_000_000_000;

    function allBlocks() internal pure returns (BlockConfig memory cfg) {
        cfg.guardBlocks = 50;
        cfg.maxBuyBps = 500;
        cfg.snipeTaxPips = 10_000;
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 50_000;
        cfg.surgeSens = 10_000;
        cfg.burnBps = 500;
        cfg.burnTriggerWei = 0.01 ether;
        cfg.lpBps = 200;
        cfg.potBps = 100;
        cfg.potEveryN = 3;
        cfg.potMinBuyWei = 0.01 ether;
    }

    function run() external {
        require(block.chainid == 4663, "fork of 4663 only");

        vm.startBroadcast();

        // A published blueprint, so the registry is not empty either.
        uint256 blueprintId = PAD.publishBlueprint(allBlocks(), 500);

        address instant = PAD.launchInstant{value: 5 ether}(
            InstantParams({
                name: "Seed Instant",
                symbol: "SEED",
                cfg: allBlocks(),
                creatorFeeBps: 5_000,
                blueprintId: 0,
                sqrtPriceX96: SQRT_PRICE_5_GWEI
            })
        );

        (address curved, address curve) = PAD.launchCurve(
            CurveParams({
                name: "Seed Curve",
                symbol: "SCRV",
                cfg: allBlocks(),
                creatorFeeBps: 5_000,
                blueprintId: 0,
                p0: 4_000_000_000
            })
        );

        // Trade both venues so the pot, the burn and the curve all have values.
        PoolKey memory key = PAD.poolKeyOf(instant);
        ROUTER.buy{value: 0.05 ether}(key, 0, msg.sender, block.timestamp + 1 days);
        BondingCurve(payable(curve)).buy{value: 0.5 ether}(0, msg.sender);

        vm.stopBroadcast();

        console2.log("blueprintId ", blueprintId);
        console2.log("instant     ", instant);
        console2.log("curved      ", curved);
        console2.log("curve       ", curve);
        console2.log("launchCount ", PAD.launchCount());
        console2.log("openingPrice", OPENING_PRICE_WEI);
    }
}
