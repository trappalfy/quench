// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PotVault} from "../../src/PotVault.sol";

/// Recipient that always rejects ETH — the pool must survive it.
contract RejectingRecipient {
    receive() external payable {
        revert("no thanks");
    }
}

/// Recipient that burns all forwarded gas.
contract GasBurningRecipient {
    uint256 public x;

    receive() external payable {
        while (true) {
            x++;
        }
    }
}

contract PotVaultTest is Test {
    PotVault internal vault;
    PoolId internal idA = PoolId.wrap(bytes32(uint256(1)));
    PoolId internal idB = PoolId.wrap(bytes32(uint256(2)));

    function setUp() public {
        vault = new PotVault();
        vm.deal(address(this), 100 ether);
    }

    function test_hookIsTheDeployer() public view {
        assertEq(vault.hook(), address(this));
    }

    function test_fundCreditsPerPool() public {
        vault.fund{value: 1 ether}(idA);
        vault.fund{value: 2 ether}(idB);
        assertEq(vault.balanceOf(idA), 1 ether);
        assertEq(vault.balanceOf(idB), 2 ether);
        assertEq(address(vault).balance, 3 ether);
    }

    function test_onlyHookCanFund() public {
        vm.deal(address(0xBAD), 1 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(PotVault.NotHook.selector);
        vault.fund{value: 1 ether}(idA);
    }

    function test_onlyHookCanPay() public {
        vault.fund{value: 1 ether}(idA);
        vm.prank(address(0xBAD));
        vm.expectRevert(PotVault.NotHook.selector);
        vault.pay(idA, address(0xCAFE), 1 ether);
    }

    function test_payTransfersAndDebits() public {
        vault.fund{value: 3 ether}(idA);
        vault.pay(idA, address(0xCAFE), 2 ether);
        assertEq(address(0xCAFE).balance, 2 ether);
        assertEq(vault.balanceOf(idA), 1 ether);
    }

    function test_cannotPayMoreThanPoolHas() public {
        vault.fund{value: 1 ether}(idA);
        vault.fund{value: 5 ether}(idB);
        vm.expectRevert(PotVault.InsufficientPot.selector);
        vault.pay(idA, address(0xCAFE), 2 ether);
    }

    function test_failedPayoutReturnsFundsToPotInsteadOfReverting() public {
        RejectingRecipient bad = new RejectingRecipient();
        vault.fund{value: 1 ether}(idA);
        vault.pay(idA, address(bad), 1 ether);
        assertEq(vault.balanceOf(idA), 1 ether, "funds must stay in the pot");
        assertEq(address(bad).balance, 0);
    }

    function test_gasBurningRecipientCannotStallTheCaller() public {
        GasBurningRecipient greedy = new GasBurningRecipient();
        vault.fund{value: 1 ether}(idA);
        uint256 gasBefore = gasleft();
        vault.pay(idA, address(greedy), 1 ether);
        assertLt(gasBefore - gasleft(), 100_000, "payout must be gas bounded");
        assertEq(vault.balanceOf(idA), 1 ether);
    }

    function test_vaultHasNoWithdrawalSurface() public view {
        bytes4[3] memory forbidden = [
            bytes4(keccak256("withdraw()")),
            bytes4(keccak256("owner()")),
            bytes4(keccak256("rescue(address,uint256)"))
        ];
        for (uint256 i; i < forbidden.length; i++) {
            (bool ok,) = address(vault).staticcall(abi.encodeWithSelector(forbidden[i]));
            assertFalse(ok, "vault exposes a withdrawal path");
        }
    }

    function testFuzz_vaultBalanceEqualsSumOfPools(uint96 a, uint96 b) public {
        vm.deal(address(this), uint256(a) + uint256(b));
        if (a > 0) vault.fund{value: a}(idA);
        if (b > 0) vault.fund{value: b}(idB);
        assertEq(address(vault).balance, vault.balanceOf(idA) + vault.balanceOf(idB));
    }
}
