// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Commons} from "../contracts/Commons.sol";

contract ReserveCommons is Commons {
    constructor() Commons(1000, 100, 50, 30, 50) {}

    function _mechanism(address, uint256 amount) internal view override {
        require(stock - amount >= 950, "Protected reserve");
    }
}

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

    function _slowCommons() internal returns (Commons lake) {
        lake = new Commons(1_000_000, COLLAPSE_BELOW, 1, ROUND_SECONDS, 500_000);
        vm.startPrank(amina);
        lake.join("Amina");
        lake.harvest(500_000);
        vm.stopPrank();
    }

    function _slowGrowth(uint256 stock, uint256 rounds) internal pure returns (uint256) {
        for (uint256 i = 0; i < rounds; i++) {
            stock += stock * (1_000_000 - stock) / (1_000_000 * 100);
        }
        return stock;
    }

    function test_CatchesUpMoreThan100MissedRounds() public {
        Commons lake = _slowCommons();
        vm.warp(lake.startTime() + 150 * ROUND_SECONDS);
        uint256 expected = _slowGrowth(500_000, 150);
        assertGt(expected, _slowGrowth(500_000, 100));
        assertEq(lake.stockNow(), expected);
    }

    function test_LongIdleHarvestDoesNotSkipRegeneration() public {
        Commons lake = _slowCommons();
        vm.warp(lake.startTime() + 150 * ROUND_SECONDS);
        vm.prank(amina);
        lake.harvest(1);
        uint256 expected = _slowGrowth(500_000, 150) - 1;
        assertEq(lake.stock(), expected);
        assertEq(lake.syncedRound(), 150);
        vm.warp(lake.startTime() + 151 * ROUND_SECONDS);
        assertEq(lake.stockNow(), _slowGrowth(expected, 1));
    }

    function test_LongIdleStopsAtAnIntegerGrowthFixedPoint() public {
        vm.prank(amina);
        commons.harvest(BOAT);
        vm.warp(commons.startTime() + 1_000_000 * ROUND_SECONDS);
        assertEq(commons.stockNow(), 998);
        vm.prank(amina);
        commons.harvest(1);
        assertEq(commons.stock(), 997);
        assertEq(commons.syncedRound(), 1_000_000);
    }

    function test_CustomMechanismRejectsDirectHarvestCalls() public {
        ReserveCommons protectedLake = new ReserveCommons();
        vm.startPrank(amina);
        protectedLake.join("Amina");
        protectedLake.harvest(50);
        vm.stopPrank();
        vm.startPrank(brian);
        protectedLake.join("Brian");
        vm.expectRevert("Protected reserve");
        protectedLake.harvest(1);
        vm.stopPrank();
        assertEq(protectedLake.stock(), 950);
        assertEq(protectedLake.harvestedBy(brian), 0);
    }

    function test_CollapseThresholdIsStrictlyBelowTheThreshold() public {
        Commons lake = new Commons(1000, 100, 50, 30, 1000);
        vm.startPrank(amina);
        lake.join("Amina");
        lake.harvest(900);
        vm.stopPrank();
        assertEq(lake.stock(), 100);
        assertFalse(lake.collapsed());
        vm.startPrank(brian);
        lake.join("Brian");
        lake.harvest(1);
        vm.stopPrank();
        assertTrue(lake.collapsed());
        vm.warp(lake.startTime() + 150 * ROUND_SECONDS);
        assertEq(lake.stockNow(), 99);
        vm.prank(amina);
        vm.expectRevert("The commons has collapsed");
        lake.harvest(1);
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
