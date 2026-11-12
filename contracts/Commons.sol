// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Commons {
    uint256 public constant MAX_CATCH_UP_ROUNDS = 100;

    uint256 public immutable capacity;
    uint256 public immutable collapseBelow;
    uint256 public immutable growthPercent;
    uint256 public immutable roundSeconds;
    uint256 public immutable maxPerHarvest;
    uint256 public immutable startTime;

    uint256 public stock;
    uint256 public syncedRound;
    bool public collapsed;

    address[] public players;
    mapping(address => string) public nameOf;
    mapping(address => uint256) public harvestedBy;
    mapping(address => uint256) public lastHarvestRound;
    mapping(address => bool) public hasHarvested;

    event Joined(address indexed player, string name);
    event Harvested(address indexed player, uint256 indexed round, uint256 amount, uint256 stockAfter);
    event Collapsed(uint256 indexed round);

    constructor(
        uint256 capacity_,
        uint256 collapseBelow_,
        uint256 growthPercent_,
        uint256 roundSeconds_,
        uint256 maxPerHarvest_
    ) {
        require(capacity_ > collapseBelow_, "Capacity must be above the collapse line");
        require(roundSeconds_ > 0, "Rounds need a length");
        capacity = capacity_;
        collapseBelow = collapseBelow_;
        growthPercent = growthPercent_;
        roundSeconds = roundSeconds_;
        maxPerHarvest = maxPerHarvest_;
        startTime = block.timestamp;
        stock = capacity_;
    }

    function join(string calldata name) external {
        require(bytes(nameOf[msg.sender]).length == 0, "You already joined");
        require(bytes(name).length > 0 && bytes(name).length <= 24, "Pick a name of 1 to 24 characters");
        players.push(msg.sender);
        nameOf[msg.sender] = name;
        emit Joined(msg.sender, name);
    }

    function harvest(uint256 amount) external {
        _sync();
        require(!collapsed, "The commons has collapsed");
        require(bytes(nameOf[msg.sender]).length > 0, "Join the game first");
        uint256 round = currentRound();
        require(!(hasHarvested[msg.sender] && lastHarvestRound[msg.sender] == round), "You already harvested this round");
        require(amount > 0 && amount <= maxPerHarvest, "Your boat cannot carry that");
        require(amount <= stock, "There is not that much left");

        _mechanism(msg.sender, amount);

        hasHarvested[msg.sender] = true;
        lastHarvestRound[msg.sender] = round;
        stock -= amount;
        harvestedBy[msg.sender] += amount;
        emit Harvested(msg.sender, round, amount, stock);

        if (stock < collapseBelow) {
            collapsed = true;
            emit Collapsed(round);
        }
    }

    function _mechanism(address player, uint256 amount) internal virtual {}

    function currentRound() public view returns (uint256) {
        return (block.timestamp - startTime) / roundSeconds;
    }

    function stockNow() public view returns (uint256) {
        return _grow(stock, _roundsToCatchUp());
    }

    function scoreboard()
        external
        view
        returns (address[] memory who, string[] memory names, uint256[] memory harvested)
    {
        uint256 n = players.length;
        who = players;
        names = new string[](n);
        harvested = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            names[i] = nameOf[players[i]];
            harvested[i] = harvestedBy[players[i]];
        }
    }

    function playerCount() external view returns (uint256) {
        return players.length;
    }

    function _sync() internal {
        stock = stockNow();
        syncedRound = currentRound();
    }

    function _roundsToCatchUp() internal view returns (uint256 rounds) {
        rounds = currentRound() - syncedRound;
        if (rounds > MAX_CATCH_UP_ROUNDS) rounds = MAX_CATCH_UP_ROUNDS;
    }

    function _grow(uint256 s, uint256 rounds) internal view returns (uint256) {
        if (collapsed) return s;
        for (uint256 i = 0; i < rounds; i++) {
            s += s * growthPercent * (capacity - s) / (capacity * 100);
        }
        return s;
    }
}
