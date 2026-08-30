// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BlockHook} from "./BlockHook.sol";

/// @title HookDeployer
/// @notice Deploys BlockHook at a mined salt, and does nothing else.
/// @dev It exists for a hard reason, not a stylistic one. The launchpad used to
/// deploy the hook itself, which put the hook's 13kB of creation code inside the
/// launchpad's own bytecode and pushed it to 33kB — past the 24576-byte contract
/// limit, so it could not be deployed at all. Moving that one `new` out brings
/// the launchpad back under the limit with room to spare.
///
/// Trust is unaffected: the launchpad holds this address immutably and accepts a
/// hook only from here, so the hook can only ever be the real BlockHook.
contract HookDeployer {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    /// @notice CREATE2-deploys a hook. The caller mines `salt` against this
    /// contract's address, since this contract is the deployer.
    function deploy(bytes32 salt, address launchpad, address router) external returns (address) {
        return address(new BlockHook{salt: salt}(poolManager, launchpad, router));
    }
}
