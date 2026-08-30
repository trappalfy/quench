// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IPotVault {
    function fund(PoolId id) external payable;
    function pay(PoolId id, address to, uint256 amount) external;
    function balanceOf(PoolId id) external view returns (uint256);
    function hook() external view returns (address);
}
