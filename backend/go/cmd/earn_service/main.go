package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// =============================================================================
// ERROR TYPES
// =============================================================================

type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e APIError) Error() string {
	return e.Message
}

// =============================================================================
// DATA TYPES
// =============================================================================

type ProductType string

const (
	ProductTypeFlexible    ProductType = "flexible"
	ProductTypeFixed       ProductType = "fixed"
	ProductTypeLaunchpool ProductType = "launchpool"
	ProductTypeDual       ProductType = "dual"
	ProductTypeRange      ProductType = "range"
	ProductTypeSharkFin   ProductType = "shark_fin"
	ProductTypeLottery    ProductType = "lottery"
)

type EarnProduct struct {
	ID              string      `json:"id"`
	Name            string      `json:"name"`
	Asset           string      `json:"asset"`
	Network         string      `json:"network"`
	ProductType     ProductType `json:"product_type"`
	APY            float64     `json:"apy"`
	MinAmount       float64     `json:"min_amount"`
	MaxAmount       float64     `json:"max_amount"`
	Duration        int         `json:"duration"` // days, 0 for flexible
	LockPeriod      int         `json:"lock_period"`
	TotalDeposited  float64     `json:"total_deposited"`
	TotalRewards   float64     `json:"total_rewards"`
	MaxRewards     float64     `json:"max_rewards"`
	Participants   int         `json:"participants"`
	Status         string      `json:"status"` // "active", "upcoming", "completed", "cancelled"
	StartTime      time.Time   `json:"start_time"`
	EndTime        time.Time   `json:"end_time"`
	EarlyRedemption bool       `json:"early_redemption"`
	AutoRenew      bool        `json:"auto_renew"`
	CreatedAt       time.Time   `json:"created_at"`
}

type EarnSubscription struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ProductID      string    `json:"product_id"`
	Asset         string    `json:"asset"`
	ProductType   ProductType `json:"product_type"`
	Amount        float64   `json:"amount"`
	APY           float64   `json:"apy"`
	RewardAmount  float64   `json:"reward_amount"`
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	Status        string    `json:"status"` // "active", "matured", "redeemed", "cancelled"
	RedeemedAt    *time.Time `json:"redeemed_at"`
	CreatedAt     time.Time `json:"created_at"`
}

type EarnReward struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	ProductID   string    `json:"product_id"`
	Asset       string    `json:"asset"`
	Amount      float64   `json:"amount"`
	Type        string    `json:"type"` // "interest", "bonus", "reward"
	TxHash      string    `json:"tx_hash"`
	Status      string    `json:"status"` // "pending", "completed", "failed"
	CreatedAt   time.Time `json:"created_at"`
}

type LaunchpoolProject struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description    string    `json:"description"`
	RewardToken    string    `json:"reward_token"`
	StakeToken     string    `json:"stake_token"`
	TotalRewards  float64   `json:"total_rewards"`
	Duration      int       `json:"duration"`
	MinStake      float64   `json:"min_stake"`
	APY           float64   `json:"apy"`
	Status        string    `json:"status"` // "upcoming", "active", "completed"
	StartTime    time.Time `json:"start_time"`
	EndTime      time.Time `json:"end_time"`
	Participants   int     `json:"participants"`
	TotalStaked  float64   `json:"total_staked"`
}

type LaunchpoolStake struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	ProjectID   string    `json:"project_id"`
	StakeAmount float64   `json:"stake_amount"`
	RewardAmount float64  `json:"reward_amount"`
	Claimed     bool     `json:"claimed"`
	ClaimedAt   *time.Time `json:"claimed_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type Coupon struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Code        string    `json:"code"`
	Type        string    `json:"type"` // "deposit", "trading", "staking"
	Amount      float64   `json:"amount"`
	Currency    string    `json:"currency"`
	MinRequirement float64 `json:"min_requirement"`
	ExpiresAt   time.Time `json:"expires_at"`
	UsedAt     *time.Time `json:"used_at"`
	Status      string    `json:"status"` // "active", "used", "expired"
	CreatedAt   time.Time `json:"created_at"`
}

type RedPacket struct {
	ID          string    `json:"id"`
	CreatorID   string    `json:"creator_id"`
	Asset       string    `json:"asset"`
	Amount      float64   `json:"amount"`
	Quantity    int       `json:"quantity"`
	Type        string    `json:"type"` // "random", "average"
	Claimed     int       `json:"claimed"`
	Remaining  float64   `json:"remaining"`
	Status      string    `json:"status"` // "active", "completed"
	Message     string    `json:"message"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type RedPacketClaim struct {
	ID          string    `json:"id"`
	PacketID    string    `json:"packet_id"`
	UserID      string    `json:"user_id"`
	Amount      float64   `json:"amount"`
	ClaimedAt   time.Time `json:"claimed_at"`
}

// =============================================================================
// EARN SERVICE
// =============================================================================

type EarnService struct {
	products       map[string]*EarnProduct
	subscriptions  map[string]*EarnSubscription
	rewards        map[string]*EarnReward
	launchpools    map[string]*LaunchpoolProject
	launchpoolStakes map[string]*LaunchpoolStake
	coupons       map[string]*Coupon
	redPackets    map[string]*RedPacket
	redPacketClaims map[string]*RedPacketClaim
	mu            sync.RWMutex
}

func NewEarnService() *EarnService {
	svc := &EarnService{
		products:       make(map[string]*EarnProduct),
		subscriptions:  make(map[string]*EarnSubscription),
		rewards:       make(map[string]*EarnReward),
		launchpools:   make(map[string]*LaunchpoolProject),
		launchpoolStakes: make(map[string]*LaunchpoolStake),
		coupons:       make(map[string]*Coupon),
		redPackets:    make(map[string]*RedPacket),
		redPacketClaims: make(map[string]*RedPacketClaim),
	}

	svc.initProducts()
	svc.initLaunchpools()

	return svc
}

func (s *EarnService) initProducts() {
	products := []*EarnProduct{
		{
			ID: "eth-flexible", Name: "Ethereum Flexible", Asset: "ETH", Network: "Ethereum",
			ProductType: ProductTypeFlexible, APY: 4.5, MinAmount: 0.01, MaxAmount: 100,
			Duration: 0, LockPeriod: 0, TotalDeposited: 25000, Status: "active",
			EarlyRedemption: true, AutoRenew: true, CreatedAt: time.Now().AddDate(0, -2, 0),
		},
		{
			ID: "usdt-fixed-30", Name: "USDT Fixed 30 Days", Asset: "USDT", Network: "Ethereum",
			ProductType: ProductTypeFixed, APY: 8.5, MinAmount: 100, MaxAmount: 100000,
			Duration: 30, LockPeriod: 30, TotalDeposited: 5000000, Status: "active",
			EarlyRedemption: false, AutoRenew: false, CreatedAt: time.Now().AddDate(0, -1, 0),
		},
		{
			ID: "usdt-fixed-60", Name: "USDT Fixed 60 Days", Asset: "USDT", Network: "Ethereum",
			ProductType: ProductTypeFixed, APY: 10.2, MinAmount: 100, MaxAmount: 100000,
			Duration: 60, LockPeriod: 60, TotalDeposited: 3500000, Status: "active",
			EarlyRedemption: false, AutoRenew: false, CreatedAt: time.Now().AddDate(0, -1, 0),
		},
		{
			ID: "usdt-fixed-90", Name: "USDT Fixed 90 Days", Asset: "USDT", Network: "Ethereum",
			ProductType: ProductTypeFixed, APY: 12.5, MinAmount: 100, MaxAmount: 100000,
			Duration: 90, LockPeriod: 90, TotalDeposited: 8000000, Status: "active",
			EarlyRedemption: false, AutoRenew: false, CreatedAt: time.Now().AddDate(0, -1, 0),
		},
		{
			ID: "bnb-flexible", Name: "BNB Flexible", Asset: "BNB", Network: "BSC",
			ProductType: ProductTypeFlexible, APY: 3.8, MinAmount: 0.01, MaxAmount: 500,
			Duration: 0, LockPeriod: 0, TotalDeposited: 15000, Status: "active",
			EarlyRedemption: true, AutoRenew: true, CreatedAt: time.Now().AddDate(0, -2, 0),
		},
		{
			ID: "sol-flexible", Name: "Solana Flexible", Asset: "SOL", Network: "Solana",
			ProductType: ProductTypeFlexible, APY: 6.5, MinAmount: 1, MaxAmount: 10000,
			Duration: 0, LockPeriod: 0, TotalDeposited: 85000, Status: "active",
			EarlyRedemption: true, AutoRenew: true, CreatedAt: time.Now().AddDate(0, -1, 0),
		},
		{
			ID: "dot-fixed-30", Name: "Polkadot Fixed 30 Days", Asset: "DOT", Network: "Polkadot",
			ProductType: ProductTypeFixed, APY: 15.0, MinAmount: 50, MaxAmount: 50000,
			Duration: 30, LockPeriod: 30, TotalDeposited: 250000, Status: "active",
			EarlyRedemption: false, AutoRenew: false, CreatedAt: time.Now().AddDate(0, -1, 0),
		},
		{
			ID: "avax-fixed-30", Name: "Avalanche Fixed 30 Days", Asset: "AVAX", Network: "Avalanche",
			ProductType: ProductTypeFixed, APY: 11.0, MinAmount: 25, MaxAmount: 25000,
			Duration: 30, LockPeriod: 30, TotalDeposited: 180000, Status: "active",
			EarlyRedemption: false, AutoRenew: false, CreatedAt: time.Now().AddDate(0, -1, 0),
		},
	}

	for _, p := range products {
		s.products[p.ID] = p
	}
}

func (s *EarnService) initLaunchpools() {
	projects := []*LaunchpoolProject{
		{
			ID: "new-token-launch", Name: "New Token Launch", Description: "Stake USDT to earn new token",
			RewardToken: "NEW", StakeToken: "USDT", TotalRewards: 1000000, Duration: 7,
			MinStake: 100, APY: 250.0, Status: "active",
			StartTime: time.Now().AddDate(0, 0, -3), EndTime: time.Now().AddDate(0, 0, 4),
			Participants: 5000, TotalStaked: 25000000,
		},
		{
			ID: "defi-token-launch", Name: "DeFi Token Launch", Description: "Stake ETH to earn DeFi tokens",
			RewardToken: "DEFI", StakeToken: "ETH", TotalRewards: 50000, Duration: 14,
			MinStake: 0.1, APY: 180.0, Status: "active",
			StartTime: time.Now().AddDate(0, 0, -5), EndTime: time.Now().AddDate(0, 0, 9),
			Participants: 2500, TotalStaked: 5000,
		},
	}

	for _, p := range projects {
		s.launchpools[p.ID] = p
	}
}

// =============================================================================
// EARN PRODUCTS
// =============================================================================

func (s *EarnService) GetProducts(productType ProductType, status string) []*EarnProduct {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*EarnProduct
	for _, p := range s.products {
		if (productType == "" || p.ProductType == productType) &&
			(status == "" || p.Status == status) {
			result = append(result, p)
		}
	}
	return result
}

func (s *EarnService) GetProduct(productID string) (*EarnProduct, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p, ok := s.products[productID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Product not found"}
	}
	return p, nil
}

// =============================================================================
// SUBSCRIPTIONS
// =============================================================================

func (s *EarnService) Subscribe(userID, productID string, amount float64) (*EarnSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate product
	product, ok := s.products[productID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Product not found"}
	}

	if product.Status != "active" {
		return nil, APIError{Code: 400, Message: "Product is not available"}
	}

	// Validate amount
	if amount < product.MinAmount {
		return nil, APIError{Code: 400, Message: fmt.Sprintf("Minimum amount is %f", product.MinAmount)}
	}

	if amount > product.MaxAmount {
		return nil, APIError{Code: 400, Message: fmt.Sprintf("Maximum amount is %f", product.MaxAmount)}
	}

	// Calculate reward
	duration := product.Duration
	if duration == 0 {
		duration = 1 // Flexible products calculate daily
	}
	reward := amount * (product.APY / 100) * (float64(duration) / 365)

	now := time.Now()
	endTime := now
	if product.Duration > 0 {
		endTime = now.AddDate(0, 0, product.Duration)
	}

	subscription := &EarnSubscription{
		ID:           uuid.New().String(),
		UserID:       userID,
		ProductID:    productID,
		Asset:        product.Asset,
		ProductType:  product.ProductType,
		Amount:       amount,
		APY:          product.APY,
		RewardAmount: reward,
		StartTime:    now,
		EndTime:      endTime,
		Status:       "active",
		CreatedAt:    now,
	}

	// Update product stats
	product.TotalDeposited += amount
	product.TotalRewards += reward
	product.Participants++

	s.subscriptions[subscription.ID] = subscription

	return subscription, nil
}

func (s *EarnService) Redeem(userID, subscriptionID string) (*EarnReward, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, ok := s.subscriptions[subscriptionID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Subscription not found"}
	}

	if sub.UserID != userID {
		return nil, APIError{Code: 403, Message: "Not authorized"}
	}

	if sub.Status != "active" {
		return nil, APIError{Code: 400, Message: "Subscription is not active"}
	}

	// Check if matured
	if time.Now().Before(sub.EndTime) {
		product := s.products[sub.ProductID]
		if !product.EarlyRedemption {
			return nil, APIError{Code: 400, Message: "Lock period not yet over"}
		}
	}

	// Create reward
	reward := &EarnReward{
		ID:        uuid.New().String(),
		UserID:    userID,
		ProductID: sub.ProductID,
		Asset:    sub.Asset,
		Amount:   sub.RewardAmount,
		Type:     "interest",
		TxHash:   generateTxHash(),
		Status:   "completed",
		CreatedAt: time.Now(),
	}

	// Update subscription
	now := time.Now()
	sub.Status = "redeemed"
	sub.RedeemedAt = &now

	// Update product
	if product := s.products[sub.ProductID]; product != nil {
		product.TotalDeposited -= sub.Amount
		product.Participants--
	}

	s.rewards[reward.ID] = reward

	return reward, nil
}

func (s *EarnService) GetUserSubscriptions(userID string) []*EarnSubscription {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*EarnSubscription
	for _, sub := range s.subscriptions {
		if sub.UserID == userID {
			result = append(result, sub)
		}
	}
	return result
}

// =============================================================================
// LAUNCHPOOLS
// =============================================================================

func (s *EarnService) GetLaunchpools(status string) []*LaunchpoolProject {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*LaunchpoolProject
	for _, p := range s.launchpools {
		if status == "" || p.Status == status {
			result = append(result, p)
		}
	}
	return result
}

func (s *EarnService) StakeLaunchpool(userID, projectID string, amount float64) (*LaunchpoolStake, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	project, ok := s.launchpools[projectID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Project not found"}
	}

	if project.Status != "active" {
		return nil, APIError{Code: 400, Message: "Project is not active"}
	}

	if amount < project.MinStake {
		return nil, APIError{Code: 400, Message: fmt.Sprintf("Minimum stake is %f", project.MinStake)}
	}

	// Calculate reward
	reward := amount * (project.APY / 100) * (float64(project.Duration) / 365)

	stake := &LaunchpoolStake{
		ID:           uuid.New().String(),
		UserID:       userID,
		ProjectID:    projectID,
		StakeAmount:  amount,
		RewardAmount: reward,
		Claimed:     false,
		CreatedAt:   time.Now(),
	}

	// Update project
	project.TotalStaked += amount
	project.Participants++

	s.launchpoolStakes[stake.ID] = stake

	return stake, nil
}

func (s *EarnService) ClaimLaunchpoolReward(userID, stakeID string) (*EarnReward, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	stake, ok := s.launchpoolStakes[stakeID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Stake not found"}
	}

	if stake.UserID != userID {
		return nil, APIError{Code: 403, Message: "Not authorized"}
	}

	if stake.Claimed {
		return nil, APIError{Code: 400, Message: "Already claimed"}
	}

	// Create reward
	reward := &EarnReward{
		ID:        uuid.New().String(),
		UserID:    userID,
		ProductID: stake.ProjectID,
		Asset:    "NEW",
		Amount:   stake.RewardAmount,
		Type:     "reward",
		TxHash:   generateTxHash(),
		Status:   "completed",
		CreatedAt: time.Now(),
	}

	now := time.Now()
	stake.Claimed = true
	stake.ClaimedAt = &now

	s.rewards[reward.ID] = reward

	return reward, nil
}

func (s *EarnService) GetUserLaunchpoolStakes(userID string) []*LaunchpoolStake {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*LaunchpoolStake
	for _, stake := range s.launchpoolStakes {
		if stake.UserID == userID {
			result = append(result, stake)
		}
	}
	return result
}

// =============================================================================
// COUPONS
// =============================================================================

func (s *EarnService) CreateCoupon(userID, couponType string, amount, minRequirement float64) (*Coupon, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	code := generateCouponCode()

	coupon := &Coupon{
		ID:             uuid.New().String(),
		UserID:         userID,
		Code:          code,
		Type:          couponType,
		Amount:        amount,
		Currency:       "USDT",
		MinRequirement: minRequirement,
		ExpiresAt:     time.Now().AddDate(0, 1, 0),
		Status:        "active",
		CreatedAt:     time.Now(),
	}

	s.coupons[coupon.ID] = coupon

	return coupon, nil
}

func (s *EarnService) RedeemCoupon(userID, code string) (*Coupon, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var coupon *Coupon
	for _, c := range s.coupons {
		if c.Code == code {
			coupon = c
			break
		}
	}

	if coupon == nil {
		return nil, APIError{Code: 404, Message: "Coupon not found"}
	}

	if coupon.UserID != userID {
		return nil, APIError{Code: 403, Message: "Coupon not for this user"}
	}

	if coupon.Status != "active" {
		return nil, APIError{Code: 400, Message: "Coupon is not active"}
	}

	if time.Now().After(coupon.ExpiresAt) {
		return nil, APIError{Code: 400, Message: "Coupon has expired"}
	}

	now := time.Now()
	coupon.Status = "used"
	coupon.UsedAt = &now

	return coupon, nil
}

func (s *EarnService) GetUserCoupons(userID string) []*Coupon {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Coupon
	for _, c := range s.coupons {
		if c.UserID == userID {
			result = append(result, c)
		}
	}
	return result
}

// =============================================================================
// RED PACKETS
// =============================================================================

func (s *EarnService) CreateRedPacket(creatorID, asset, packetType, message string, amount float64, quantity int) (*RedPacket, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if amount <= 0 || quantity <= 0 {
		return nil, APIError{Code: 400, Message: "Invalid amount or quantity"}
	}

	packet := &RedPacket{
		ID:        uuid.New().String(),
		CreatorID: creatorID,
		Asset:    asset,
		Amount:   amount,
		Quantity: quantity,
		Type:     packetType,
		Claimed:  0,
		Remaining: amount,
		Status:   "active",
		Message:  message,
		ExpiresAt: time.Now().AddDate(0, 1, 0),
		CreatedAt: time.Now(),
	}

	s.redPackets[packet.ID] = packet

	return packet, nil
}

func (s *EarnService) ClaimRedPacket(userID, packetID string) (*RedPacketClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	packet, ok := s.redPackets[packetID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Red packet not found"}
	}

	if packet.Status != "active" {
		return nil, APIError{Code: 400, Message: "Red packet is no longer active"}
	}

	if time.Now().After(packet.ExpiresAt) {
		return nil, APIError{Code: 400, Message: "Red packet has expired"}
	}

	// Calculate claim amount
	var claimAmount float64
	if packet.Type == "average" {
		claimAmount = packet.Amount / float64(packet.Quantity)
	} else {
		// Random - simplified for demo
		claimAmount = packet.Remaining / float64(packet.Quantity-packet.Claimed)
	}

	claim := &RedPacketClaim{
		ID:        uuid.New().String(),
		PacketID: packetID,
		UserID:   userID,
		Amount:   claimAmount,
		ClaimedAt: time.Now(),
	}

	packet.Claimed++
	packet.Remaining -= claimAmount

	if packet.Claimed >= packet.Quantity {
		packet.Status = "completed"
	}

	s.redPacketClaims[claim.ID] = claim

	return claim, nil
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

func (s *EarnService) GetProductsHandler(c *gin.Context) {
	productType := ProductType(c.Query("type"))
	status := c.Query("status")
	products := s.GetProducts(productType, status)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": products})
}

func (s *EarnService) GetProductHandler(c *gin.Context) {
	productID := c.Param("id")
	product, err := s.GetProduct(productID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": product})
}

func (s *EarnService) SubscribeHandler(c *gin.Context) {
	var req struct {
		UserID    string  `json:"user_id" binding:"required"`
		ProductID string  `json:"product_id" binding:"required"`
		Amount    float64 `json:"amount" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	sub, err := s.Subscribe(req.UserID, req.ProductID, req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": sub})
}

func (s *EarnService) RedeemHandler(c *gin.Context) {
	subID := c.Param("id")

	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	reward, err := s.Redeem(req.UserID, subID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": reward})
}

func (s *EarnService) GetUserSubscriptionsHandler(c *gin.Context) {
	userID := c.Param("user_id")
	subs := s.GetUserSubscriptions(userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": subs})
}

func (s *EarnService) GetLaunchpoolsHandler(c *gin.Context) {
	status := c.Query("status")
	pools := s.GetLaunchpools(status)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": pools})
}

func (s *EarnService) StakeLaunchpoolHandler(c *gin.Context) {
	var req struct {
		UserID   string  `json:"user_id" binding:"required"`
		ProjectID string `json:"project_id" binding:"required"`
		Amount   float64 `json:"amount" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	stake, err := s.StakeLaunchpool(req.UserID, req.ProjectID, req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": stake})
}

func (s *EarnService) ClaimLaunchpoolRewardHandler(c *gin.Context) {
	stakeID := c.Param("id")

	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	reward, err := s.ClaimLaunchpoolReward(req.UserID, stakeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": reward})
}

func (s *EarnService) CreateRedPacketHandler(c *gin.Context) {
	var req struct {
		CreatorID string  `json:"creator_id" binding:"required"`
		Asset     string  `json:"asset" binding:"required"`
		Type      string  `json:"type" binding:"required"`
		Message   string  `json:"message"`
		Amount    float64 `json:"amount" binding:"required,gt=0"`
		Quantity  int     `json:"quantity" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	packet, err := s.CreateRedPacket(req.CreatorID, req.Asset, req.Type, req.Message, req.Amount, req.Quantity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": packet})
}

func (s *EarnService) ClaimRedPacketHandler(c *gin.Context) {
	packetID := c.Param("id")

	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	claim, err := s.ClaimRedPacket(req.UserID, packetID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": claim})
}

func (s *EarnService) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "earn-service",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// =============================================================================
// HELPERS
// =============================================================================

func generateTxHash() string {
	hash := sha256.Sum256([]byte(uuid.New().String() + time.Now().Format(time.RFC3339Nano)))
	return "0x" + hex.EncodeToString(hash[:])[:64]
}

func generateCouponCode() string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 12)
	for i := range b {
		hash := sha256.Sum256([]byte(uuid.New().String() + fmt.Sprintf("%d", i)))
		b[i] = charset[hash[0]%byte(len(charset))]
	}
	return string(b)
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	gin.SetMode(gin.ReleaseMode)

	svc := NewEarnService()

	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Health check
	r.GET("/health", svc.HealthCheck)

	// API routes
	api := r.Group("/api/v1/earn")
	{
		// Products
		api.GET("/products", svc.GetProductsHandler)
		api.GET("/products/:id", svc.GetProductHandler)

		// Subscriptions
		api.POST("/subscribe", svc.SubscribeHandler)
		api.POST("/redeem/:id", svc.RedeemHandler)
		api.GET("/users/:user_id/subscriptions", svc.GetUserSubscriptionsHandler)

		// Launchpools
		api.GET("/launchpools", svc.GetLaunchpoolsHandler)
		api.POST("/launchpool/stake", svc.StakeLaunchpoolHandler)
		api.POST("/launchpool/claim/:id", svc.ClaimLaunchpoolRewardHandler)

		// Red Packets
		api.POST("/red-packet", svc.CreateRedPacketHandler)
		api.POST("/red-packet/claim/:id", svc.ClaimRedPacketHandler)
	}

	fmt.Println("Starting Earn Service on :8088")
	r.Run(":8088")
}
