// Leaderboard - Real-Time Path in Go
// Trading competitions and rankings

package leaderboard

import (
	"sort"
	"sync"
	"time"
)

// Rank entry
type Entry struct {
	UserID    string  `json:"user_id"`
	Username  string  `json:"username"`
	Volume   float64 `json:"volume"`
	Trades   int    `json:"trades"`
	PnL     float64 `json:"pnl"`
	Rank     int    `json:"rank"`
}

// Time period
type Period string

const (
	PeriodDaily   Period = "daily"
	PeriodWeekly Period = "weekly"
	PeriodMonthly Period = "monthly"
	PeriodAll   Period = "all"
)

// Leaderboard service
type Service struct {
	entries   map[string]map[string]*Entry // period -> user_id -> entry
	rankings  map[string][]string // period -> sorted user IDs
	mu       sync.RWMutex
}

func New() *Service {
	return &Service{
		entries:  make(map[string]map[string]*Entry),
		rankings: make(map[string][]string),
	}
}

// Update user stats
func (s *Service) Update(period, userID, username string, volume float64, trades int, pnl float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if s.entries[period] == nil {
		s.entries[period] = make(map[string]*Entry)
	}
	
	entry, exists := s.entries[period][userID]
	if !exists {
		entry = &Entry{
			UserID:   userID,
			Username: username,
		}
		s.entries[period][userID] = entry
	}
	
	entry.Volume += volume
	entry.Trades += trades
	entry.PnL += pnl
	
	s.sort(period)
}

func (s *Service) sort(period string) {
	users := make([]*Entry, 0)
	for _, e := range s.entries[period] {
		users = append(users, e)
	}
	
	sort.Slice(users, func(i, j int) bool {
		if users[i].Volume != users[j].Volume {
			return users[i].Volume > users[j].Volume
		}
		return users[i].PnL > users[j].PnL
	})
	
	for i, u := range users {
		u.Rank = i + 1
		s.rankings[period] = append(s.rankings[period], u.UserID)
	}
}

// Get rankings
func (s *Service) Get(period string, limit int) []Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	entries := s.entries[period]
	if entries == nil {
		return nil
	}
	
	list := make([]Entry, 0, limit)
	i := 0
	for _, e := range entries {
		if i >= limit {
			break
		}
		list = append(list, *e)
		i++
	}
	
	return list
}

// Get user rank
func (s *Service) GetUserRank(period, userID string) (int, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	entries := s.entries[period]
	if e, ok := entries[userID]; ok {
		return e.Rank, true
	}
	
	return 0, false
}

// Reset period
func (s *Service) Reset(period string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if period == string(PeriodAll) {
		s.entries = make(map[string]map[string]*Entry)
		s.rankings = make(map[string][]string)
	} else {
		delete(s.entries, period)
		delete(s.rankings, period)
	}
}

// Stats
func (s *Service) Stats(period string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	entries := s.entries[period]
	count := len(entries)
	var totalVol float64
	
	for _, e := range entries {
		totalVol += e.Volume
	}
	
	return map[string]interface{}{
		"period":      period,
		"users":      count,
		"total_vol":  totalVol,
		"updated":   time.Now().Unix(),
	}
}