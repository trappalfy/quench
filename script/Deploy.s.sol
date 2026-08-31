// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {HookMiner} from "../test/shared/HookMiner.sol";
import {BlockHook} from "../src/hook/BlockHook.sol";
import {BoundedRouter} from "../src/BoundedRouter.sol";
import {Launchpad} from "../src/Launchpad.sol";
import {HookDeployer} from "../src/hook/HookDeployer.sol";

/// @notice The five-step deployment. The order matters and is not negotiable:
/// every link between the contracts is immutable, which is only possible if each
/// one exists before the contract that names it.
///
///   1. BoundedRouter        depends on nothing but the PoolManager
///   2. HookDeployer         carries the hook creation code, nothing else
///   3. Launchpad            names both; builds the curve implementation
///   4. mine a salt          for BlockHook(manager, launchpad, router),
///                           deployed *by the HookDeployer*
///   5. Launchpad.deployHook the hook builds its own PotVault
///
/// HookDeployer is split out for a hard reason: with the hook constructed
/// inside the launchpad, the launchpad came to 33kB and could not be deployed
/// at all. The naive order in the spec is also circular: the hook needs the launchpad's
/// address to recognise it, the launchpad needs the hook's to build pool keys,
/// and under CREATE2 both are fixed by creation code that contains the other.
contract DeployScript is Script {
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 internal constant HOOK_FLAGS = 0x28CC;

    /// @dev The signer is supplied by the CLI (`--account`, `--ledger`, or
    /// `--interactive`), never read from a file or an environment variable. A
    /// deployment key is a bearer credential: keeping it out of the repository,
    /// out of the shell history and out of the process environment is free.
    function run() external {
        address protocolFeeRecipient = vm.envAddress("PROTOCOL_FEE_RECIPIENT");
        uint256 maxPoolEthWei = vm.envUint("MAX_POOL_ETH_WEI");

        require(POOL_MANAGER.code.length > 0, "PoolManager is not deployed on this chain");
        require(CREATE2_DEPLOYER.code.length > 0, "CREATE2 deployer is missing");
        require(protocolFeeRecipient != address(0), "PROTOCOL_FEE_RECIPIENT is unset");
        require(maxPoolEthWei > 0, "MAX_POOL_ETH_WEI is unset");

        IPoolManager manager = IPoolManager(POOL_MANAGER);

        vm.startBroadcast();

        BoundedRouter router = new BoundedRouter(manager);
        HookDeployer hookDeployer = new HookDeployer(manager);
        Launchpad launchpad =
            new Launchpad(manager, address(router), protocolFeeRecipient, maxPoolEthWei, hookDeployer);

        // Roughly 16k attempts for 14 bits: seconds of work, not minutes.
        bytes memory args = abi.encode(manager, address(launchpad), address(router));
        (address expected, bytes32 salt) =
            HookMiner.find(address(hookDeployer), HOOK_FLAGS, type(BlockHook).creationCode, args);

        address hook = launchpad.deployHook(salt);

        vm.stopBroadcast();

        require(hook == expected, "hook did not land on the mined address");
        require(uint160(hook) & 0x3FFF == HOOK_FLAGS, "hook address lacks the required flags");
        require(BlockHook(payable(hook)).launchpad() == address(launchpad), "hook is wired to the wrong launchpad");
        require(BlockHook(payable(hook)).router() == address(router), "hook is wired to the wrong router");
        require(BlockHook(payable(hook)).potVault().hook() == hook, "vault is wired to the wrong hook");

        _write(address(router), address(launchpad), hook, salt, protocolFeeRecipient, maxPoolEthWei);
    }

    function _write(
        address router,
        address launchpad,
        address hook,
        bytes32 salt,
        address protocolFeeRecipient,
        uint256 maxPoolEthWei
    ) internal {
        address vault = address(BlockHook(payable(hook)).potVault());
        address curveImpl = Launchpad(payable(launchpad)).curveImplementation();

        console2.log("BoundedRouter        ", router);
        console2.log("Launchpad            ", launchpad);
        console2.log("BlockHook            ", hook);
        console2.log("PotVault             ", vault);
        console2.log("BondingCurve (impl)  ", curveImpl);
        console2.log("hook salt            ", vm.toString(salt));

        string memory json = string.concat(
            '{\n  "chainId": ',
            vm.toString(block.chainid),
            ',\n  "poolManager": "',
            vm.toString(POOL_MANAGER),
            '",\n  "boundedRouter": "',
            vm.toString(router),
            '",\n  "launchpad": "',
            vm.toString(launchpad),
            '",\n  "blockHook": "',
            vm.toString(hook),
            '",\n  "potVault": "',
            vm.toString(vault),
            '",\n  "curveImplementation": "',
            vm.toString(curveImpl),
            '",\n  "hookSalt": "',
            vm.toString(salt),
            '",\n  "protocolFeeRecipient": "',
            vm.toString(protocolFeeRecipient),
            '",\n  "maxPoolEthWei": "',
            vm.toString(maxPoolEthWei),
            '",\n  "deployBlock": ',
            vm.toString(block.number),
            "\n}\n"
        );

        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
    }
}
