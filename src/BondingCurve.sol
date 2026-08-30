// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {IBondingCurve} from "./interfaces/IBondingCurve.sol";

interface ILaunchpadForCurve {
    function graduate(address token, uint160 sqrtPriceX96) external payable;
    function protocolFeeRecipient() external view returns (address);
}

/// @title BondingCurve
/// @notice Ten tranches of 80 million tokens, each priced 1.7x the last. Selling
/// the tenth tranche graduates the token into a Uniswap v4 pool in the same
/// transaction.
/// @dev One clone per launch, never one contract for all of them. A shared curve
/// would hold every live sale's ETH in one place, which is exactly what section 3
/// of the spec forbids: a bug in one sale must not reach another sale's money.
contract BondingCurve is IBondingCurve {
    error AlreadyGraduated();
    error AlreadyInitialized();
    error NotLaunchpad();
    error TooLittleReceived();
    error NothingToTrade();
    error TransferFailed();

    event Bought(address indexed buyer, address indexed recipient, uint256 ethIn, uint256 tokensOut);
    event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut);
    event Graduated(address indexed token, uint256 ethToPool, uint160 sqrtPriceX96);

    uint256 public constant TRANCHE_SIZE = 80_000_000e18;
    uint256 public constant TRANCHES = 10;
    uint256 public constant CURVE_SUPPLY = TRANCHE_SIZE * TRANCHES; // 80% of supply
    uint256 public constant TRADE_FEE_BPS = 100; // 1%, split evenly

    /// @notice The launchpad that deployed this implementation. Clones inherit it
    /// from the implementation's code, so it is the same for every sale.
    address public immutable launchpad;

    address public token;
    address public creator;
    uint256 public p0;
    uint256 public sold;
    uint256 public raised;
    bool public graduated;
    bool internal _initialized;

    constructor() {
        launchpad = msg.sender;
    }

    /// @notice 1.7^i scaled by 1e18.
    /// @dev Exact, not approximate: 1.7^i == 17^i / 10^i, and 1.7^9 has exactly
    /// nine decimal places, so every entry is 17^i * 10^(18-i) with no rounding.
    function POW17(uint8 i) public pure returns (uint256) {
        if (i == 0) return 1_000000000000000000;
        if (i == 1) return 1_700000000000000000;
        if (i == 2) return 2_890000000000000000;
        if (i == 3) return 4_913000000000000000;
        if (i == 4) return 8_352100000000000000;
        if (i == 5) return 14_198570000000000000;
        if (i == 6) return 24_137569000000000000;
        if (i == 7) return 41_033867300000000000;
        if (i == 8) return 69_757574410000000000;
        if (i == 9) return 118_587876497000000000;
        revert("tranche out of range");
    }

    /// @notice Sum of the ten table entries: 286.570557207e18.
    function POW17_SUM() public pure returns (uint256) {
        return 286_570557207000000000;
    }

    /// @dev A clone holds ETH, so every entry point that moves it is guarded.
    /// Transient storage, so the flag costs nothing beyond the transaction.
    modifier nonReentrant() {
        assembly ("memory-safe") {
            if tload(0) { revert(0, 0) }
            tstore(0, 1)
        }
        _;
        assembly ("memory-safe") {
            tstore(0, 0)
        }
    }

    function initialize(address token_, uint256 p0_, address creator_) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        if (_initialized) revert AlreadyInitialized();
        if (p0_ == 0 || token_ == address(0)) revert NothingToTrade();
        _initialized = true;
        token = token_;
        p0 = p0_;
        creator = creator_;
    }

    /// @notice Wei of ETH per 1e18 token units inside tranche `i`.
    function priceOfTranche(uint8 i) public view returns (uint256) {
        return FullMath.mulDiv(p0, POW17(i), 1e18);
    }

    /// @notice Index of the tranche that the next token comes from, clamped to the
    /// last tranche once the curve is exhausted.
    function trancheOf(uint256 soldSoFar) public pure returns (uint8) {
        if (soldSoFar >= CURVE_SUPPLY) return uint8(TRANCHES - 1);
        return uint8(soldSoFar / TRANCHE_SIZE);
    }

    /// @notice ETH collected if every tranche sells out, before the trade fee.
    /// @dev Each tranche costs 80_000_000 * p0 * 1.7^i / 1e18, so the total is
    /// p0 * 80_000_000 * sum(1.7^i) / 1e18.
    function totalRaiseAtFullSellout(uint256 p0_) public pure returns (uint256) {
        return FullMath.mulDiv(p0_, 80_000_000 * POW17_SUM(), 1e18);
    }

    /// @notice What `ethIn` buys right now, before the trade fee is deducted.
    function quoteBuy(uint256 ethIn) public view returns (uint256 tokensOut, uint256 spent, bool graduates) {
        uint256 net = ethIn - (ethIn * TRADE_FEE_BPS) / 10_000;
        (tokensOut, spent) = _walkUp(sold, net);
        graduates = sold + tokensOut >= CURVE_SUPPLY;
    }

    function buy(uint256 minTokensOut, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (graduated) revert AlreadyGraduated();
        if (msg.value == 0) revert NothingToTrade();

        uint256 fee = (msg.value * TRADE_FEE_BPS) / 10_000;
        uint256 net = msg.value - fee;

        uint256 spent;
        (tokensOut, spent) = _walkUp(sold, net);
        if (tokensOut == 0) revert NothingToTrade();
        if (tokensOut < minTokensOut) revert TooLittleReceived();

        sold += tokensOut;
        raised += spent;

        if (!IERC20Minimal(token).transfer(recipient, tokensOut)) revert TransferFailed();

        // Anything the curve could not absorb goes straight back to the buyer.
        uint256 refund = net - spent;
        if (refund > 0) _send(msg.sender, refund);
        _payFee(fee);

        emit Bought(msg.sender, recipient, msg.value, tokensOut);

        if (sold >= CURVE_SUPPLY) _graduate();
    }

    function sell(uint256 tokens, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (graduated) revert AlreadyGraduated();
        if (tokens == 0 || tokens > sold) revert NothingToTrade();

        uint256 gross = _walkDown(sold, tokens);
        uint256 fee = (gross * TRADE_FEE_BPS) / 10_000;
        ethOut = gross - fee;
        if (ethOut < minEthOut) revert TooLittleReceived();

        sold -= tokens;
        raised -= gross;

        if (!IERC20Minimal(token).transferFrom(msg.sender, address(this), tokens)) revert TransferFailed();
        _payFee(fee);
        _send(msg.sender, ethOut);

        emit Sold(msg.sender, tokens, ethOut);
    }

    /// @dev Walks up the tranches spending at most `ethNet`.
    function _walkUp(uint256 soldSoFar, uint256 ethNet)
        internal
        view
        returns (uint256 tokensOut, uint256 spent)
    {
        uint256 remaining = ethNet;
        uint256 cursor = soldSoFar;

        for (uint256 step; step < TRANCHES && remaining > 0 && cursor < CURVE_SUPPLY; step++) {
            uint8 i = uint8(cursor / TRANCHE_SIZE);
            uint256 left = (uint256(i) + 1) * TRANCHE_SIZE - cursor;
            uint256 price = priceOfTranche(i);

            uint256 costOfRest = FullMath.mulDiv(left, price, 1e18);
            if (remaining >= costOfRest) {
                tokensOut += left;
                spent += costOfRest;
                remaining -= costOfRest;
                cursor += left;
            } else {
                uint256 affordable = FullMath.mulDiv(remaining, 1e18, price);
                tokensOut += affordable;
                spent += FullMath.mulDiv(affordable, price, 1e18);
                cursor += affordable;
                remaining = 0;
            }
        }
    }

    /// @dev Walks back down the tranches, refunding at the price each token was
    /// bought at, so a buy immediately followed by a sell differs only by the fee.
    function _walkDown(uint256 soldSoFar, uint256 tokens) internal view returns (uint256 gross) {
        uint256 cursor = soldSoFar;
        uint256 remaining = tokens;

        for (uint256 step; step < TRANCHES && remaining > 0; step++) {
            uint8 i = trancheOf(cursor == 0 ? 0 : cursor - 1);
            uint256 intoTranche = cursor - uint256(i) * TRANCHE_SIZE;
            uint256 take = remaining < intoTranche ? remaining : intoTranche;

            gross += FullMath.mulDiv(take, priceOfTranche(i), 1e18);
            cursor -= take;
            remaining -= take;
        }
    }

    /// @dev The curve holds the collected ETH and nothing else; fees leave at once.
    function _payFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 half = fee / 2;
        _send(creator, half);
        _send(ILaunchpadForCurve(launchpad).protocolFeeRecipient(), fee - half);
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Hands the collected ETH to the launchpad, which opens the pool at the
    /// tranche-9 price and locks the liquidity. Flag first, call second.
    function _graduate() internal {
        graduated = true;

        uint256 priceFinal = FullMath.mulDiv(p0, POW17(9), 1e18);
        // The pool quotes token per ETH, the inverse of our price, so
        // sqrtPriceX96 = sqrt(1e18 / priceFinal) * 2^96.
        uint160 sqrtPriceX96 =
            uint160(FixedPointMathLib.sqrt(FullMath.mulDiv(1e18, 1 << 192, priceFinal)));

        uint256 toPool = raised;
        raised = 0;

        emit Graduated(token, toPool, sqrtPriceX96);
        ILaunchpadForCurve(launchpad).graduate{value: toPool}(token, sqrtPriceX96);
    }

    receive() external payable {}
}
