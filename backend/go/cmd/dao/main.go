// Package dao provides governance services.
// Migrated from TypeScript to Go for DAO governance.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Proposal
type Proposal struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Type       string  `json:"type"` // parameter, upgrade, treasury, emission
	Status     string  `json:"status"` // drafting, voting, passed, rejected, executed
	ForVotes   float64 `json:"forVotes"`
	AgainstVotes float64 `json:"againstVotes"`
	AbstainVotes float64 `json:"abstainVotes"`
	Quorum     float64 `json:"quorum"` // required votes
	StartTime  int64   `json:"startTime"`
	EndTime   int64   `json:"endTime"`
	Executor  string  `json:"executor"`
}

// Vote
type Vote struct {
	ID          string `json:"id"`
	ProposalID  string `json:"proposalId"`
	VoterID    string `json:"voterID"`
	Choice    string `json:"choice"` // for, against, abstain
	Weight    float64 `json:"weight"`
	Timestamp int64  `json:"timestamp"`
}

// Delegate
type Delegate struct {
	ID         string  `json:"id"`
	Delegator  string  `json:"delegator"`
	Delegatee string  `json:"delegatee"`
	Weight   float64 `json:"weight"`
	ExpiresAt int64   `json:"expiresAt"`
}

// Treasury proposal
type TreasuryProposal struct {
	ID          string  `json:"id"`
	Recipient  string  `json:"recipient"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Status   string  `json:"status"` // pending, approved, rejected
}

// Store
type DAOStore struct {
	mu          sync.RWMutex
	proposals    map[string]*Proposal
	votes      map[string]*Vote
	delegates   map[string]*Delegate
	treasury   map[string]*TreasuryProposal
}

var (
	daoStore = &DAOStore{
		proposals: make(map[string]*Proposal),
		votes: make(map[string]*Vote),
		delegates: make(map[string]*Delegate),
		treasury: make(map[string]*TreasuryProposal),
	}
)

// Create proposal
func CreateProposal(title, desc, propType string, durationDays int, quorum float64) *Proposal {
	now := time.Now().UnixMilli()
	
	proposal := &Proposal{
		ID: fmt.Sprintf("prop_%d", now),
		Title: title,
		Description: desc,
		Type: propType,
		Status: "voting",
		ForVotes: 0,
		AgainstVotes: 0,
		AbstainVotes: 0,
		Quorum: quorum,
		StartTime: now,
		EndTime: now + int64(durationDays*86400000),
		Executor: "",
	}

	daoStore.mu.Lock()
	defer daoStore.mu.Unlock()
	daoStore.proposals[proposal.ID] = proposal

	return proposal
}

// Cast vote
func CastVote(proposalID, voterID, choice string, weight float64) error {
	daoStore.mu.Lock()
	defer daoStore.mu.Unlock()

	proposal, ok := daoStore.proposals[proposalID]
	if !ok {
		return fmt.Errorf("proposal not found")
	}

	if proposal.Status != "voting" {
		return fmt.Errorf("not in voting phase")
	}

	vote := &Vote{
		ID: fmt.Sprintf("vote_%d", time.Now().UnixNano()),
		ProposalID: proposalID,
		VoterID: voterID,
		Choice: choice,
		Weight: weight,
		Timestamp: time.Now().UnixMilli(),
	}

	daoStore.votes[vote.ID] = vote

	// Update proposal counts
	switch choice {
	case "for":
		proposal.ForVotes += weight
	case "against":
		proposal.AgainstVotes += weight
	case "abstain":
		proposal.AbstainVotes += weight
	}

	return nil
}

// Delegate votes
func Delegate(delegatee string, weight float64, expiryDays int) *Delegate {
	delegate := &Delegate{
		ID: fmt.Sprintf("del_%d", time.Now().UnixNano()),
		Delegator: "", // Would set from context
		Delegatee: delegatee,
		Weight: weight,
		ExpiresAt: time.Now().UnixMilli() + int64(expiryDays*86400000),
	}

	daoStore.mu.Lock()
	defer daoStore.mu.Unlock()
	daoStore.delegates[delegate.ID] = delegate

	return delegate
}

// Execute proposal
func ExecuteProposal(proposalID string) error {
	daoStore.mu.Lock()
	defer daoStore.mu.Unlock()

	proposal, ok := daoStore.proposals[proposalID]
	if !ok {
		return fmt.Errorf("proposal not found")
	}

	// Check if passed
	total := proposal.ForVotes + proposal.AgainstVotes + proposal.AbstainVotes
	if total < proposal.Quorum {
		return fmt.Errorf("quorum not reached")
	}

	if proposal.ForVotes <= proposal.AgainstVotes {
		proposal.Status = "rejected"
		return fmt.Errorf("proposal rejected")
	}

	proposal.Status = "executed"

	return nil
}

// Create treasury proposal
func CreateTreasuryProposal(recipient string, amount float64, currency string) *TreasuryProposal {
	treasury := &TreasuryProposal{
		ID: fmt.Sprintf("treasury_%d", time.Now().UnixNano()),
		Recipient: recipient,
		Amount: amount,
		Currency: currency,
		Status: "pending",
	}

	daoStore.mu.Lock()
	defer daoStore.mu.Unlock()
	daoStore.treasury[treasury.ID] = treasury

	return treasury
}

// Get proposal results
func GetResults(proposalID string) (map[string]interface{}, error) {
	daoStore.mu.RLock()
	defer daoStore.mu.RUnlock()

	proposal, ok := daoStore.proposals[proposalID]
	if !ok {
		return nil, fmt.Errorf("proposal not found")
	}

	return map[string]interface{}{
		"for": proposal.ForVotes,
		"against": proposal.AgainstVotes,
		"abstain": proposal.AbstainVotes,
		"status": proposal.Status,
	}, nil
}

func main() {
	fmt.Println("DAO Governance initialized")

	// Create proposal
	prop := CreateProposal("Reduce Trading Fees", "Reduce fees to 0.1%", "parameter", 7, 1000000)
	fmt.Printf("Created: %s\n", prop.Title)

	// Vote
	CastVote(prop.ID, "user_001", "for", 100)
	CastVote(prop.ID, "user_002", "against", 50)
	CastVote(prop.ID, "user_003", "abstain", 25)

	// Results
	results, _ := GetResults(prop.ID)
	fmt.Printf("Results: %+v\n", results)

	// Execute
	ExecuteProposal(prop.ID)
	fmt.Printf("Status: %s\n", prop.Status)
}