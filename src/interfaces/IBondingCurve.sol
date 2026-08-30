// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IBondingCurve {
    function initialize(address token, uint256 p0, address creator) external;
    function buy(uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokens, uint256 minEthOut) external returns (uint256 ethOut);

    function quoteBuy(uint256 ethIn) external view returns (uint256 tokensOut, uint256 spent, bool graduates);
    function trancheOf(uint256 soldSoFar) external pure returns (uint8);
    function priceOfTranche(uint8 i) external view returns (uint256);
    function totalRaiseAtFullSellout(uint256 p0) external pure returns (uint256);

    function token() external view returns (address);
    function creator() external view returns (address);
    function p0() external view returns (uint256);
    function sold() external view returns (uint256);
    function raised() external view returns (uint256);
    function graduated() external view returns (bool);
}
