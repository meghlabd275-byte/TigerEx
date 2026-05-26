package main

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX P2P SERVICE - GO
// Peer-to-peer trading platform
// ============================================================================

type Advert struct {
	ID          string  `json:"id"`
	UserID     string  `json:"user_id"`
	Type       string  `json:"type"` // buy, sell
	Asset      string  `json:"asset"`
	FiatAmount float64 `json:"fiat_amount"`
	FiatCurr   string  `json:"fiat_currency"`
	PriceType  string  `json:"price_type"` // fixed, floating
	PriceOffset float64 `json:"price_offset"`
	LimitMin  float64 `json:"limit_min"`
	LimitMax  float64 `json:"limit_max"`
	PaymentMethods []string `json:"payment_methods"`
	Status    string  `json:"status"` // active, paused
}

type Trade struct {
	ID        string  `json:"id"`
	AdvertID string  `json:"advert_id"`
	TakerID  string  `json:"taker_id"`
	Amount  float64 `json:"amount"`
	Price   float64 `json:"price"`
	Status  string  `json:"status"` // pending, paid, completed, cancelled, disputed
	ChatID  string  `json:"chat_id"`
}

type P2PService struct {
	adverts map[string]*Advert
	trades map[string]*Trade
}

func NewP2PService() *P2PService {
	return &P2PService{
		adverts: make(map[string]*Advert),
		trades: make(map[string]*Trade),
	}
}

func (s *P2PService) CreateAdvert(userID, advertType, asset, fiatCurr, priceType string, fiatAmount, offset, min, max float64, methods []string) *Advert {
	advert := &Advert{
		ID: fmt.Sprintf("adv_%d", time.Now().UnixNano()),
		UserID: userID, Type: advertType, Asset: asset,
		FiatAmount: fiatAmount, FiatCurr: fiatCurr,
		PriceType: priceType, PriceOffset: offset,
		LimitMin: min, LimitMax: max,
		PaymentMethods: methods, Status: "active",
	}
	s.adverts[advert.ID] = advert
	return advert
}

func (s *P2PService) AcceptTrade(advertID, takerID string) *Trade {
	advert, ok := s.adverts[advertID]
	if !ok {
		return nil
	}

	trade := &Trade{
		ID: fmt.Sprintf("trade_%d", time.Now().UnixNano()),
		AdvertID: advertID, TakerID: takerID,
		Status: "pending", ChatID: fmt.Sprintf("chat_%d", time.Now().UnixNano()),
	}
	s.trades[trade.ID] = trade
	return trade
}

func (s *P2PService) MarkPaid(tradeID string) error {
	if trade, ok := s.trades[tradeID]; ok {
		trade.Status = "paid"
		return nil
	}
	return fmt.Errorf("trade not found")
}

func (s *P2PService) Release(tradeID string) error {
	if trade, ok := s.trades[tradeID]; ok {
		trade.Status = "completed"
		return nil
	}
	return fmt.Errorf("trade not found")
}

func SetupP2PRoutes(r *gin.Engine, svc *P2PService) {
	api := r.Group("/api/v1/p2p")

	api.GET("/adverts", func(c *gin.Context) {
		var adverts []*Advert
		for _, a := range svc.adverts {
			if a.Status == "active" {
				adverts = append(adverts, a)
			}
		}
		c.JSON(200, adverts)
	})

	api.POST("/adverts", func(c *gin.Context) {
		var req struct {
			UserID     string  `json:"user_id"`
			Type      string  `json:"type"`
			Asset     string  `json:"asset"`
			FiatAmount float64 `json:"fiat_amount"`
			FiatCurr  string  `json:"fiat_currency"`
			PriceType string  `json:"price_type"`
			Offset   float64 `json:"offset"`
			Min      float64 `json:"min"`
			Max      float64 `json:"max"`
			Methods  []string `json:"methods"`
		}
		c.ShouldBindJSON(&req)

		advert := svc.CreateAdvert(req.UserID, req.Type, req.Asset, req.FiatCurr, req.PriceType, req.FiatAmount, req.Offset, req.Min, req.Max, req.Methods)
		c.JSON(201, advert)
	})

	api.POST("/trades", func(c *gin.Context) {
		var req struct {
			AdvertID string `json:"advert_id"`
			TakerID  string `json:"taker_id"`
		}
		c.ShouldBindJSON(&req)

		trade := svc.AcceptTrade(req.AdvertID, req.TakerID)
		if trade == nil {
			c.JSON(400, gin.H{"error": "advert not found"})
			return
		}
		c.JSON(201, trade)
	})

	api.POST("/trades/:id/markpaid", func(c *gin.Context) {
		id := c.Param("id")
		err := svc.MarkPaid(id)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
		} else {
			c.JSON(200, gin.H{"success": true})
		}
	})

	api.POST("/trades/:id/release", func(c *gin.Context) {
		id := c.Param("id")
		err := svc.Release(id)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
		} else {
			c.JSON(200, gin.H{"success": true})
		}
	})
}

func main() {
	r := gin.Default()
	svc := NewP2PService()
	SetupP2PRoutes(r, svc)
	log.Fatal(r.Run(":8080"))
}