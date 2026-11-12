// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Commons} from "../contracts/Commons.sol";

contract CommonsTest is Test {
    Commons commons;

    uint256 constant CAPACITY = 1000;
    uint256 constant COLLAPSE_BELOW = 100;
    uint256 constant GROWTH_PERCENT = 50;
    uint256 constant ROUND_SECONDS = 30;
    uint256 constant BOAT = 50;

    address amina = makeAddr("amina");
    address brian = makeAddr("brian");
    address stranger = makeAddr("stranger");

    function setUp() public {
        commons = new Commons(CAPACITY, COLLAPSE_BELOW, GROWTH_PERCENT, ROUND_SECONDS, BOAT);
        vm.prank(amina);
        commons.join("Amina");
        vm.prank(brian);
        commons.join("Brian");
    }

    function _nextRound() internal {
        vm.warp(block.timestamp + ROUND_SECONDS);
    }

    function test_StartsFull() public view {
        assertEq(commons.stock(), CAPACITY);
        assertEq(commons.stockNow(), CAPACITY);
        assertEq(commons.currentRound(), 0);
        assertFalse(commons.collapsed());
    }

    function test_JoinRegistersPlayers() public view {
        (address[] memory players, string[] memory names, uint256[] memory harvested) = commons.scoreboard();
        assertEq(players.length, 2);
        assertEq(players[0], amina);
        assertEq(names[1], "Brian");
        assertEq(harvested[0], 0);
    }

    function test_RevertWhen_JoiningTwice() public {
        vm.prank(amina);
        vm.expectRevert();
        commons.join("Amina again");
    }

    function test_HarvestTakesFromTheStock() public {
        vm.prank(amina);
        commons.harvest(BOAT);
        assertEq(commons.stock(), CAPACITY - BOAT);
        assertEq(commons.harvestedBy(amina), BOAT);
    }

    function test_RevertWhen_HarvestingTwiceInARound() public {
        vm.startPrank(amina);
        commons.harvest(10);
        vm.expectRevert();
        commons.harvest(10);
        vm.stopPrank();
    }

    function test_CanHarvestAgainNextRound() public {
        vm.startPrank(amina);
        commons.harvest(10);
        _nextRound();
        commons.harvest(10);
        vm.stopPrank();
        assertEq(commons.harvestedBy(amina), 20);
    }

    function test_RevertWhen_HarvestingMoreThanTheBoat() public {
        vm.prank(amina);
        vm.expectRevert();
        commons.harvest(BOAT + 1);
    }

    function test_RevertWhen_StrangerHarvests() public {
        vm.prank(stranger);
        vm.expectRevert();
        commons.harvest(1);
    }

    function test_StockRegrowsBetweenRounds() public {
        vm.prank(amina);
        commons.harvest(BOAT);
        vm.prank(brian);
        commons.harvest(BOAT);
        uint256 afterHarvest = commons.stock();
        _nextRound();
        uint256 expected = afterHarvest + afterHarvest * GROWTH_PERCENT * (CAPACITY - afterHarvest) / (CAPACITY * 100);
        assertEq(commons.stockNow(), expected);
        vm.prank(amina);
        commons.harvest(1);
        assertEq(commons.stock(), expected - 1);
    }

    function test_CollapsesForGoodBelowTheThreshold() public {
        address[] memory boats = new address[](20);
        for (uint256 i = 0; i < boats.length; i++) {
            boats[i] = makeAddr(string(abi.encodePacked("boat", vm.toString(i))));
            vm.prank(boats[i]);
            commons.join("Boat");
        }
        for (uint256 i = 0; i < boats.length && !commons.collapsed(); i++) {
            vm.prank(boats[i]);
            commons.harvest(BOAT);
        }
        assertTrue(commons.collapsed());

        _nextRound();
        _nextRound();
        assertLt(commons.stockNow(), COLLAPSE_BELOW);

        vm.prank(amina);
        vm.expectRevert();
        commons.harvest(1);
    }
}
