package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX REFERRAL SERVICE - GO
// Referral program management
// ============================================================================

type ReferralCode struct {
	ID         string  `json:"id"`
	UserID    string  `json:"user_id"`
	Code      string  `json:"code"`
	Reward    float64 `json:"reward"` // reward percentage
	CappedAt  float64 `json:"capped_at"`
	Status    string  `json:"status"`
}

type ReferralStat struct {
	ReferrerID   string  `json:"referrer_id"`
	TotalJoined int     `json:"total_joined"`
	TotalVolume float64 `json:"total_volume"`
	TotalReward float64 `json:"total_reward"`
}

type ReferralService struct {
	codes  map[string]*ReferralCode
	stats  map[string]*ReferralStat
}

func NewReferralService() *ReferralService {
	return &ReferralService{
		codes: make(map[string]*ReferralCode),
		stats: make(map[string]*ReferralStat),
	}
}

func (s *ReferralService) CreateCode(userID, code string, reward, cap float64) *ReferralCode {
	ref := &ReferralCode{
		ID: fmt.Sprintf("ref_%d", log.Now().UnixNano()),
		UserID: userID, Code: code,
		Reward: reward, CappedAt: cap, Status: "active",
	}
	s.codes[ref.ID] = ref
	return ref
}

func (s *ReferralService) GetCode(code string) *ReferralCode {
	for _, c := range s.codes {
		if c.Code == code && c.Status == "active" {
			return c
		}
	}
	return nil
}

func (s *ReferralService) JoinReferral(code, newUserID string) bool {
	ref := s.GetCode(code)
	if ref == nil {
		return false
	}

	// Initialize stats if not exists
	if _, ok := s.stats[ref.UserID]; !ok {
		s.stats[ref.UserID] = &ReferralStat{ReferrerID: ref.UserID}
	}

	s.stats[ref.UserID].TotalJoined++
	return true
}

func (s *ReferralService) GetStats(userID string) *ReferralStat {
	if stat, ok := s.stats[userID]; ok {
		return stat
	}
	return &ReferralStat{ReferrerID: userID}
}

func SetupReferralRoutes(r *gin.Engine, svc *ReferralService) {
	api := r.Group("/api/v1/referral")

	api.POST("/codes", func(c *gin.Context) {
		var req struct {
			UserID string `json:"user_id"`
			Code  string `json:"code"`
			Reward float64 `json:"reward"`
			Capped float64 `json:"capped"`
		}
		c.ShouldBindJSON(&req)

		code := svc.CreateCode(req.UserID, req.Code, req.Reward, req.Capped)
		c.JSON(201, code)
	})

	api.GET("/codes/:code", func(c *gin.Context) {
		code := c.Param("code")
		ref := svc.GetCode(code)
		if ref == nil {
			c.JSON(404, gin.H{"error": "code not found"})
			return
		}
		c.JSON(200, ref)
	})

	api.POST("/join", func(c *gin.Context) {
		var req struct {
			Code    string `json:"code"`
			UserID string `json:"user_id"`
		}
		c.ShouldBindJSON(&req)

		if svc.JoinReferral(req.Code, req.UserID) {
			c.JSON(200, gin.H{"success": true})
		} else {
			c.JSON(400, gin.H{"error": "invalid code"})
		}
	})

	api.GET("/stats/:user_id", func(c *gin.Context) {
		userID := c.Param("user_id")
		stats := svc.GetStats(userID)
		c.JSON(200, stats)
	})
}

func main() {
	r := gin.Default()
	svc := NewReferralService()
	SetupReferralRoutes(r, svc)
	log.Fatal(r.Run(":8080"))
}