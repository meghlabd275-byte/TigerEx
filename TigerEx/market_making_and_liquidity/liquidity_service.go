package main

import "fmt"

// Market making service
type MarketMakingService struct{}

func NewMarketMakingService() *MarketMakingService {
	return &MarketMakingService{}
}

func (s *MarketMakingService) Rebate(volume, spread float64) float64 {
	return volume * 0.02
}

func (s *MarketMakingService) GetTiers() []map[string]interface{} {
	return []map[string]interface{}{
		{"spread": "0.1%", "rebate": 0.02},
	}
}

// API errors
type ApiErrors struct{}

func (e *ApiErrors) Get(code int) map[string]interface{} {
	return map[string]interface{}{"code": code, "msg": "error"}
}

// Monitors
type Monitors struct{}

func (m *Monitors) Health() map[string]string {
	return map[string]string{"status": "healthy"}
}

func main() {
	svc := NewMarketMakingService()
	fmt.Printf("Rebate: %.2f\n", svc.Rebate(10000, 0.001))
	fmt.Printf("Tiers: %v\n", svc.GetTiers())
	
	mon := Monitors{}
	fmt.Printf("Health: %v\n", mon.Health())
}