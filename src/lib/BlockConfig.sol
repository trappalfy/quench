// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Behaviour of the five blocks for a single pool. Set once, at pool
/// initialization, and never mutated afterwards. A block is off when its
/// parameters are zero.
struct BlockConfig {
    // Block 1 - Anti-Snipe
    uint32 guardBlocks;
    uint16 maxBuyBps;
    uint24 snipeTaxPips;
    // Block 2 - Surge Fees
    uint24 baseFeePips;
    uint24 maxFeePips;
    uint16 surgeSens;
    // Block 3 - Auto Burn
    uint16 burnBps;
    uint128 burnTriggerWei;
    // Block 4 - LP Rewards
    uint16 lpBps;
    // Block 5 - Nth-buy Pot
    uint16 potBps;
    uint16 potEveryN;
    uint128 potMinBuyWei;
}

/// @notice Mutable per-pool bookkeeping owned by the hook.
struct PoolState {
    uint64 startBlock;
    uint128 potBalance;
    uint32 potBuyCount;
    uint64 lastCountedBlock;
}
