// Package tracking_pixel provides email tracking services.
// Migrated from TypeScript to Go for email open tracking.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Tracking pixel
type TrackingPixel struct {
	ID        string  `json:"id"`
	EmailID  string  `json:"emailId"`
	UserID  string  `json:"userId"`
	OpenedAt int64   `json:"openedAt"`
	IP      string  `json:"ip"`
	UserAgent string `json:"userAgent"`
	UserID2 string `json:"userId"` // Track via separate field
}

// Campaign stats
type CampaignStats struct {
	CampaignID string `json:"campaignId"`
	Sent    int    `json:"sent"`
	Opened  int    `json:"opened"`
	Clicked int    `json:"clicked"`
}

// Store
type TrackingStore struct {
	mu     sync.RWMutex
	pixels map[string]*TrackingPixel
	campaigns map[string]*CampaignStats
}

var (
	trackStore = &TrackingStore{
		pixels: make(map[string]*TrackingPixel),
		campaigns: make(map[string]*CampaignStats),
	}
)

// Track open
func TrackOpen(emailID, userID, ip, userAgent string) *TrackingPixel {
	pixel := &TrackingPixel{
		ID: fmt.Sprintf("px_%d", time.Now().UnixNano()),
		EmailID: emailID,
		UserID: userID,
		OpenedAt: time.Now().UnixMilli(),
		IP: ip,
		UserAgent: userAgent,
	}

	trackStore.mu.Lock()
	defer trackStore.mu.Unlock()
	trackStore.pixels[pixel.ID] = pixel

	// Update campaign stats
	for _, c := range trackStore.campaigns {
		c.Opened++
	}

	return pixel
}

// Get open count
func GetOpenCount(emailID string) int {
	trackStore.mu.RLock()
	defer trackStore.mu.RUnlock()

	count := 0
	for _, p := range trackStore.pixels {
		if p.EmailID == emailID {
			count++
		}
	}

	return count
}

// Get campaign stats
func GetCampaignStats(campaignID string) (*CampaignStats, bool) {
	trackStore.mu.RLock()
	defer trackStore.mu.RUnlock()

	stats, ok := trackStore.campaigns[campaignID]
	return stats, ok
}

func main() {
	fmt.Println("Tracking Pixel service initialized")

	// Track open
	pixel := TrackOpen("email_001", "user_001", "192.168.1.1", "Chrome")
	fmt.Printf("Tracked open: %s at %d\n", pixel.ID, pixel.OpenedAt)

	// Count
	count := GetOpenCount("email_001")
	fmt.Printf("Open count: %d\n", count)
}