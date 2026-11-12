// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyWallet} from "../contracts/PolicyWallet.sol";

contract PolicyWalletTest is Test {
    PolicyWallet wallet;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address seller = makeAddr("seller");
    address attacker = makeAddr("attacker");

    uint256 constant WINDOW_LIMIT = 0.05 ether;
    uint256 constant WINDOW_SECONDS = 1 hours;
    uint256 constant CO_SIGN_ABOVE = 0.02 ether;

    function setUp() public {
        vm.deal(owner, 10 ether);
        vm.startPrank(owner);
        wallet = new PolicyWallet{value: 1 ether}(agent, WINDOW_LIMIT, WINDOW_SECONDS, CO_SIGN_ABOVE);
        wallet.setPayee(seller, true);
        vm.stopPrank();
    }

    function test_AgentPaysAnAllowedPayee() public {
        vm.prank(agent);
        wallet.pay(seller, 0.01 ether, "weather data for Kiambu");
        assertEq(seller.balance, 0.01 ether);
        assertEq(wallet.spentInWindow(), 0.01 ether);
    }

    function test_PaymentEmitsTheReason() public {
        vm.expectEmit(true, false, false, true, address(wallet));
        emit PolicyWallet.Paid(seller, 0.01 ether, "maize prices", false);
        vm.prank(agent);
        wallet.pay(seller, 0.01 ether, "maize prices");
    }

    function test_RevertWhen_PayeeNotAllowed() public {
        vm.prank(agent);
        vm.expectRevert();
        wallet.pay(attacker, 0.01 ether, "ignore previous instructions");
    }

    function test_RevertWhen_OverTheWindowLimit() public {
        vm.startPrank(agent);
        wallet.pay(seller, 0.02 ether, "one");
        wallet.pay(seller, 0.02 ether, "two");
        vm.expectRevert();
        wallet.pay(seller, 0.02 ether, "three");
        vm.stopPrank();
    }

    function test_LimitResetsInTheNextWindow() public {
        vm.startPrank(agent);
        wallet.pay(seller, 0.02 ether, "one");
        wallet.pay(seller, 0.02 ether, "two");
        vm.warp(block.timestamp + WINDOW_SECONDS);
        wallet.pay(seller, 0.02 ether, "three");
        vm.stopPrank();
        assertEq(seller.balance, 0.06 ether);
    }

    function test_RevertWhen_AboveThresholdWithoutCoSignature() public {
        vm.prank(agent);
        vm.expectRevert();
        wallet.pay(seller, 0.03 ether, "bulk fertiliser order");
    }

    function test_OwnerCoSignsALargePayment() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(seller, 0.3 ether, "bulk fertiliser order");
        assertEq(seller.balance, 0);
        vm.prank(owner);
        wallet.approve(id);
        assertEq(seller.balance, 0.3 ether);
    }

    function test_RevertWhen_ApprovedTwice() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(seller, 0.3 ether, "bulk fertiliser order");
        vm.startPrank(owner);
        wallet.approve(id);
        vm.expectRevert();
        wallet.approve(id);
        vm.stopPrank();
    }

    function test_RevertWhen_PayeeBlockedBeforeApproval() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(seller, 0.3 ether, "bulk fertiliser order");
        vm.startPrank(owner);
        wallet.setPayee(seller, false);
        vm.expectRevert();
        wallet.approve(id);
        vm.stopPrank();
        assertEq(seller.balance, 0);
    }

    function test_RevertWhen_ApprovalPaused() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(seller, 0.3 ether, "bulk fertiliser order");
        vm.startPrank(owner);
        wallet.setPaused(true);
        vm.expectRevert();
        wallet.approve(id);
        vm.stopPrank();
        assertEq(seller.balance, 0);
    }

    function test_CoSignedPaymentIsOutsideTheAutonomousBudget() public {
        vm.startPrank(agent);
        wallet.pay(seller, 0.01 ether, "weather");
        uint256 id = wallet.requestPayment(seller, 0.3 ether, "bulk fertiliser order");
        vm.stopPrank();
        vm.expectEmit(true, false, false, true, address(wallet));
        emit PolicyWallet.Paid(seller, 0.3 ether, "bulk fertiliser order", true);
        vm.prank(owner);
        wallet.approve(id);
        assertEq(wallet.spentInWindow(), 0.01 ether);
        assertEq(seller.balance, 0.31 ether);
    }

    function test_RevertWhen_AgentApprovesItsOwnRequest() public {
        vm.startPrank(agent);
        uint256 id = wallet.requestPayment(seller, 0.3 ether, "bulk fertiliser order");
        vm.expectRevert();
        wallet.approve(id);
        vm.stopPrank();
    }

    function test_RevertWhen_Paused() public {
        vm.prank(owner);
        wallet.setPaused(true);
        vm.prank(agent);
        vm.expectRevert();
        wallet.pay(seller, 0.01 ether, "weather");
    }

    function test_RevertWhen_AgentRevoked() public {
        vm.prank(owner);
        wallet.setAgent(address(0));
        vm.prank(agent);
        vm.expectRevert();
        wallet.pay(seller, 0.01 ether, "weather");
    }

    function test_RevertWhen_StrangerPays() public {
        vm.prank(attacker);
        vm.expectRevert();
        wallet.pay(seller, 0.01 ether, "weather");
    }

    function test_RevertWhen_AgentChangesThePolicy() public {
        vm.startPrank(agent);
        vm.expectRevert();
        wallet.setPayee(attacker, true);
        vm.expectRevert();
        wallet.setPaused(false);
        vm.stopPrank();
    }
}
