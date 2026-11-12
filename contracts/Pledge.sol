// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Pledge {
    enum Status {
        Active,
        Succeeded,
        Failed
    }

    struct Commitment {
        address pledger;
        string goal;
        uint256 stake;
        uint256 deadline;
        address referee;
        address charity;
        Status status;
    }

    Commitment[] public pledges;

    event Created(uint256 indexed id, address indexed pledger, string goal, uint256 stake, uint256 deadline);
    event Succeeded(uint256 indexed id);
    event Failed(uint256 indexed id);

    function create(string calldata goal, uint256 durationSeconds, address referee, address charity)
        external
        payable
        returns (uint256 id)
    {
        require(msg.value > 0, "Stake some money on your goal");
        require(durationSeconds > 0, "The deadline must be in the future");
        require(referee != address(0) && referee != msg.sender, "Pick a referee who is not you");
        require(charity != address(0), "Pick a charity");

        id = pledges.length;
        uint256 deadline = block.timestamp + durationSeconds;
        pledges.push(Commitment(msg.sender, goal, msg.value, deadline, referee, charity, Status.Active));
        emit Created(id, msg.sender, goal, msg.value, deadline);
    }

    function confirm(uint256 id) external {
        Commitment storage p = pledges[id];
        require(msg.sender == p.referee, "Only the referee can confirm");
        require(block.timestamp <= p.deadline, "The deadline has passed");
        require(p.status == Status.Active, "The pledge is already settled");
        p.status = Status.Succeeded;
        emit Succeeded(id);
        _send(p.pledger, p.stake);
    }

    function release(uint256 id) external {
        Commitment storage p = pledges[id];
        require(block.timestamp > p.deadline, "The deadline has not passed yet");
        require(p.status == Status.Active, "The pledge is already settled");
        p.status = Status.Failed;
        emit Failed(id);
        _send(p.charity, p.stake);
    }

    function count() external view returns (uint256) {
        return pledges.length;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Transfer failed");
    }
}
