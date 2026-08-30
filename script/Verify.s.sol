// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {BlockHook} from "../src/hook/BlockHook.sol";
import {BoundedRouter} from "../src/BoundedRouter.sol";
import {Launchpad} from "../src/Launchpad.sol";
import {BondingCurve} from "../src/BondingCurve.sol";

/// @notice Reads deployments/<chainid>.json and checks the live contracts against
/// it. Run this after every deployment, and again before announcing anything.
contract VerifyScript is Script {
    function run() external view {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);

        address poolManager = vm.parseJsonAddress(json, ".poolManager");
        address router = vm.parseJsonAddress(json, ".boundedRouter");
        address launchpad = vm.parseJsonAddress(json, ".launchpad");
        address hookAddr = vm.parseJsonAddress(json, ".blockHook");
        address vault = vm.parseJsonAddress(json, ".potVault");
        address curveImpl = vm.parseJsonAddress(json, ".curveImplementation");
        address feeRecipient = vm.parseJsonAddress(json, ".protocolFeeRecipient");

        BlockHook hook = BlockHook(payable(hookAddr));
        Launchpad pad = Launchpad(payable(launchpad));

        // Everything is actually there.
        require(poolManager.code.length > 0, "PoolManager has no code");
        require(router.code.length > 0, "router has no code");
        require(launchpad.code.length > 0, "launchpad has no code");
        require(hookAddr.code.length > 0, "hook has no code");
        require(vault.code.length > 0, "vault has no code");
        require(curveImpl.code.length > 0, "curve implementation has no code");

        // The hook's address encodes its permissions; nothing else can.
        require(uint160(hookAddr) & 0x3FFF == 0x28CC, "hook address lacks the required flags");

        // Every link is immutable, so checking once is checking forever.
        require(hook.launchpad() == launchpad, "hook points at the wrong launchpad");
        require(hook.router() == router, "hook points at the wrong router");
        require(address(hook.poolManager()) == poolManager, "hook points at the wrong PoolManager");
        require(address(hook.potVault()) == vault, "hook points at the wrong vault");
        require(hook.potVault().hook() == hookAddr, "vault points at the wrong hook");
        require(pad.hook() == hookAddr, "launchpad points at the wrong hook");
        require(pad.router() == router, "launchpad points at the wrong router");
        require(pad.protocolFeeRecipient() == feeRecipient, "fee recipient does not match the record");
        require(pad.curveImplementation() == curveImpl, "curve implementation does not match the record");
        require(BondingCurve(payable(curveImpl)).launchpad() == launchpad, "curve points at the wrong launchpad");
        require(address(BoundedRouter(payable(router)).poolManager()) == poolManager, "router points elsewhere");

        // Custody: nothing should be sitting anywhere between transactions.
        require(hookAddr.balance == 0, "hook is holding ETH");
        require(router.balance == 0, "router is holding ETH");
        require(launchpad.balance == 0, "launchpad is holding ETH");

        // The damage cap is set and the registries start where they should.
        require(pad.maxPoolEthWei() > 0, "maxPoolEthWei is zero");
        require(pad.blueprintCount() >= 1, "blueprint sentinel is missing");
        require(pad.blueprintAt(0).author == address(0), "blueprint 0 is not a sentinel");

        console2.log("all checks passed");
        console2.log("launches so far      ", pad.launchCount());
        console2.log("blueprints so far    ", pad.blueprintCount() - 1);
        console2.log("maxPoolEthWei        ", pad.maxPoolEthWei());
    }
}
