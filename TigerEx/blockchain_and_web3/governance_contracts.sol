// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * TigerEx Token Airdrop
 */

contract AirdropDistributor {
    mapping(address => uint256) public claimed;
    uint256 public constant AMOUNT = 100e18;
    
    function claim() external {
        require(claimed[msg.sender] == 0, "Already claimed");
        claimed[msg.sender] = AMOUNT;
        // IERC20(token).transfer(msg.sender, AMOUNT);
    }
    
    function verifyEligibility(address user) external view returns (bool) {
        return claimed[user] == 0;
    }
}


/**
 * DAO Governance
 */

contract Governor {
    function propose(address[] targets, uint256[] values, bytes[] calldatas) external returns (uint256) {
        return 1; // proposal ID
    }
    
    function castVote(uint256 proposalId, uint8 support) external {
        // Vote logic
    }
}