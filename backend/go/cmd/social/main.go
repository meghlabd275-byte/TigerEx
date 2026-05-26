// Package social provides social trading feed.
// Migrated from TypeScript to Go for social media features.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Social post
type SocialPost struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Content string  `json:"content"`
	Type    string  `json:"type"` // idea, update, alert
	Likes   int    `json:"likes"`
	Comments int   `json:"comments"`
	CreatedAt int64 `json:"createdAt"`
}

// Comment
type Comment struct {
	ID       string `json:"id"`
	PostID  string `json:"postId"`
	UserID  string `json:"userId"`
	Content string `json:"content"`
	CreatedAt int64 `json:"createdAt"`
}

// User follower
type Follow struct {
	FollowerID string `json:"followerId"`
	FollowingID string `json:"followingId"`
	CreatedAt int64 `json:"createdAt"`
}

// Notification
type Notification struct {
	ID        string `json:"id"`
	UserID   string `json:"userId"`
	Type     string `json:"type"` // like, comment, follow
	FromUser string `json:"fromUser"`
	Message string `json:"message"`
	Read   bool   `json:"read"`
	CreatedAt int64 `json:"createdAt"`
}

// Store
type SocialStore struct {
	mu          sync.RWMutex
	posts      map[string]*SocialPost
	comments   map[string][]*Comment
	follows    map[string][]*Follow
	notifications map[string][]*Notification
}

var (
	socialStore = &SocialStore{
		posts: make(map[string]*SocialPost),
		comments: make(map[string][]*Comment),
		follows: make(map[string][]*Follow),
		notifications: make(map[string][]*Notification),
	}
)

// Create post
func CreatePost(userID, content, postType string) *SocialPost {
	post := &SocialPost{
		ID:        fmt.Sprintf("post_%d", time.Now().UnixNano()),
		UserID:   userID,
		Content:  content,
		Type:    postType,
		Likes:   0,
		Comments: 0,
		CreatedAt: time.Now().UnixMilli(),
	}

	socialStore.mu.Lock()
	defer socialStore.mu.Unlock()
	socialStore.posts[post.ID] = post

	return post
}

// Like post
func LikePost(postID, userID string) error {
	socialStore.mu.Lock()
	defer socialStore.mu.Unlock()

	post, ok := socialStore.posts[postID]
	if !ok {
		return fmt.Errorf("post not found")
	}

	post.Likes++

	// Notify
	createNotification(post.UserID, userID, "like", "liked your post")

	return nil
}

// Comment on post
func CommentOnPost(postID, userID, content string) (*Comment, error) {
	socialStore.mu.Lock()
	defer socialStore.mu.Unlock()

	post, ok := socialStore.posts[postID]
	if !ok {
		return nil, fmt.Errorf("post not found")
	}

	comment := &Comment{
		ID:        fmt.Sprintf("cmt_%d", time.Now().UnixNano()),
		PostID:   postID,
		UserID:   userID,
		Content:  content,
		CreatedAt: time.Now().UnixMilli(),
	}

	socialStore.comments[postID] = append(socialStore.comments[postID], comment)
	post.Comments++

	// Notify
	if post.UserID != userID {
		createNotification(post.UserID, userID, "comment", "commented on your post")
	}

	return comment, nil
}

// Follow user
func FollowUser(followerID, followingID string) error {
	if followerID == followingID {
		return fmt.Errorf("cannot follow self")
	}

	socialStore.mu.Lock()
	defer socialStore.mu.Unlock()

	// Check already following
	for _, f := range socialStore.follows[followerID] {
		if f.FollowingID == followingID {
			return fmt.Errorf("already following")
		}
	}

	follow := &Follow{
		FollowerID:  followerID,
		FollowingID: followingID,
		CreatedAt:  time.Now().UnixMilli(),
	}

	socialStore.follows[followerID] = append(socialStore.follows[followerID], follow)

	// Notify
	createNotification(followingID, followerID, "follow", "started following you")

	return nil
}

// Unfollow user
func UnfollowUser(followerID, followingID string) error {
	socialStore.mu.Lock()
	defer socialStore.mu.Unlock()

	follows := socialStore.follows[followerID]
	for i, f := range follows {
		if f.FollowingID == followingID {
			socialStore.follows[followerID] = append(follows[:i], follows[i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("not following")
}

// Create notification
func createNotification(userID, fromUser, notifType, message string) {
	notif := &Notification{
		ID:       fmt.Sprintf("notif_%d", time.Now().UnixNano()),
		UserID:   userID,
		Type:     notifType,
		FromUser: fromUser,
		Message:  message,
		Read:    false,
		CreatedAt: time.Now().UnixMilli(),
	}

	socialStore.notifications[userID] = append(socialStore.notifications[userID], notif)
}

// Get notifications
func GetNotifications(userID string) []*Notification {
	socialStore.mu.RLock()
	defer socialStore.mu.RUnlock()

	return socialStore.notifications[userID]
}

// Get feed
func GetFeed(userID string, limit int) []*SocialPost {
	socialStore.mu.RLock()
	defer socialStore.mu.RUnlock()

	// Get posts from followed users
	var postIDs []string
	for _, f := range socialStore.follows[userID] {
		for _, p := range socialStore.posts {
			if p.UserID == f.FollowingID {
				postIDs = append(postIDs, p.ID)
			}
		}
	}

	posts := make([]*SocialPost, 0, len(postIDs))
	for _, id := range postIDs {
		if p, ok := socialStore.posts[id]; ok {
			posts = append(posts, p)
		}
	}

	// Sort by time (newest first)
	for i := 0; i < len(posts)-1; i++ {
		for j := i + 1; j < len(posts); j++ {
			if posts[j].CreatedAt > posts[i].CreatedAt {
				posts[i], posts[j] = posts[j], posts[i]
			}
		}
	}

	if len(posts) > limit {
		posts = posts[:limit]
	}

	return posts
}

func main() {
	fmt.Println("Social Trading service initialized")

	// Create post
	post := CreatePost("user_001", "Just entered a long position on BTC!", "idea")
	fmt.Printf("Created post: %s\n", post.Content)

	// Follow
	FollowUser("user_002", "user_001")
	fmt.Printf("user_002 now follows user_001\n")

	// Like
	LikePost(post.ID, "user_002")
	fmt.Printf("Post likes: %d\n", post.Likes)

	// Comment
	cmt, _ := CommentOnPost(post.ID, "user_003", "Great call!")
	fmt.Printf("Comment: %s\n", cmt.Content)
}