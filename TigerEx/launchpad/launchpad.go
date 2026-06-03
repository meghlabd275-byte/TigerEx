// =============================================================================
// TOKEN LAUNCHPAD / IEO PLATFORM
// Complete launchpad for listing new tokens on TigerEx
// Supports IEO, IDO, Fair Launch mechanisms
// =============================================================================

package launchpad

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	LaunchTypeIEO         = "ieo"
	LaunchTypeIDO         = "ido"
	LaunchTypeFairLaunch  = "fair_launch"
	
	PhaseRegistration = "registration"
	PhaseWhitelist   = "whitelist"
	PhaseSale       = "sale"
	PhaseClaiming   = "claiming"
	PhaseEnded       = "ended"
	
	StatusUpcoming   = "upcoming"
	StatusActive    = "active"
	StatusSoldOut   = "sold_out"
	StatusSuccess   = "success"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

// ============================================================================
// TYPES
// ============================================================================

type Config struct {
	PlatformFee       float64
	ProjectTokenFee   float64
	MinRaiseAmount   float64
	MaxRaiseAmount   float64
	RegistrationPeriod time.Duration
	SaleDuration     time.Duration
	WhitelistEnabled bool
	MaxParticipants  int
	AllowedCoins     []string
}

type Launch struct {
	ID               string
	Name             string
	Token            string
	TokenAddress     string
	TokenDecimals    int
	LaunchType       string
	
	PricePerToken    float64
	TotalSupply     float64
	TokensForSale   float64
	TokensSold       float64
	TokensRaised    float64
	
	MinAllocation    float64
	MaxAllocation    float64
	MaxParticipants  int
	
	RegistrationStart time.Time
	RegistrationEnd time.Time
	SaleStart       time.Time
	SaleEnd         time.Time
	
	PaymentCoin      string
	FundsRaised     float64
	TargetRaise     float64
	
	Status          string
	CurrentPhase    string
	
	ProjectName         string
	ProjectDescription  string
	Website            string
	WhitepaperURL      string
	Symbol             string
	
	Telegram  string
	Twitter   string
	Discord   string
	
	LogoURL   string
	BannerURL string
	
	TeamReward         float64
	MarketingReward    float64
	LiquidityPercent  float64
	
	_createdAt time.Time
	_updatedAt time.Time
	
	mu sync.RWMutex
}

type Participant struct {
	ID           string
	UserID       string
	LaunchID    string
	Status      string
	Tier        int
	Allocation  float64
	Committed   float64
	Claimed     bool
	ClaimedAmount float64
	AppliedAt   time.Time
}

type TokenAllocation struct {
	UserID         string
	LaunchID      string
	TokenAmount   float64
	TokenValue    float64
	VestingPlan   string
	ClaimedAmount float64
	LockEndTime   time.Time
	CreatedAt     time.Time
}

type ProjectInfo struct {
	OwnerID       string
	Name          string
	Description   string
	TokenSymbol   string
	TotalSupply   float64
	Links         map[string]string
	Verified      bool
	KYCPassed     bool
	AuditPassed   bool
	SoftCap       float64
	HardCap       float64
	StartedAt     time.Time
}

type Launchpad struct {
	mu            sync.RWMutex
	config        Config
	launches      map[string]*Launch
	participants  map[string]map[string]*Participant
	allocations   map[string]map[string]*TokenAllocation
	projects      map[string]*ProjectInfo
	status        string
	startTime     time.Time
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func NewLaunchpad(cfg Config) *Launchpad {
	if cfg.PlatformFee <= 0 {
		cfg.PlatformFee = 3
	}
	if cfg.MinRaiseAmount <= 0 {
		cfg.MinRaiseAmount = 50000
	}
	if cfg.MaxRaiseAmount <= 0 {
		cfg.MaxRaiseAmount = 5000000
	}
	if len(cfg.AllowedCoins) == 0 {
		cfg.AllowedCoins = []string{"USDT", "USDC", "BUSD"}
	}
	
	return &Launchpad{
		config:       cfg,
		launches:    make(map[string]*Launch),
		participants: make(map[string]map[string]*Participant),
		allocations: make(map[string]map[string]*TokenAllocation),
		projects:    make(map[string]*ProjectInfo),
		status:      "active",
		startTime:   time.Now(),
	}
}

// ============================================================================
// LAUNCH MANAGEMENT
// ============================================================================

type CreateLaunchParams struct {
	LaunchType      string
	PricePerToken  float64
	TokensForSale  float64
	MinAllocation  float64
	MaxAllocation  float64
	MaxParticipants int
	TargetRaise   float64
	PaymentCoin    string
	SoftCap        float64
	HardCap        float64
	RegistrationStart time.Time
	RegistrationEnd   time.Time
	SaleStart        time.Time
	SaleEnd          time.Time
}

func (lp *Launchpad) CreateLaunch(ctx context.Context, proj *ProjectInfo, params CreateLaunchParams) (*Launch, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	if !proj.KYCPassed {
		return nil, fmt.Errorf("project must pass KYC verification")
	}
	
	if params.SoftCap >= params.HardCap {
		return nil, fmt.Errorf("soft cap must be less than hard cap")
	}
	
	launch := &Launch{
		ID:               generateLaunchID(),
		Name:             proj.Name,
		Token:            proj.TokenSymbol,
		LaunchType:       params.LaunchType,
		PricePerToken:   params.PricePerToken,
		TotalSupply:     proj.TotalSupply,
		TokensForSale:   params.TokensForSale,
		MinAllocation:    params.MinAllocation,
		MaxAllocation:    params.MaxAllocation,
		MaxParticipants:  params.MaxParticipants,
		TargetRaise:      params.TargetRaise,
		PaymentCoin:      params.PaymentCoin,
		RegistrationStart: params.RegistrationStart,
		RegistrationEnd:   params.RegistrationEnd,
		SaleStart:        params.SaleStart,
		SaleEnd:          params.SaleEnd,
		ProjectName:       proj.Name,
		ProjectDescription: proj.Description,
		Website:          proj.Links["website"],
		WhitepaperURL:    proj.Links["whitepaper"],
		LogoURL:          proj.Links["logo"],
		BannerURL:        proj.Links["banner"],
		Description:      proj.Description,
		TeamReward:       20,
		MarketingReward:  10,
		LiquidityPercent: 20,
		Status:           StatusUpcoming,
		CurrentPhase:     PhaseRegistration,
		_createdAt:       time.Now(),
		_updatedAt:       time.Now(),
	}
	
	lp.launches[launch.ID] = launch
	return launch, nil
}

func (lp *Launchpad) UpdateLaunchStatus(ctx context.Context, launchID string) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	launch, ok := lp.launches[launchID]
	if !ok {
		return fmt.Errorf("launch not found")
	}
	
	now := time.Now()
	
	if now.Before(launch.RegistrationStart) {
		launch.Status = StatusUpcoming
		launch.CurrentPhase = PhaseRegistration
	} else if now.After(launch.RegistrationStart) && now.Before(launch.RegistrationEnd) {
		launch.CurrentPhase = PhaseWhitelist
		launch.Status = StatusActive
	} else if now.After(launch.RegistrationEnd) && now.Before(launch.SaleStart) {
		launch.CurrentPhase = PhaseSale
	} else if now.After(launch.SaleStart) && now.Before(launch.SaleEnd) {
		launch.CurrentPhase = PhaseSale
		launch.Status = StatusActive
	} else if now.After(launch.SaleEnd) {
		launch.CurrentPhase = PhaseClaiming
		if launch.FundsRaised >= launch.TargetRaise {
			launch.Status = StatusSuccess
		} else if launch.TokensSold >= launch.TokensForSale {
			launch.Status = StatusSoldOut
		} else {
			launch.Status = StatusFailed
		}
	}
	
	launch._updatedAt = now
	return nil
}

// ============================================================================
// PARTICIPATION
// ============================================================================

func (lp *Launchpad) RegisterForLaunch(ctx context.Context, userID, launchID string) (*Participant, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	launch, ok := lp.launches[launchID]
	if !ok {
		return nil, fmt.Errorf("launch not found")
	}
	
	now := time.Now()
	if now.Before(launch.RegistrationStart) || now.After(launch.RegistrationEnd) {
		return nil, fmt.Errorf("registration not open")
	}
	
	if launch.MaxParticipants > 0 {
		count := len(lp.participants[launchID])
		if count >= launch.MaxParticipants {
			return nil, fmt.Errorf("max participants reached")
		}
	}
	
	if p, ok := lp.participants[launchID][userID]; ok {
		return p, nil
	}
	
	p := &Participant{
		ID:        generateParticipantID(),
		UserID:    userID,
		LaunchID:  launchID,
		Status:    "registered",
		Tier:      0,
		AppliedAt: now,
	}
	
	if lp.participants[launchID] == nil {
		lp.participants[launchID] = make(map[string]*Participant)
	}
	lp.participants[launchID][userID] = p
	
	return p, nil
}

func (lp *Launchpad) CommitFunds(ctx context.Context, userID, launchID string, amount float64, paymentCoin string) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	launch, ok := lp.launches[launchID]
	if !ok {
		return fmt.Errorf("launch not found")
	}
	
	if launch.Status != StatusActive {
		return fmt.Errorf("launch not active")
	}
	
	if launch.CurrentPhase != PhaseSale {
		return fmt.Errorf("sale phase not active")
	}
	
	if paymentCoin != launch.PaymentCoin {
		return fmt.Errorf("invalid payment coin: %s", paymentCoin)
	}
	
	participant, ok := lp.participants[launchID][userID]
	if !ok {
		return fmt.Errorf("not registered")
	}
	
	if participant.Allocation > 0 && amount > participant.Allocation {
		return fmt.Errorf("exceeds allocation: %.2f", participant.Allocation)
	}
	
	newTotal := launch.FundsRaised + amount
	if launch.TargetRaise > 0 && newTotal > launch.TargetRaise {
		available := launch.TargetRaise - launch.FundsRaised
		amount = available
		if amount <= 0 {
			launch.Status = StatusSoldOut
			return fmt.Errorf("sold out")
		}
	}
	
	participant.Committed += amount
	launch.FundsRaised += amount
	
	tokensAllocated := amount / launch.PricePerToken
	launch.TokensSold += tokensAllocated
	
	allocation := &TokenAllocation{
		UserID:       userID,
		LaunchID:     launchID,
		TokenValue:   amount,
		TokenAmount:  tokensAllocated,
		VestingPlan:  "linear_12m",
		CreatedAt:    time.Now(),
	}
	
	if lp.allocations[launchID] == nil {
		lp.allocations[launchID] = make(map[string]*TokenAllocation)
	}
	lp.allocations[launchID][userID] = allocation
	
	return nil
}

func (lp *Launchpad) ClaimTokens(ctx context.Context, userID, launchID string) (float64, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	_, ok := lp.launches[launchID]
	if !ok {
		return 0, fmt.Errorf("launch not found")
	}
	
	allocation, ok := lp.allocations[launchID][userID]
	if !ok {
		return 0, fmt.Errorf("no allocation found")
	}
	
	if allocation.Claimed {
		return 0, fmt.Errorf("already claimed")
	}
	
	claimable := allocation.TokenAmount
	allocation.ClaimedAmount = claimable
	allocation.Claimed = true
	
	return claimable, nil
}

// ============================================================================
// WHITELIST MANAGEMENT
// ============================================================================

func (lp *Launchpad) AddToWhitelist(ctx context.Context, launchID string, userIDs []string, tier int) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	launch, ok := lp.launches[launchID]
	if !ok {
		return fmt.Errorf("launch not found")
	}
	
	for _, userID := range userIDs {
		if p, ok := lp.participants[launchID][userID]; ok {
			p.Tier = tier
			p.Status = "winner"
			
			switch tier {
			case 2:
				p.Allocation = launch.MaxAllocation * 3
			case 1:
				p.Allocation = launch.MaxAllocation * 2
			default:
				p.Allocation = launch.MaxAllocation
			}
		}
	}
	
	return nil
}

func (lp *Launchpad) DrawLottery(ctx context.Context, launchID string, winnerCount int) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	launch, ok := lp.launches[launchID]
	if !ok {
		return fmt.Errorf("launch not found")
	}
	
	registrants := make([]*Participant, 0)
	for _, p := range lp.participants[launchID] {
		if p.Status == "registered" {
			registrants = append(registrants, p)
		}
	}
	
	if len(registrants) <= winnerCount {
		for _, p := range registrants {
			p.Status = "winner"
			p.Allocation = launch.MaxAllocation
		}
	} else {
		for i, p := range registrants {
			if i < winnerCount {
				p.Status = "winner"
				p.Allocation = launch.MaxAllocation
			} else {
				p.Status = "loser"
			}
		}
	}
	
	return nil
}

// ============================================================================
// QUERY METHODS
// ============================================================================

func (lp *Launchpad) GetActiveLaunches(ctx context.Context) ([]*Launch, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()
	
	active := make([]*Launch, 0)
	for _, launch := range lp.launches {
		if launch.Status == StatusActive || launch.Status == StatusUpcoming {
			active = append(active, launch)
		}
	}
	
	return active, nil
}

func (lp *Launchpad) GetLaunch(ctx context.Context, launchID string) (*Launch, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()
	
	launch, ok := lp.launches[launchID]
	if !ok {
		return nil, fmt.Errorf("launch not found")
	}
	
	return launch, nil
}

func (lp *Launchpad) GetUserAllocation(ctx context.Context, userID, launchID string) (*TokenAllocation, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()
	
	if allocation, ok := lp.allocations[launchID][userID]; ok {
		return allocation, nil
	}
	
	return nil, fmt.Errorf("no allocation found")
}

func (lp *Launchpad) GetProjects(ctx context.Context) ([]*ProjectInfo, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()
	
	projects := make([]*ProjectInfo, 0)
	for _, p := range lp.projects {
		projects = append(projects, p)
	}
	
	return projects, nil
}

func (lp *Launchpad) SubmitProject(ctx context.Context, project *ProjectInfo) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	if project.Name == "" || project.TokenSymbol == "" {
		return fmt.Errorf("name and token symbol required")
	}
	
	project.StartedAt = time.Now()
	lp.projects[project.OwnerID] = project
	
	return nil
}

func (lp *Launchpad) UpdateProjectStatus(ctx context.Context, ownerID string, kyced, verified, audited bool) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	
	project, ok := lp.projects[ownerID]
	if !ok {
		return fmt.Errorf("project not found")
	}
	
	project.KYCPassed = kyced
	project.Verified = verified
	project.AuditPassed = audited
	
	return nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateLaunchID() string {
	return fmt.Sprintf("LNCH%x", time.Now().UnixNano())
}

func generateParticipantID() string {
	return fmt.Sprintf("PART%x", time.Now().UnixNano())
}

var _ = fmt.Sprint
var _ = math.MaxFloat64

func init() {}

var (
	_ context.Context
	_ time.Time
)