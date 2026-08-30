// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    LaunchToken internal token;
    address internal recipient = address(0xBEEF);

    function setUp() public {
        token = new LaunchToken("Test Token", "TEST", recipient);
    }

    function test_mintsEntireSupplyToRecipient() public view {
        assertEq(token.totalSupply(), 1_000_000_000e18);
        assertEq(token.balanceOf(recipient), 1_000_000_000e18);
    }

    function test_metadataIsImmutableAndCorrect() public view {
        assertEq(token.name(), "Test Token");
        assertEq(token.symbol(), "TEST");
        assertEq(token.decimals(), 18);
    }

    function test_transferMovesExactAmountWithNoFee() public {
        vm.prank(recipient);
        token.transfer(address(0xCAFE), 1_000e18);
        assertEq(token.balanceOf(address(0xCAFE)), 1_000e18);
        assertEq(token.balanceOf(recipient), 1_000_000_000e18 - 1_000e18);
        assertEq(token.totalSupply(), 1_000_000_000e18, "supply must not change on transfer");
    }

    /// No privileged surface may exist. This asserts on the ABI, not on behaviour.
    function test_hasNoPrivilegedFunctions() public view {
        address t = address(token);
        bytes4[5] memory forbidden = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("blacklist(address)")),
            bytes4(keccak256("setFee(uint256)"))
        ];
        for (uint256 i; i < forbidden.length; i++) {
            (bool ok,) = t.staticcall(abi.encodeWithSelector(forbidden[i]));
            assertFalse(ok, "token exposes a privileged function");
        }
    }

    function testFuzz_transferPreservesTotalSupply(uint256 amount) public {
        amount = bound(amount, 0, 1_000_000_000e18);
        vm.prank(recipient);
        token.transfer(address(0xCAFE), amount);
        assertEq(token.balanceOf(recipient) + token.balanceOf(address(0xCAFE)), token.totalSupply());
    }
}
