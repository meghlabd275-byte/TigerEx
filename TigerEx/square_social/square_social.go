package main

import (
	"fmt"
	"time"
)

// Post
type SquarePost struct {
	ID       string   `json:"id"`
	UserID  string   `json:"userId"`
	Username string  `json:"username"`
	Content string   `json:"content"`
	Media   []string `json:"media,omitempty"`
	Likes   int      `json:"likes"`
	Comments int      `json:"comments"`
	CreatedAt int64   `json:"createdAt"`
}

// Comment
type Comment struct {
	ID       string `json:"id"`
	PostID  string `json:"postId"`
	UserID string `json:"userId"`
	Content string `json:"content"`
	CreatedAt int64 `json:"createdAt"`
}

// Square social platform
type SquarePlatform struct {
	Posts    map[string]*SquarePost
	Comments map[string][]*Comment
	Likes   map[string]bool // postId_userId -> liked
}

// New creates platform
func NewSquarePlatform() *SquarePlatform {
	return &SquarePlatform{
		Posts: make(map[string]*SquarePost),
		Comments: make(map[string][]*Comment),
		Likes: make(map[string]bool),
	}
}

// Create post
func (p *SquarePlatform) Post(userID, username, content string, media []string) *SquarePost {
	id := fmt.Sprintf("POST_%d", time.Now().UnixNano())
	
	post := &SquarePost{
		ID: id,
		UserID: userID,
		Username: username,
		Content: content,
		Media: media,
		Likes: 0,
		Comments: 0,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	p.Posts[id] = post
	return post
}

// Add comment
func (p *SquarePlatform) Comment(postID, userID, content string) *Comment {
	id := fmt.Sprintf("COMMENT_%d", time.Now().UnixNano())
	
	comment := &Comment{
		ID: id,
		PostID: postID,
		UserID: userID,
		Content: content,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	p.Comments[postID] = append(p.Comments[postID], comment)
	
	if post := p.Posts[postID]; post != nil {
		post.Comments++
	}
	
	return comment
}

// Like post
func (p *SquarePlatform) Like(postID, userID string) bool {
	key := postID + "_" + userID
	
	if p.Likes[key] {
		return false // Already liked
	}
	
	p.Likes[key] = true
	
	if post := p.Posts[postID]; post != nil {
		post.Likes++
	}
	
	return true
}

// Unlike
func (p *SquarePlatform) Unlike(postID, userID string) bool {
	key := postID + "_" + userID
	
	if !p.Likes[key] {
		return false
	}
	
	delete(p.Likes, key)
	
	if post := p.Posts[postID]; post != nil && post.Likes > 0 {
		post.Likes--
	}
	
	return true
}

// Get feed
func (p *SquarePlatform) GetFeed(limit int) []*SquarePost {
	var posts []*SquarePost
	for _, post := range p.Posts {
		posts = append(posts, post)
	}
	
	// Sort by newest
	for i := 0; i < len(posts)-1; i++ {
		for j := i + 1; j < len(posts); j++ {
			if posts[j].CreatedAt > posts[i].CreatedAt {
				posts[i], posts[j] = posts[j], posts[i]
			}
		}
	}
	
	if limit > 0 && len(posts) > limit {
		posts = posts[:limit]
	}
	
	return posts
}

func main() {
	platform := NewSquarePlatform()
	
	// Create post
	post := platform.Post("user1", "trader123", "Just made 100% profit on BTC!", nil)
	fmt.Printf("Post: %s\n", post.Content)
	
	// Like
	platform.Like(post.ID, "user2")
	fmt.Printf("Likes: %d\n", post.Likes)
	
	// Comment
	comment := platform.Comment(post.ID, "user2", "Great job!")
	fmt.Printf("Comments: %d\n", post.Comments)
	
	// Feed
	feed := platform.GetFeed(10)
	fmt.Printf("Feed: %d posts\n", len(feed))
}