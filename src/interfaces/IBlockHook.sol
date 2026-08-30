// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BlockConfig, PoolState} from "../lib/BlockConfig.sol";
import {IPotVault} from "./IPotVault.sol";

interface IBlockHook {
    function stageConfig(BlockConfig calldata cfg) external;
    function configOf(PoolId id) external view returns (BlockConfig memory);
    function stateOf(PoolId id) external view returns (PoolState memory);
    function potVault() external view returns (IPotVault);
    function launchpad() external view returns (address);
    function router() external view returns (address);
}
