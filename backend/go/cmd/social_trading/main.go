// Package social_trading provides social trading services.
// Trading signals feed and community.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Trading Signal Post
type SignalPost struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Symbol  string  `json:"symbol"`
	Side    string  `json:"side"` // long, short
	Entry   float64 `json:"entry"`
	StopLoss float64 `json:"stopLoss"`
	Target  float64 `json:"target"`
	Reason  string  `json:"reason"`
	Likes   int     `json:"likes"`
	Shares  int     `json:"shares"`
	Comments int    `json:"comments"`
	CreatedAt int64 `json:"createdAt"`
	Status  string  `json:"status"` // active, closed, cancelled
	Result  string  `json:"result"` // win, loss, pending
}

// Comment
type Comment struct {
	ID      string  `json:"id"`
	PostID  string  `json:"postId"`
	UserID string  `json:"userId"`
	Text   string  `json:"text"`
	Likes  int     `json:"likes"`
	CreatedAt int64 `json:"createdAt"`
}

// User Stats
type UserStats struct {
	UserID     string `json:"userId"`
	Followers  int    `json:"followers"`
	Following int    `json:"following"`
	Rank      string `json:"rank"` // bronze, silver, gold, platinum
	SignalWin float64 `json:"signalWin"` // 30d win rate
	TotalPnL  float64 `json:"totalPnL"`
}

// Store
type STStore struct {
	mu     sync.RWMutex
	posts  map[string]*SignalPost
	comments map[string]*Comment
	users  map[string]*UserStats
}

var stStore = &STStore{
	posts: make(map[string]*SignalPost),
	comments: make(map[string]*Comment),
	users: make(map[string]*UserStats),
}

// Post signal
func PostSignal(userID, symbol, side string, entry, stopLoss, target float64, reason string) *SignalPost {
	post := &SignalPost{
		ID: fmt.Sprintf("sig_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Entry: entry,
		StopLoss: stopLoss,
		Target: target,
		Reason: reason,
		Likes: 0,
		Shares: 0,
		Comments: 0,
		CreatedAt: time.Now().UnixMilli(),
		Status: "active",
		Result: "pending",
	}

	stStore.mu.Lock()
	stStore.posts[post.ID] = post
	stStore.mu.Unlock()

	return post
}

// Like post
func LikePost(postID string) {
	stStore.mu.RLock()
	post, ok := stStore.posts[postID]
	stStore.mu.RUnlock()

	if ok {
		stStore.mu.Lock()
		post.Likes++
		stStore.mu.Unlock()
	}
}

// Share post
func SharePost(postID string) {
	stStore.mu.RLock()
	post, ok := stStore.posts[postID]
	stStore.mu.RUnlock()

	if ok {
		stStore.mu.Lock()
		post.Shares++
		stStore.mu.Unlock()
	}
}

// Add comment
func AddComment(postID, userID, text string) *Comment {
	comment := &Comment{
		ID: fmt.Sprintf("com_%d", time.Now().UnixNano()),
		PostID: postID,
		UserID: userID,
		Text: text,
		Likes: 0,
		CreatedAt: time.Now().UnixMilli(),
	}

	stStore.mu.Lock()
	stStore.comments[comment.ID] = comment
	if post, ok := stStore.posts[postID]; ok {
		post.Comments++
	}
	stStore.mu.Unlock()

	return comment
}

// Close signal (update result)
func CloseSignal(postID, result string) {
	stStore.mu.RLock()
	post, ok := stStore.posts[postID]
	stStore.mu.RUnlock()

	if ok {
		stStore.mu.Lock()
		post.Status = "closed"
		post.Result = result
		stStore.mu.Unlock()
	}
}

// Get feed (latest signals)
func GetFeed(limit int) []*SignalPost {
	stStore.mu.RLock()
	defer stStore.mu.RUnlock()

	var posts []*SignalPost
	for _, p := range stStore.posts {
		posts = append(posts, p)
	}

	// Sort by time (newest first)
	// Simplified - return first N
	if len(posts) > limit {
		return posts[:limit]
	}

	return posts
}

// Follow user
func FollowUser(followerID, targetID string) error {
	stStore.mu.RLock()
	follower, ok := stStore.users[followerID]
	target, tok := stStore.users[targetID]
	stStore.mu.RUnlock()

	if !tok {
		return fmt.Errorf("user not found")
	}

	if followerID != targetID {
		stStore.mu.Lock()
		target.Followers++
		stStore.mu.Unlock()
	}

	return nil
}

func main() {
	fmt.Println("Social Trading service initialized")

	// Post signal
	post := PostSignal("trader1", "BTCUSDT", "long", 65000, 64000, 70000, "Breakout")
	fmt.Printf("Signal: %s\n", post.ID)

	// Like
	LikePost(post.ID)

	// Feed
	feed := GetFeed(10)
	fmt.Printf("Feed size: %d\n", len(feed))
}