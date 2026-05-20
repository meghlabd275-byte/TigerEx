// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TigerEx Smart Contracts
 * - Token Sale (IEO)
 * - Vesting 
 * - Staking
 */

contract TokenSale {
    address public owner;
    address public token;
    address public treasury;
    
    uint256 public totalSold;
    uint256 public hardCap;
    uint256 public rate;
    
    mapping(address => uint256) public contributions;
    
    uint256 public startTime;
    uint256 public endTime;
    bool public paused;
    
    event TokenPurchased(address buyer, uint256 amount, uint256 tokens);
    
    constructor(address _token, address _treasury, uint256 _hardCap, uint256 _rate, uint256 _duration) {
        owner = msg.sender;
        token = _token;
        treasury = _treasury;
        hardCap = _hardCap;
        rate = _rate;
        startTime = block.timestamp;
        endTime = block.timestamp + _duration;
    }
    
    function buyTokens() external payable {
        require(!paused, "Paused");
        require(block.timestamp >= startTime && block.timestamp <= endTime, "Sale inactive");
        require(msg.value > 0, "Zero value");
        
        uint256 tokenAmount = msg.value * rate;
        require(totalSold + tokenAmount <= hardCap, "Exceeds hard cap");
        
        contributions[msg.sender] += msg.value;
        totalSold += tokenAmount;
        
        emit TokenPurchased(msg.sender, msg.value, tokenAmount);
    }
    
    function finalizeSale() external {
        require(msg.sender == owner, "Not owner");
        payable(treasury).transfer(address(this).balance);
    }
    
    function pause() external { require(msg.sender == owner); paused = true; }
    receive() external payable { buyTokens(); }
}

contract TokenVesting {
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 startTime;
        uint256 released;
    }
    
    mapping(bytes32 => VestingSchedule) public schedules;
    mapping(address => bytes32[]) public beneficiary;
    
    address public owner;
    address public token;
    
    event VestingCreated(bytes32 id, address beneficiary, uint256 amount);
    event TokensReleased(bytes32 id, uint256 amount);
    
    constructor(address _token) { token = _token; owner = msg.sender; }
    
    function createVesting(address beneficiary, uint256 amount, uint256 duration) external returns (bytes32 id) {
        require(msg.sender == owner, "Not owner");
        id = keccak256(abi.encodePacked(beneficiary, block.timestamp));
        
        schedules[id] = VestingSchedule({
            totalAmount: amount,
            startTime: block.timestamp,
            released: 0
        });
        beneficiary[beneficiary].push(id);
        
        emit VestingCreated(id, beneficiary, amount);
    }
    
    function release(bytes32 id) external {
        VestingSchedule storage s = schedules[id];
        uint256 releasable = s.totalAmount - s.released;
        require(releasable > 0, "Nothing to release");
        
        s.released += releasable;
        emit TokensReleased(id, releasable);
    }
}

contract TigerStaking {
    IERC20 public stakingToken;
    
    uint256 public totalStaked;
    mapping(address => uint256) public staked;
    mapping(address => uint256) public rewards;
    
    uint256 public rewardRate = 1e18; // per second
    uint256 public lastUpdate;
    uint256 public rewardPerToken;
    
    mapping(address => uint256) public userRewardPaid;
    
    event Staked(address user, uint256 amount);
    event Unstaked(address user, uint256 amount);
    event RewardPaid(address user, uint256 reward);
    
    constructor(address _stakingToken) { stakingToken = IERC20(_stakingToken); lastUpdate = block.timestamp; }
    
    function stake(uint256 amount) external {
        require(amount > 0, "Zero stake");
        stakingToken.transferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        updateReward(msg.sender);
        emit Staked(msg.sender, amount);
    }
    
    function unstake(uint256 amount) external {
        require(amount > 0 && staked[msg.sender] >= amount, "Insufficient");
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        stakingToken.transfer(msg.sender, amount);
        updateReward(msg.sender);
        emit Unstaked(msg.sender, amount);
    }
    
    function getReward() external {
        updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    function updateReward(address user) internal {
        rewardPerToken = rewardPerToken + (block.timestamp - lastUpdate) * rewardRate / totalStaked;
        lastUpdate = block.timestamp;
        rewards[user] += staked[user] * (rewardPerToken - userRewardPaid[user]) / 1e18;
        userRewardPaid[user] = rewardPerToken;
    }
    
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerToken;
        return rewardPerToken + (block.timestamp - lastUpdate) * rewardRate / totalStaked;
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}