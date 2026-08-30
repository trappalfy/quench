// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BlockConfig} from "../lib/BlockConfig.sol";

/// @notice One launched token, everything the reading layer needs about it.
struct LaunchRecord {
    address token;
    address creator;
    uint64 launchBlock;
    uint16 creatorFeeBps;
    uint64 blueprintId;
    address curve; // address(0) for instant launches
    bool graduated;
    uint160 sqrtPriceX96;
    BlockConfig cfg;
}

/// @notice A published, reusable block configuration that earns its author a
/// royalty on every launch that uses it.
struct Blueprint {
    address author;
    uint16 royaltyBps;
    BlockConfig cfg;
}

struct InstantParams {
    string name;
    string symbol;
    BlockConfig cfg;
    uint16 creatorFeeBps;
    uint64 blueprintId; // 0 = none
    uint160 sqrtPriceX96;
}

struct CurveParams {
    string name;
    string symbol;
    BlockConfig cfg;
    uint16 creatorFeeBps;
    uint64 blueprintId;
    uint256 p0; // wei of ETH per 1e18 token units, at tranche 0
}

interface ILaunchpad {
    function launchInstant(InstantParams calldata p) external payable returns (address token);
    function launchCurve(CurveParams calldata p) external returns (address token, address curve);
    function publishBlueprint(BlockConfig calldata cfg, uint16 royaltyBps) external returns (uint256 id);
    function claimFees(address token) external;
    function graduate(address token, uint160 sqrtPriceX96) external payable;

    function launchCount() external view returns (uint256);
    function tokenAt(uint256 i) external view returns (address);
    function launchRecord(address token) external view returns (LaunchRecord memory);
    function poolKeyOf(address token) external view returns (PoolKey memory);
    function blueprintCount() external view returns (uint256);
    function blueprintAt(uint256 i) external view returns (Blueprint memory);
    function hook() external view returns (address);
    function maxPoolEthWei() external view returns (uint256);
}
