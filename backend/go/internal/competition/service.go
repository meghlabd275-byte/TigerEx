// Competition Engine - Real-Time Path in Go
// Trading competitions and leaderboards

package competition

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Competition status
type Status int

const (
	StatusUpcoming Status = iota
	StatusActive
	StatusCompleted
)

// Competition type
type CompType int

const (
	TypeVolume CompType = iota
	TypeProfit
	TypeTrades
)

// Competition
type Competition struct {
	ID          string
	Name       string
	Type       CompType
	Status     Status
	StartTime  time.Time
	EndTime    time.Time
	Prizes     []Prize
	MinVolume  float64
	CreatedAt  time.Time
}

// Prize
type Prize struct {
	Rank  int
	Reward float64
	Asset string
}

// Participant
type Participant struct {
	UserID    string
	Username  string
	Volume   float64
	Profit   float64
	Trades   int
	Rank     int
	Score    float64
	LastUpdate time.Time
}

// Leaderboard
type Leaderboard struct {
	CompetitionID string
	Participants  []Participant
	UpdatedAt    time.Time
}

// Service
type Service struct {
	competitions map[string]*Competition
	participants map[string]map[string]*Participant // compID -> userID -> participant
	leaderboards map[string]*Leaderboard
	
	mu sync.RWMutex
}

func NewService() *Service {
	return &Service{
		competitions: make(map[string]*Competition),
		participants: make(map[string]map[string]*Participant),
		leaderboards: make(map[string]*Leaderboard),
	}
}

// CreateCompetition creates new competition
func (s *Service) CreateCompetition(name string, compType CompType, start, end time.Time, prizes []Prize) *Competition {
	comp := &Competition{
		ID:          generateID("comp"),
		Name:        name,
		Type:        compType,
		Status:      StatusUpcoming,
		StartTime:  start,
		EndTime:    end,
		Prizes:      prizes,
		CreatedAt:  time.Now(),
	}
	
	s.competitions[comp.ID] = comp
	s.participants[comp.ID] = make(map[string]*Participant)
	
	return comp
}

// StartCompetition starts a competition
func (s *Service) StartCompetition(compID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	comp, ok := s.competitions[compID]
	if !ok {
		return fmt.Errorf("competition not found")
	}
	
	comp.Status = StatusActive
	return nil
}

// EndCompetition ends a competition
func (s *Service) EndCompetition(compID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	comp, ok := s.competitions[compID]
	if !ok {
		return fmt.Errorf("competition not found")
	}
	
	comp.Status = StatusCompleted
	
	// Calculate final rankings
	s.calculateRankings(compID)
	
	return nil
}

// UpdateProgress updates participant progress
func (s *Service) UpdateProgress(compID, userID, username string, volume, profit float64, trades int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	participants, ok := s.participants[compID]
	if !ok {
		return
	}
	
	p, exists := participants[userID]
	if !exists {
		p = &Participant{
			UserID:    userID,
			Username:  username,
			LastUpdate: time.Now(),
		}
		participants[userID] = p
	}
	
	p.Volume += volume
	p.Profit += profit
	p.Trades += trades
	p.LastUpdate = time.Now()
	
	// Update score based on type
	comp := s.competitions[compID]
	if comp != nil {
		switch comp.Type {
		case TypeVolume:
			p.Score = p.Volume
		case TypeProfit:
			p.Score = p.Profit
		case TypeTrades:
			p.Score = float64(p.Trades)
		}
	}
}

// GetLeaderboard gets current leaderboard
func (s *Service) GetLeaderboard(compID string) *Leaderboard {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	participants := s.participants[compID]
	if participants == nil {
		return nil
	}
	
	// Convert to slice
	list := make([]Participant, 0, len(participants))
	for _, p := range participants {
		list = append(list, *p)
	}
	
	// Sort by score
	sort.Slice(list, func(i, j int) bool {
		return list[i].Score > list[j].Score
	})
	
	// Update ranks
	for i := range list {
		list[i].Rank = i + 1
	}
	
	return &Leaderboard{
		CompetitionID: compID,
		Participants:  list,
		UpdatedAt:    time.Now(),
	}
}

func (s *Service) calculateRankings(compID string) {
	leaderboard := s.GetLeaderboard(compID)
	s.leaderboards[compID] = leaderboard
}

// GetPrizes calculates prizes for completed competition
func (s *Service) GetPrizes(compID string) []PaidPrize {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	comp := s.competitions[compID]
	if comp == nil || comp.Status != StatusCompleted {
		return nil
	}
	
	leaderboard := s.leaderboards[compID]
	if leaderboard == nil {
		return nil
	}
	
	var prizes []PaidPrize
	
	for _, prize := range comp.Prizes {
		if prize.Rank <= len(leaderboard.Participants) {
			p := leaderboard.Participants[prize.Rank-1]
			prizes = append(prizes, PaidPrize{
				UserID: p.UserID,
				Username: p.Username,
				Rank: prize.Rank,
				Reward: prize.Reward,
				Asset: prize.Asset,
			})
		}
	}
	
	return prizes
}

type PaidPrize struct {
	UserID   string
	Username string
	Rank    int
	Reward  float64
	Asset   string
}

// GetActiveCompetitions gets active competitions
func (s *Service) GetActiveCompetitions() []*Competition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Competition
	now := time.Now()
	
	for _, comp := range s.competitions {
		if comp.Status == StatusActive || (now.After(comp.StartTime) && now.Before(comp.EndTime)) {
			result = append(result, comp)
		}
	}
	
	return result
}

func generateID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}