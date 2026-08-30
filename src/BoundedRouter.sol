// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

/// @title BoundedRouter
/// @notice The canonical way into a launched pool. Two jobs: bound the trade with
/// a minimum output and a deadline, and name the buyer to the hook.
/// @dev The second job is why this contract is mandatory rather than convenient.
/// A hook sees only `msg.sender`, which for any router is the router itself, and
/// the Nth-buy pot has to pay a person. This router puts the recipient in
/// hookData, and the hook trusts that field only when it is the caller.
/// The router never holds a balance between transactions.
contract BoundedRouter is IUnlockCallback {
    error Expired();
    error TooLittleReceived();
    error TooMuchSpent();
    error NoRecipient();
    error NotPoolManager();

    /// @dev Distinguishes the three shapes of trade inside the unlock callback.
    enum Kind {
        BuyExactIn,
        SellExactIn,
        BuyExactOut
    }

    struct Job {
        Kind kind;
        PoolKey key;
        uint256 amount;
        address payer;
        address recipient;
    }

    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    modifier bounded(address recipient, uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        if (recipient == address(0)) revert NoRecipient();
        _;
    }

    /// @notice Spend the attached ETH on tokens, sent straight to `recipient`.
    function buy(PoolKey calldata key, uint256 minAmountOut, address recipient, uint256 deadline)
        external
        payable
        bounded(recipient, deadline)
        returns (uint256 amountOut)
    {
        bytes memory res = poolManager.unlock(
            abi.encode(Job(Kind.BuyExactIn, key, msg.value, msg.sender, recipient))
        );
        amountOut = abi.decode(res, (uint256));
        if (amountOut < minAmountOut) revert TooLittleReceived();
    }

    /// @notice Buy an exact number of tokens, refunding whatever ETH is left over.
    function buyExactOutput(PoolKey calldata key, uint256 amountOut, address recipient, uint256 deadline)
        external
        payable
        bounded(recipient, deadline)
        returns (uint256 ethSpent)
    {
        bytes memory res = poolManager.unlock(
            abi.encode(Job(Kind.BuyExactOut, key, amountOut, msg.sender, recipient))
        );
        ethSpent = abi.decode(res, (uint256));
        if (ethSpent > msg.value) revert TooMuchSpent();
        unchecked {
            uint256 refund = msg.value - ethSpent;
            if (refund > 0) {
                (bool ok,) = msg.sender.call{value: refund}("");
                require(ok, "refund failed");
            }
        }
    }

    /// @notice Sell tokens for ETH, sent straight to `recipient`.
    function sell(PoolKey calldata key, uint256 amountIn, uint256 minEthOut, address recipient, uint256 deadline)
        external
        bounded(recipient, deadline)
        returns (uint256 ethOut)
    {
        bytes memory res =
            abi.encode(Job(Kind.SellExactIn, key, amountIn, msg.sender, recipient));
        ethOut = abi.decode(poolManager.unlock(res), (uint256));
        if (ethOut < minEthOut) revert TooLittleReceived();
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Job memory job = abi.decode(raw, (Job));

        bool zeroForOne = job.kind != Kind.SellExactIn;
        int256 amountSpecified =
            job.kind == Kind.BuyExactOut ? int256(job.amount) : -int256(job.amount);

        BalanceDelta delta = poolManager.swap(
            job.key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(job.recipient)
        );

        // Pay what is owed, collect what is due. Exactly one of each per trade.
        if (job.kind == Kind.SellExactIn) {
            _pay(job.key.currency1, job.payer, uint256(uint128(-delta.amount1())));
            uint256 ethOut = uint256(uint128(delta.amount0()));
            poolManager.take(job.key.currency0, job.recipient, ethOut);
            return abi.encode(ethOut);
        }

        uint256 ethIn = uint256(uint128(-delta.amount0()));
        _pay(job.key.currency0, job.payer, ethIn);
        uint256 tokensOut = uint256(uint128(delta.amount1()));
        poolManager.take(job.key.currency1, job.recipient, tokensOut);

        return abi.encode(job.kind == Kind.BuyExactOut ? ethIn : tokensOut);
    }

    /// @dev Native ETH is already held by this contract, sent with the call.
    /// Tokens are pulled from the seller, who must have approved this router.
    function _pay(Currency currency, address payer, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            require(
                IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(poolManager), amount),
                "transferFrom failed"
            );
            poolManager.settle();
        }
    }

    /// @dev Receives the leftover of an exact-output buy, refunded in the same call.
    receive() external payable {}
}
