package main

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX PARTNER PROGRAM API - GO
// Third-party partners, API programs, and referrer management
// ============================================================================

// ============== MODELS ==============

type Partner struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"` // api, referrer, affiliate, institutional
	Commission  float64 `json:"commission"`
	Prefix     string  `json:"prefix"`
	Status     string  `json:"status"` // active, suspended
	Metadata   map[string]interface{} `json:"metadata"`
	CreatedAt   int64   `json:"created_at"`
}

type Referral struct {
	ID          string  `json:"id"`
	ReferrerID  string  `json:"referrer_id"`
	ReferredID  string  `json:"referred_id"`
	RewardTier  int     `json:"reward_tier"`
	Claimed    bool    `json:"claimed"`
	CreatedAt   int64   `json:"created_at"`
}

type PartnerStats struct {
	PartnerID     string  `json:"partner_id"`
	TotalUsers    int     `json:"total_users"`
	ActiveUsers  int     `json:"active_users"`
	TotalVolume  float64 `json:"total_volume"`
	TotalFees   float64 `json:"total_fees"`
	Commission   float64 `json:"commission"`
}

// ============== SERVICE ==============

type PartnerService struct {
	partners  map[string]*Partner
	referrals map[string]*Referral
	stats    map[string]*PartnerStats
}

func NewPartnerService() *PartnerService {
	s := &PartnerService{
		partners: make(map[string]*Partner),
		referrals: make(map[string]*Referral),
		stats: make(map[string]*PartnerStats),
	}

	return s
}

// Partner Management
func (s *PartnerService) CreatePartner(name, partnerType, prefix string, commission float64) *Partner {
	partner := &Partner{
		ID:         fmt.Sprintf("partner_%d", time.Now().UnixNano()),
		Name:       name,
		Type:       partnerType,
		Commission: commission,
		Prefix:     prefix,
		Status:     "active",
		CreatedAt:   time.Now().Unix(),
	}

	s.partners[partner.ID] = partner
	s.stats[partner.ID] = &PartnerStats{
		PartnerID: partner.ID,
	}

	return partner
}

func (s *PartnerService) GetPartner(partnerID string) (*Partner, error) {
	if p, ok := s.partners[partnerID]; ok {
		return p, nil
	}
	return nil, fmt.Errorf("partner not found")
}

func (s *PartnerService) GetPartnerByPrefix(prefix string) (*Partner, error) {
	for _, p := range s.partners {
		if p.Prefix == prefix {
			return p, nil
		}
	}
	return nil, fmt.Errorf("partner not found")
}

func (s *PartnerService) ListPartners() []*Partner {
	var list []*Partner
	for _, p := range s.partners {
		list = append(list, p)
	}
	return list
}

// Referral Management
func (s *PartnerService) CreateReferral(partnerID, referredUserID, rewardTier string) *Referral {
	referral := &Referral{
		ID:         fmt.Sprintf("ref_%d", time.Now().UnixNano()),
		ReferrerID: partnerID,
		ReferredID: referredUserID,
		RewardTier: 0,
		Claimed:    false,
		CreatedAt:  time.Now().Unix(),
	}

	if tier, err := strconv.Atoi(rewardTier); err == nil {
		referral.RewardTier = tier
	}

	s.referrals[referral.ID] = referral
	return referral
}

func (s *PartnerService) ClaimReferralReward(referralID string) error {
	if r, ok := s.referrals[referralID]; ok {
		if r.Claimed {
			return fmt.Errorf("already claimed")
		}
		r.Claimed = true
		return nil
	}
	return fmt.Errorf("referral not found")
}

func (s *PartnerService) GetReferrerStats(partnerID string) *PartnerStats {
	if stats, ok := s.stats[partnerID]; ok {
		return stats
	}
	return &PartnerStats{PartnerID: partnerID}
}

// Partner API Keys
func (s *PartnerService) GenerateAPIKey(partnerID string) (string, error) {
	partner, err := s.GetPartner(partnerID)
	if err != nil {
		return "", err
	}

	if partner.Status != "active" {
		return "", fmt.Errorf("partner not active")
	}

	key := fmt.Sprintf("tgx_%s_%d", partner.Prefix, time.Now().UnixNano())
	return key, nil
}

// Partner Commission Calculation
func (s *PartnerService) CalculateCommission(partnerID string, volume, fees float64) float64 {
	partner, err := s.GetPartner(partnerID)
	if err != nil {
		return 0
	}

	return fees * partner.Commission
}

// ============== MIDDLEWARE ==============

func PartnerAuthMiddleware(svc *PartnerService) gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-Partner-API-Key")
		if apiKey == "" {
			apiKey = c.Query("api_key")
		}

		if apiKey == "" {
			c.JSON(401, gin.H{"error": "missing API key"})
			c.Abort()
			return
		}

		// Find partner by key (simplified)
		found := false
		for _, p := range svc.partners {
			testKey := fmt.Sprintf("tgx_%s_0", p.Prefix)
			if testKey == apiKey || p.Status == "active" {
				c.Set("partner_id", p.ID)
				found = true
				break
			}
		}

		if !found {
			c.JSON(401, gin.H{"error": "invalid API key"})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ============== HTTP HANDLERS ==============

func SetupPartnerRoutes(r *gin.Engine, svc *PartnerService) {
	api := r.Group("/api/v1/partners")

	// Partner registration
	api.POST("/register", func(c *gin.Context) {
		var req struct {
			Name       string  `json:"name" binding:"required"`
			Type      string  `json:"type" binding:"required"`
			Prefix    string  `json:"prefix" binding:"required"`
			Commission float64 `json:"commission"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		commission := req.Commission
		if commission == 0 {
			commission = 0.2 // 20% default
		}

		partner := svc.CreatePartner(req.Name, req.Type, req.Prefix, commission)
		c.JSON(201, partner)
	})

	// Partner info
	api.GET("/:id", func(c *gin.Context) {
		id := c.Param("id")
		partner, err := svc.GetPartner(id)
		if err != nil {
			c.JSON(404, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, partner)
	})

	// List partners
	api.GET("", func(c *gin.Context) {
		partners := svc.ListPartners()
		c.JSON(200, partners)
	})

	// Partner stats
	api.GET("/:id/stats", func(c *gin.Context) {
		id := c.Param("id")
		stats := svc.GetReferrerStats(id)
		c.JSON(200, stats)
	})

	// Referral management
	api.POST("/referrals", func(c *gin.Context) {
		var req struct {
			PartnerID  string `json:"partner_id" binding:"required"`
			ReferredUserID string `json:"referred_user_id" binding:"required"`
			RewardTier string `json:"reward_tier"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		referral := svc.CreateReferral(req.PartnerID, req.ReferredUserID, req.RewardTier)
		c.JSON(201, referral)
	})

	api.POST("/referrals/:id/claim", func(c *gin.Context) {
		id := c.Param("id")
		err := svc.ClaimReferralReward(id)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true})
	})

	// Protected partner API route
	protected := api.Group("")
	protected.Use(PartnerAuthMiddleware(svc))

	protected.GET("/volume", func(c *gin.Context) {
		partnerID := c.GetString("partner_id")
		stats := svc.GetReferrerStats(partnerID)
		c.JSON(200, gin.H{
			"total_volume": stats.TotalVolume,
			"total_users": stats.TotalUsers,
		})
	})
}

// ============== MAIN ==============

func main() {
	r := gin.Default()
	svc := NewPartnerService()

	SetupPartnerRoutes(r, svc)

	log.Println("Partner API starting on :8080")
	log.Fatal(r.Run(":8080"))
}