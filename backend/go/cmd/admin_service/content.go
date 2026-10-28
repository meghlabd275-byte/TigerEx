package main

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Banner is an operator-managed promotional placement rendered on the public
// site. Nothing is shown to a visitor until an operator creates it here.
type Banner struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	ImageURL  string    `json:"image_url"`
	LinkURL   string    `json:"link_url"`
	Placement string    `json:"placement"` // "home", "trade", "earn"
	Status    string    `json:"status"`    // "active", "paused"
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Announcement is an operator-authored notice shown to traders.
type Announcement struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Category  string    `json:"category"` // "listing", "maintenance", "security", "general"
	Pinned    bool      `json:"pinned"`
	Status    string    `json:"status"` // "published", "draft"
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *AdminService) listBanners(placement string) []*Banner {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*Banner, 0, len(s.banners))
	for _, banner := range s.banners {
		if placement != "" && banner.Placement != placement {
			continue
		}
		copyBanner := *banner
		result = append(result, &copyBanner)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result
}

func (s *AdminService) listAnnouncements(status string) []*Announcement {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*Announcement, 0, len(s.announcements))
	for _, item := range s.announcements {
		if status != "" && item.Status != status {
			continue
		}
		copyItem := *item
		result = append(result, &copyItem)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Pinned != result[j].Pinned {
			return result[i].Pinned
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

func (s *AdminService) GetBannersHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": s.listBanners(c.Query("placement"))})
}

func (s *AdminService) CreateBannerHandler(c *gin.Context) {
	var req struct {
		Title     string `json:"title" binding:"required"`
		ImageURL  string `json:"image_url" binding:"required"`
		LinkURL   string `json:"link_url"`
		Placement string `json:"placement" binding:"required"`
		StartsAt  string `json:"starts_at"`
		EndsAt    string `json:"ends_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	placement := strings.ToLower(strings.TrimSpace(req.Placement))
	switch placement {
	case "home", "trade", "earn":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "placement must be home, trade or earn"}})
		return
	}

	now := time.Now().UTC()
	banner := &Banner{
		ID:        uuid.NewString(),
		Title:     strings.TrimSpace(req.Title),
		ImageURL:  strings.TrimSpace(req.ImageURL),
		LinkURL:   strings.TrimSpace(req.LinkURL),
		Placement: placement,
		Status:    "active",
		StartsAt:  parseOptionalTime(req.StartsAt, now),
		EndsAt:    parseOptionalTime(req.EndsAt, time.Time{}),
		CreatedBy: c.GetString("adminID"),
		CreatedAt: now,
		UpdatedAt: now,
	}

	s.mu.Lock()
	s.banners[banner.ID] = banner
	s.mu.Unlock()
	s.logAction(c.GetString("adminID"), "create", "banner", banner.ID, "Created banner: "+banner.Title, c.ClientIP())

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": banner})
}

func (s *AdminService) UpdateBannerHandler(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Status *string `json:"status"`
		Title  *string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	s.mu.Lock()
	banner, ok := s.banners[id]
	if !ok {
		s.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "banner not found"}})
		return
	}
	if req.Status != nil {
		status := strings.ToLower(strings.TrimSpace(*req.Status))
		if status != "active" && status != "paused" {
			s.mu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "status must be active or paused"}})
			return
		}
		banner.Status = status
	}
	if req.Title != nil {
		banner.Title = strings.TrimSpace(*req.Title)
	}
	banner.UpdatedAt = time.Now().UTC()
	updated := *banner
	s.mu.Unlock()

	s.logAction(c.GetString("adminID"), "update", "banner", id, "Updated banner status", c.ClientIP())
	c.JSON(http.StatusOK, gin.H{"success": true, "data": updated})
}

func (s *AdminService) DeleteBannerHandler(c *gin.Context) {
	id := c.Param("id")

	s.mu.Lock()
	if _, ok := s.banners[id]; !ok {
		s.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "banner not found"}})
		return
	}
	delete(s.banners, id)
	s.mu.Unlock()

	s.logAction(c.GetString("adminID"), "delete", "banner", id, "Deleted banner", c.ClientIP())
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *AdminService) GetAnnouncementsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": s.listAnnouncements(c.Query("status"))})
}

func (s *AdminService) CreateAnnouncementHandler(c *gin.Context) {
	var req struct {
		Title    string `json:"title" binding:"required"`
		Body     string `json:"body" binding:"required"`
		Category string `json:"category" binding:"required"`
		Pinned   bool   `json:"pinned"`
		Status   string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status == "" {
		status = "draft"
	}
	if status != "draft" && status != "published" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "status must be draft or published"}})
		return
	}

	now := time.Now().UTC()
	item := &Announcement{
		ID:        uuid.NewString(),
		Title:     strings.TrimSpace(req.Title),
		Body:      strings.TrimSpace(req.Body),
		Category:  strings.ToLower(strings.TrimSpace(req.Category)),
		Pinned:    req.Pinned,
		Status:    status,
		CreatedBy: c.GetString("adminID"),
		CreatedAt: now,
		UpdatedAt: now,
	}

	s.mu.Lock()
	s.announcements[item.ID] = item
	s.mu.Unlock()
	s.logAction(c.GetString("adminID"), "create", "announcement", item.ID, "Created announcement: "+item.Title, c.ClientIP())

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": item})
}

func (s *AdminService) DeleteAnnouncementHandler(c *gin.Context) {
	id := c.Param("id")

	s.mu.Lock()
	if _, ok := s.announcements[id]; !ok {
		s.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "announcement not found"}})
		return
	}
	delete(s.announcements, id)
	s.mu.Unlock()

	s.logAction(c.GetString("adminID"), "delete", "announcement", id, "Deleted announcement", c.ClientIP())
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetPublicContentHandler serves the banners and published announcements that
// visitors may see. It never exposes draft content.
func (s *AdminService) GetPublicContentHandler(c *gin.Context) {
	placement := c.Query("placement")
	now := time.Now().UTC()

	visible := make([]*Banner, 0)
	for _, banner := range s.listBanners(placement) {
		if banner.Status != "active" {
			continue
		}
		if !banner.StartsAt.IsZero() && banner.StartsAt.After(now) {
			continue
		}
		if !banner.EndsAt.IsZero() && banner.EndsAt.Before(now) {
			continue
		}
		visible = append(visible, banner)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"banners":       visible,
			"announcements": s.listAnnouncements("published"),
		},
	})
}

func parseOptionalTime(value string, fallback time.Time) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC()
	}
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return parsed.UTC()
	}
	return fallback
}
