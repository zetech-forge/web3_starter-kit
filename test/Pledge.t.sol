// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pledge} from "../contracts/Pledge.sol";

contract PledgeTest is Test {
    Pledge pledge;

    address pledger = makeAddr("pledger");
    address referee = makeAddr("referee");
    address charity = makeAddr("charity");
    address stranger = makeAddr("stranger");

    uint256 constant STAKE = 1 ether;
    uint256 constant ONE_WEEK = 7 days;

    function setUp() public {
        pledge = new Pledge();
        vm.deal(pledger, 10 ether);
    }

    function _create() internal returns (uint256 id) {
        vm.prank(pledger);
        id = pledge.create{value: STAKE}("Attend every lecture this week", ONE_WEEK, referee, charity);
    }

    function test_CreateStoresThePledge() public {
        uint256 id = _create();
        (address who, string memory goal, uint256 stake, uint256 deadline, address ref, address to, Pledge.Status status) =
            pledge.pledges(id);
        assertEq(who, pledger);
        assertEq(goal, "Attend every lecture this week");
        assertEq(stake, STAKE);
        assertEq(deadline, block.timestamp + ONE_WEEK);
        assertEq(ref, referee);
        assertEq(to, charity);
        assertEq(uint256(status), uint256(Pledge.Status.Active));
        assertEq(pledge.count(), 1);
        assertEq(address(pledge).balance, STAKE);
    }

    function test_CreateNeedsAStake() public {
        vm.prank(pledger);
        vm.expectRevert();
        pledge.create("No skin in the game", ONE_WEEK, referee, charity);
    }

    function test_CreateRejectsSelfReferee() public {
        vm.prank(pledger);
        vm.expectRevert();
        pledge.create{value: STAKE}("Trust me", ONE_WEEK, pledger, charity);
    }

    function test_RefereeConfirmReturnsTheStake() public {
        uint256 id = _create();
        uint256 before = pledger.balance;
        vm.prank(referee);
        pledge.confirm(id);
        assertEq(pledger.balance, before + STAKE);
        (,,,,,, Pledge.Status status) = pledge.pledges(id);
        assertEq(uint256(status), uint256(Pledge.Status.Succeeded));
    }

    function test_ReleaseAfterDeadlinePaysTheCharity() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK + 1);
        vm.prank(stranger);
        pledge.release(id);
        assertEq(charity.balance, STAKE);
        (,,,,,, Pledge.Status status) = pledge.pledges(id);
        assertEq(uint256(status), uint256(Pledge.Status.Failed));
    }

    function test_RevertWhen_PledgerConfirmsTheirOwnPledge() public {
        uint256 id = _create();
        vm.prank(pledger);
        vm.expectRevert();
        pledge.confirm(id);
    }

    function test_RevertWhen_PledgerReleasesBeforeDeadline() public {
        uint256 id = _create();
        vm.prank(pledger);
        vm.expectRevert();
        pledge.release(id);
    }

    function test_RevertWhen_StrangerConfirms() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert();
        pledge.confirm(id);
    }

    function test_RevertWhen_ConfirmAfterDeadline() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK + 1);
        vm.prank(referee);
        vm.expectRevert();
        pledge.confirm(id);
    }

    function test_RevertWhen_ConfirmedTwice() public {
        uint256 id = _create();
        vm.prank(referee);
        pledge.confirm(id);
        vm.prank(referee);
        vm.expectRevert();
        pledge.confirm(id);
    }

    function test_RevertWhen_ReleasedAfterSuccess() public {
        uint256 id = _create();
        vm.prank(referee);
        pledge.confirm(id);
        vm.warp(block.timestamp + ONE_WEEK + 1);
        vm.expectRevert();
        pledge.release(id);
    }

    function test_RefereeCanConfirmOneSecondBeforeTheDeadline() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK - 1);
        vm.prank(referee);
        pledge.confirm(id);
        assertEq(pledger.balance, 10 ether);
    }

    function test_RevertWhen_ConfirmAtTheDeadline() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK);
        vm.prank(referee);
        vm.expectRevert("The deadline has been reached");
        pledge.confirm(id);
    }

    function test_RevertWhen_ReleasedOneSecondBeforeTheDeadline() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK - 1);
        vm.expectRevert("The deadline has not been reached yet");
        pledge.release(id);
    }

    function test_ReleaseAtTheDeadlinePaysTheCharity() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK);
        vm.prank(stranger);
        pledge.release(id);
        assertEq(charity.balance, STAKE);
        (,,,,,, Pledge.Status status) = pledge.pledges(id);
        assertEq(uint256(status), uint256(Pledge.Status.Failed));
    }

    function test_RevertWhen_ReleasedTwice() public {
        uint256 id = _create();
        vm.warp(block.timestamp + ONE_WEEK + 1);
        pledge.release(id);
        vm.expectRevert();
        pledge.release(id);
    }
}
