// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PolicyWallet {
    struct Request {
        address payee;
        uint256 amount;
        string reason;
        bool done;
    }

    address public immutable owner;
    uint256 public immutable windowLimit;
    uint256 public immutable windowSeconds;
    uint256 public immutable coSignAbove;

    address public agent;
    bool public paused;
    mapping(address => bool) public isAllowedPayee;
    uint256 public windowStart;
    uint256 public spentInWindow;
    Request[] public requests;

    event Paid(address indexed payee, uint256 amount, string reason, bool coSigned);
    event PaymentRequested(uint256 indexed id, address indexed payee, uint256 amount, string reason);
    event PayeeSet(address indexed payee, bool allowed);
    event AgentSet(address indexed agent);
    event PausedSet(bool paused);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can do this");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent && agent != address(0), "Only the agent can do this");
        _;
    }

    constructor(address agent_, uint256 windowLimit_, uint256 windowSeconds_, uint256 coSignAbove_) payable {
        owner = msg.sender;
        agent = agent_;
        windowLimit = windowLimit_;
        windowSeconds = windowSeconds_;
        coSignAbove = coSignAbove_;
        windowStart = block.timestamp;
    }

    receive() external payable {}

    function setPayee(address payee, bool allowed) external onlyOwner {
        isAllowedPayee[payee] = allowed;
        emit PayeeSet(payee, allowed);
    }

    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentSet(newAgent);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function pay(address payee, uint256 amount, string calldata reason) external onlyAgent {
        require(!paused, "The owner has paused the agent");
        require(isAllowedPayee[payee], "That payee is not on the allowlist");
        require(amount <= coSignAbove, "The owner must co-sign this payment");
        if (block.timestamp - windowStart >= windowSeconds) {
            windowStart = block.timestamp;
            spentInWindow = 0;
        }
        require(spentInWindow + amount <= windowLimit, "The spending window limit would be exceeded");
        spentInWindow += amount;
        emit Paid(payee, amount, reason, false);
        _send(payee, amount);
    }

    function requestPayment(address payee, uint256 amount, string calldata reason)
        external
        onlyAgent
        returns (uint256 id)
    {
        require(!paused, "The owner has paused the agent");
        require(isAllowedPayee[payee], "That payee is not on the allowlist");
        id = requests.length;
        requests.push(Request(payee, amount, reason, false));
        emit PaymentRequested(id, payee, amount, reason);
    }

    function approve(uint256 id) external onlyOwner {
        require(!paused, "The owner has paused the agent");
        Request storage r = requests[id];
        require(!r.done, "Already paid");
        require(isAllowedPayee[r.payee], "That payee is not on the allowlist");
        r.done = true;
        // Explicit owner approvals are outside the agent's autonomous spending budget.
        emit Paid(r.payee, r.amount, r.reason, true);
        _send(r.payee, r.amount);
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Transfer failed");
    }
}
