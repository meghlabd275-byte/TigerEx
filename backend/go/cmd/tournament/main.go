// Package tournament provides trading competition services.
// Migrated from TypeScript to Go for trading tournaments.
package main

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Tournament
type Tournament struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	StartTime  int64   `json:"startTime"`
	EndTime   int64   `json:"endTime"`
	PrizePool float64 `json:"prizePool"`
	Status    string  `json:"status"` // upcoming, active, completed
	Type      string  `json:"type"` // spot, futures, overall
}

// Participant
type Participant struct {
	UserID       string  `json:"userId"`
	TournamentID string  `json:"tournamentId"`
	PnL         float64 `json:"pnl"`
	Volume      float64 `json:"volume"`
	Trades      int    `json:"trades"`
	Rank        int    `json:"rank"`
}

// Prize distribution
type Prize struct {
	Rank   int     `json:"rank"`
	Amount float64 `json:"amount"`
}

// Store
type TournamentStore struct {
	mu           sync.RWMutex
	tournaments   map[string]*Tournament
	participants map[string]*Participant
}

var (
	tStore = &TournamentStore{
		tournaments: make(map[string]*Tournament),
		participants: make(map[string]*Participant),
	}
)

// Create tournament
func CreateTournament(name string, startDays, durationDays int, prizePool float64, tourType string) *Tournament {
	now := time.Now().UnixMilli()
	
	tournament := &Tournament{
		ID: fmt.Sprintf("tourney_%d", now),
		Name: name,
		StartTime: now + int64(startDays*86400000),
		EndTime: now + int64((startDays+durationDays)*86400000),
		PrizePool: prizePool,
		Status: "upcoming",
		Type: tourType,
	}

	tStore.mu.Lock()
	defer tStore.mu.Unlock()
	tStore.tournaments[tournament.ID] = tournament

	return tournament
}

// Join tournament
func Join(userID, tournamentID string) (*Participant, error) {
	tStore.mu.Lock()
	defer tStore.mu.Unlock()

	tournament, ok := tStore.tournaments[tournamentID]
	if !ok {
		return nil, fmt.Errorf("tournament not found")
	}

	if tournament.Status != "active" {
		return nil, fmt.Errorf("tournament not active")
	}

	participant := &Participant{
		UserID: userID,
		TournamentID: tournamentID,
		PnL: 0,
		Volume: 0,
		Trades: 0,
		Rank: 0,
	}

	tStore.participants[fmt.Sprintf("%s_%s", userID, tournamentID)] = participant

	return participant, nil
}

// Update score
func UpdateScore(userID, tournamentID string, pnl, volume float64, trades int) error {
	tStore.mu.Lock()
	defer tStore.mu.Unlock()

	key := fmt.Sprintf("%s_%s", userID, tournamentID)
	participant, ok := tStore.participants[key]
	if !ok {
		return fmt.Errorf("participant not found")
	}

	participant.PnL += pnl
	participant.Volume += volume
	participant.Trades += trades

	return nil
}

// Calculate rankings
func CalculateRankings(tournamentID string) []Participant {
	tStore.mu.RLock()
	defer tStore.mu.RUnlock()

	var participants []Participant
	for _, p := range tStore.participants {
		if p.TournamentID == tournamentID {
			participants = append(participants, *p)
		}
	}

	// Sort by PnL
	sort.Slice(participants, func(i, j int) bool {
		return participants[i].PnL > participants[j].PnL
	})

	// Assign ranks
	for i := range participants {
		participants[i].Rank = i + 1
	}

	return participants
}

// Distribute prizes
func DistributePrizes(tournamentID string) []Prize {
	ranks := CalculateRankings(tournamentID)

	prizes := []Prize{
		{Rank: 1, Amount: 0.30},
		{Rank: 2, Amount: 0.20},
		{Rank: 3, Amount: 0.15},
		{Rank: 4, Amount: 0.10},
		{Rank: 5, Amount: 0.08},
		{Rank: 6, Amount: 0.05},
		{Rank: 7, Amount: 0.04},
		{Rank: 8, Amount: 0.03},
		{Rank: 9, Amount: 0.03},
		{Rank: 10, Amount: 0.02},
	}

	var results []Prize
	for _, p := range ranks[:10] {
		for _, prize := range prizes {
			if p.Rank == prize.Rank {
				results = append(results, Prize{
					Rank: p.Rank,
					Amount: prize.Amount,
				})
			}
		}
	}

	return results
}

func main() {
	fmt.Println("Tournament service initialized")

	// Create tournament
	tourney := CreateTournament("Championship 2024", 1, 7, 100000, "spot")
	fmt.Printf("Created: %s - Prize Pool: $%.0f\n", tourney.Name, tourney.PrizePool)

	// Join
	P1, _ := Join("user_001", tourney.ID)
	P2, _ := Join("user_002", tourney.ID)
	fmt.Printf("Participants: %s, %s\n", P1.UserID, P2.UserID)

	// Update scores
	UpdateScore("user_001", tourney.ID, 500, 50000, 10)
	UpdateScore("user_002", tourney.ID, 300, 30000, 8)

	// Rankings
	ranks := CalculateRankings(tourney.ID)
	fmt.Println("\nRankings:")
	for _, p := range ranks {
		fmt.Printf("  #%d: %s - $%.2f PnL\n", p.Rank, p.UserID, p.PnL)
	}
}