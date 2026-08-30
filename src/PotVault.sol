// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPotVault} from "./interfaces/IPotVault.sol";

/// @title PotVault
/// @notice Holds the Nth-buy pot for every pool. Deliberately small enough to be
/// audited by reading it. Only the hook can move funds, and there is no
/// withdrawal path for anyone else — not the deployer, not an owner, nobody.
contract PotVault is IPotVault {
    /// @notice Gas forwarded to a winner. Enough for an EOA or a plain receive(),
    /// not enough to reenter this contract in any meaningful way.
    uint256 internal constant PAYOUT_GAS = 30_000;

    error NotHook();
    error InsufficientPot();

    event Funded(PoolId indexed id, uint256 amount);
    event Paid(PoolId indexed id, address indexed to, uint256 amount);
    event PayoutFailed(PoolId indexed id, address indexed to, uint256 amount);

    /// @notice The hook that deployed this vault. Set once, at construction.
    address public immutable hook;

    mapping(PoolId => uint256) internal _potOf;

    constructor() {
        hook = msg.sender;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    /// @inheritdoc IPotVault
    function fund(PoolId id) external payable onlyHook {
        _potOf[id] += msg.value;
        emit Funded(id, msg.value);
    }

    /// @inheritdoc IPotVault
    /// @dev A failed payout must never revert the swap that triggered it: the hook
    /// is immutable, so a recipient that rejects ETH would brick the pool forever.
    /// The funds go back to the pot instead.
    function pay(PoolId id, address to, uint256 amount) external onlyHook {
        uint256 pot = _potOf[id];
        if (amount > pot) revert InsufficientPot();
        unchecked {
            _potOf[id] = pot - amount;
        }

        (bool ok,) = to.call{value: amount, gas: PAYOUT_GAS}("");
        if (ok) {
            emit Paid(id, to, amount);
        } else {
            _potOf[id] += amount;
            emit PayoutFailed(id, to, amount);
        }
    }

    /// @inheritdoc IPotVault
    function balanceOf(PoolId id) external view returns (uint256) {
        return _potOf[id];
    }
}
