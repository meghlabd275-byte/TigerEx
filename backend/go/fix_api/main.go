// TigerEx FIX API Gateway - Institutional Trading
// Go-based FIX Protocol 4.4/5.0 SP2 implementation

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// FIX PROTOCOL CONSTANTS
// ============================================================================

const (
	// FIX Versions
	FIX44 = "FIX.4.4"
	FIX50 = "FIX.5.0"
	FIX50SP1 = "FIX.5.0 SP1"
	FIX50SP2 = "FIX.5.0 SP2"

	// MsgTypes
	MsgTypeHeartbeat        = "0"
	MsgTypeTestRequest      = "1"
	MsgTypeResendRequest    = "2"
	MsgTypeReject           = "3"
	MsgTypeSequenceReset    = "4"
	MsgTypeLogout           = "5"
	MsgTypeIOI             = "6"
	MsgTypeAdvertisement    = "7"
	MsgTypeExecutionReport  = "8"
	MsgTypeOrderCancelReject = "9"
	MsgTypeLogon            = "A"
	MsgTypeNewOrderSingle   = "D"
	MsgTypeOrderCancelRequest = "F"
	MsgTypeOrderCancelReplaceRequest = "G"
	MsgTypeOrderStatusRequest = "H"
	MsgTypeTradeCaptureReportRequest = "AD"
	MsgTypeTradeCaptureReport = "AE"

	// Tags
	TagBeginString        = 8
	TagBodyLength        = 9
	TagMsgType           = 35
	TagSenderCompID       = 49
	TagTargetCompID       = 56
	TagOnBehalfOfCompID  = 115
	TagDeliverToCompID   = 128
	TagSecureDataLen     = 90
	TagSecureData        = 91
	TagMsgSeqNum         = 34
	TagPossDupFlag       = 43
	TagSendingTime       = 52
	TagOrigSendingTime   = 122
	TagLastMsgSeqNumProcessed = 369

	// Order Side
	SideBuy    = "1"
	SideSell   = "2"
	SideBuyEx   = "3"
	SideSellEx  = "4"

	// Order Type
	OrderTypeMarket      = "1"
	OrderTypeLimit       = "2"
	OrderTypeStop        = "3"
	OrderTypeStopLimit   = "4"
	OrderTypeMarketOnClose = "5"
	OrderTypeLimitOnClose = "6"

	// TimeInForce
	TimeInForceDay         = "0"
	TimeInForceGTC          = "1"
	TimeInForceIOC          = "3"
	TimeInForceFOK          = "4"
	TimeInForceGTX          = "5"

	// OrdStatus
	OrdStatusNew           = "0"
	OrdStatusPartialFill   = "1"
	OrdStatusFilled        = "2"
	OrdStatusDoneForDay    = "3"
	OrdStatusCancelled     = "4"
	OrdStatusPendingCancel  = "6"
	OrdStatusRejected      = "8"
	OrdStatusPendingNew    = "A"
	OrdStatusAccepted      = "B"

	// ExecType
	ExecTypeNew             = "0"
	ExecTypePartialFill     = "1"
	ExecTypeFilled          = "2"
	ExecTypeDoneForDay      = "3"
	ExecTypeCanceled        = "4"
	ExecTypeReplace         = "5"
	ExecTypeRejected        = "8"
	ExecTypePendingNew      = "A"

	// ExecRestatementReason
	RestateGov              = "0"
	RestateCorpAct          = "1"
	RestatePrice            = "2"
	RestateQty              = "3"
	RestateStp             = "4"
	RestateYelden          = "5"
)

// ============================================================================
// FIX MESSAGE STRUCTURES
// ============================================================================

type FIXMessage struct {
	BeginString    string            `fix:"8"`
	BodyLength     int               `fix:"9"`
	MsgType        string            `fix:"35"`
	SenderCompID   string            `fix:"49"`
	TargetCompID   string            `fix:"56"`
	MsgSeqNum      int               `fix:"34"`
	SendingTime    time.Time         `fix:"52"`
	RawDataLength int               `fix:"95"`
	RawData       string            `fix:"96"`
	CheckSum      string            `fix:"10"`

	// Standard fields
	ClOrdID         string  `fix:"11"`
	OrderID        string  `fix:"37"`
	OrigClOrdID     string  `fix:"41"`
	ExecID         string  `fix:"17"`
	ExecRefID      string  `fix:"19"`
	ExecTransType   string  `fix:"20"`
	ExecType       string  `fix:"150"`
	OrdStatus      string  `fix:"39"`
	Side           string  `fix:"54"`
	OrderQty       float64 `fix:"38"`
	Price          float64 `fix:"44"`
	StopPrice      float64 `fix:"99"`
	LeavesQty      float64 `fix:"151"`
	CumQty         float64 `fix:"14"`
	AvgPx          float64 `fix:"6"`
	LastQty        float64 `fix:"32"`
	LastPx         float64 `fix:"31"`
	Symbol         string  `fix:"55"`
	SecurityID     string  `fix:"48"`
	TimeInForce    string  `fix:"59"`
	OrdType        string  `fix:"40"`
	OrdRejReason   string  `fix:"103"`
	Text           string  `fix:"58"`
	
	// Additional fields
	TransactTime time.Time `fix:"60"`
	TradeDate    string  `fix:"75"`
	TradeTime    string  `fix:"165"`
	MaturityMonth string `fix:"200"`
	MaturityDay   string `fix:"205"`
	PutOrCall    string `fix:"201"`
	StrikePrice  float64 `fix:"202"`
	OptAttribute string `fix:"206"`
	
	// Margin
	MarginRatio  float64 `fix:"230"`
	MarginAmt    float64 `fix:"231"`
	
	// Position
	PosReqID     string  `fix:"710"`
	PosMaintRptID string `fix:"721"`
	PositionQty  float64 `fix:"702"`
	PositionAmt  float64 `fix:"753"`
	
	// Account
	Account      string `fix:"1"`
	AcctIDSource string `fix:"660"`
	
	// Commission
	Commission   float64 `fix:"12"`
	CommType     string `fix:"13"`
	ExecBroker   string `fix:"76"`
	
	// Fields for routing
	RoutingID    string `fix:"216"`
	RoutingInst string `fix:"217"`
	
	// Custom fields (for extension)
	CustomFields map[string]string
}

// FIX Session
type FIXSession struct {
	SessionID         string
	FIXVersion        string
	SenderCompID       string
	TargetCompID      string
	HeartBtInt         int
	NextMsgSeqNum      int
	NextExpectedSeqNum int
	LastReceivedSeqNum  int
	IsLoggedOn         bool
	Username           string
	Password           string
	IsInitiator        bool
	Timestamps         time.Time
	StartTime          time.Time
	EndTime            time.Time
	InMsgs             uint64
	OutMsgs            uint64
	InBytes            uint64
	OutBytes           uint64
}

// FIX Server
type FIXServer struct {
	Sessions    map[string]*FIXSession
	SessionsMu  sync.RWMutex
	MsgCounter uint64
	StartTime  time.Time
}

// ============================================================================
// FIX MESSAGE PARSING & GENERATION
// ============================================================================

// Parse FIX message from raw string
func ParseFIXMessage(data string) (*FIXMessage, error) {
	// Remove SOH characters and split
	fields := strings.Split(data, "\x01")
	
	msg := &FIXMessage{
		CustomFields: make(map[string]string),
	}

	for _, field := range fields {
		if len(field) < 3 {
			continue
		}

		tagStr := field[:strings.Index(field, "=")]
		value := field[strings.Index(field, "=")+1:]
		
		tag, err := strconv.Atoi(tagStr)
		if err != nil {
			continue
		}

		switch tag {
		case TagBeginString:
			msg.BeginString = value
		case TagBodyLength:
			msg.BodyLength, _ = strconv.Atoi(value)
		case TagMsgType:
			msg.MsgType = value
		case TagSenderCompID:
			msg.SenderCompID = value
		case TagTargetCompID:
			msg.TargetCompID = value
		case TagMsgSeqNum:
			msg.MsgSeqNum, _ = strconv.Atoi(value)
		case 11:
			msg.ClOrdID = value
		case 37:
			msg.OrderID = value
		case 54:
			msg.Side = value
		case 38:
			msg.OrderQty, _ = strconv.ParseFloat(value, 64)
		case 44:
			msg.Price, _ = strconv.ParseFloat(value, 64)
		case 55:
			msg.Symbol = value
		case 59:
			msg.TimeInForce = value
		case 40:
			msg.OrdType = value
		case 39:
			msg.OrdStatus = value
		case 150:
			msg.ExecType = value
		case 14:
			msg.CumQty, _ = strconv.ParseFloat(value, 64)
		case 151:
			msg.LeavesQty, _ = strconv.ParseFloat(value, 64)
		case 6:
			msg.AvgPx, _ = strconv.ParseFloat(value, 64)
		case 1:
			msg.Account = value
		default:
			msg.CustomFields[tagStr] = value
		}
	}

	return msg, nil
}

// Generate FIX message to string
func (msg *FIXMessage) ToString() string {
	var fields []string

	// Add required header fields
	if msg.BeginString != "" {
		fields = append(fields, fmt.Sprintf("8=%s", msg.BeginString))
	}
	fields = append(fields, fmt.Sprintf("9=%d", 0)) // Body length placeholder
	
	fields = append(fields, fmt.Sprintf("35=%s", msg.MsgType))
	fields = append(fields, fmt.Sprintf("49=%s", msg.SenderCompID))
	fields = append(fields, fmt.Sprintf("56=%s", msg.TargetCompID))
	fields = append(fields, fmt.Sprintf("34=%d", msg.MsgSeqNum))
	fields = append(fields, fmt.Sprintf("52=%s", msg.SendingTime.Format("20060102-15:04:05")))

	// Add body fields
	if msg.ClOrdID != "" {
		fields = append(fields, fmt.Sprintf("11=%s", msg.ClOrdID))
	}
	if msg.OrderID != "" {
		fields = append(fields, fmt.Sprintf("37=%s", msg.OrderID))
	}
	if msg.Symbol != "" {
		fields = append(fields, fmt.Sprintf("55=%s", msg.Symbol))
	}
	if msg.Side != "" {
		fields = append(fields, fmt.Sprintf("54=%s", msg.Side))
	}
	if msg.OrderQty > 0 {
		fields = append(fields, fmt.Sprintf("38=%.8f", msg.OrderQty))
	}
	if msg.Price > 0 {
		fields = append(fields, fmt.Sprintf("44=%.8f", msg.Price))
	}
	if msg.StopPrice > 0 {
		fields = append(fields, fmt.Sprintf("99=%.8f", msg.StopPrice))
	}
	if msg.TimeInForce != "" {
		fields = append(fields, fmt.Sprintf("59=%s", msg.TimeInForce))
	}
	if msg.OrdType != "" {
		fields = append(fields, fmt.Sprintf("40=%s", msg.OrdType))
	}
	if msg.OrdStatus != "" {
		fields = append(fields, fmt.Sprintf("39=%s", msg.OrdStatus))
	}
	if msg.ExecType != "" {
		fields = append(fields, fmt.Sprintf("150=%s", msg.ExecType))
	}
	if msg.ExecID != "" {
		fields = append(fields, fmt.Sprintf("17=%s", msg.ExecID))
	}
	if msg.Account != "" {
		fields = append(fields, fmt.Sprintf("1=%s", msg.Account))
	}
	if msg.CumQty > 0 {
		fields = append(fields, fmt.Sprintf("14=%.8f", msg.CumQty))
	}
	if msg.LeavesQty > 0 {
		fields = append(fields, fmt.Sprintf("151=%.8f", msg.LeavesQty))
	}
	if msg.AvgPx > 0 {
		fields = append(fields, fmt.Sprintf("6=%.8f", msg.AvgPx))
	}
	if msg.Text != "" {
		fields = append(fields, fmt.Sprintf("58=%s", msg.Text))
	}

	// Calculate body length (after tag 9)
	body := strings.Join(fields[2:], "\x01")
	bodyLength := len(body)

	// Update body length
	fields[1] = fmt.Sprintf("9=%d", bodyLength)

	// Calculate checksum
	checksum := calculateChecksum(strings.Join(fields, "\x01") + "\x01")
	fields = append(fields, fmt.Sprintf("10=%s", checksum))

	return strings.Join(fields, "\x01") + "\x01"
}

// Calculate FIX checksum
func calculateChecksum(data string) string {
	hash := sha256.Sum256([]byte(data))
	sum := 0
	for _, b := range hash {
		sum += int(b)
	}
	return fmt.Sprintf("%03d", sum%256)
}

// ============================================================================
// FIX SESSION MANAGEMENT
// ============================================================================

func NewFIXServer() *FIXServer {
	return &FIXServer{
		Sessions: make(map[string]*FIXSession),
		StartTime: time.Now(),
	}
}

func (s *FIXServer) CreateSession(fixVersion, sender, target, username, password string, heartBtInt int) *FIXSession {
	session := &FIXSession{
		SessionID:       fmt.Sprintf("%s->%s", sender, target),
		FIXVersion:      fixVersion,
		SenderCompID:    sender,
		TargetCompID:    target,
		HeartBtInt:     heartBtInt,
		NextMsgSeqNum:  1,
		Username:        username,
		Password:        password,
		IsInitiator:     true,
		Timestamps:      time.Now(),
		StartTime:      time.Now(),
	}

	s.SessionsMu.Lock()
	s.Sessions[session.SessionID] = session
	s.SessionsMu.Unlock()

	return session
}

// Handle logon
func (s *FIXServer) HandleLogon(session *FIXSession, msg *FIXMessage) (*FIXMessage, error) {
	// Validate credentials
	if session.Password != "" && msg.CustomFields["96"] != session.Password {
		return s.CreateReject(msg, "Invalid credentials", 1), nil
	}

	session.IsLoggedOn = true
	session.NextMsgSeqNum = 1

	// Create logon response
	resp := &FIXMessage{
		BeginString:   session.FIXVersion,
		MsgType:       MsgTypeLogon,
		SenderCompID:  session.TargetCompID,
		TargetCompID:  session.SenderCompID,
		MsgSeqNum:    1,
		SendingTime:   time.Now(),
	}

	return resp, nil
}

// Handle new order single
func (s *FIXServer) HandleNewOrder(session *FIXSession, msg *FIXMessage) (*FIXMessage, error) {
	if !session.IsLoggedOn {
		return s.CreateReject(msg, "Not logged on", 1), nil
	}

	// Generate order ID
	orderID := fmt.Sprintf("ORD-%d-%d", time.Now().Unix(), atomic.AddUint64(&s.MsgCounter, 1))

	// Validate required fields
	if msg.Symbol == "" {
		return s.CreateReject(msg, "Missing symbol", 1), nil
	}
	if msg.Side == "" {
		return s.CreateReject(msg, "Missing side", 1), nil
	}
	if msg.OrderQty <= 0 {
		return s.CreateReject(msg, "Invalid quantity", 1), nil
	}

	// Create execution report (New)
	execReport := &FIXMessage{
		BeginString:   session.FIXVersion,
		MsgType:       MsgTypeExecutionReport,
		SenderCompID:  session.TargetCompID,
		TargetCompID:  session.SenderCompID,
		MsgSeqNum:     atomic.AddUint64(&s.MsgCounter, 1),
		SendingTime:    time.Now(),
		OrderID:       orderID,
		ClOrdID:       msg.ClOrdID,
		ExecID:        fmt.Sprintf("EXEC-%d", time.Now().UnixNano()),
		ExecType:       ExecTypeNew,
		OrdStatus:      OrdStatusNew,
		Side:          msg.Side,
		OrderQty:       msg.OrderQty,
		Price:         msg.Price,
		Symbol:        msg.Symbol,
		TimeInForce:    msg.TimeInForce,
		OrdType:        msg.OrdType,
		LeavesQty:      msg.OrderQty,
		CumQty:         0,
		AvgPx:          0,
	}

	return execReport, nil
}

// Handle order cancel request
func (s *FIXServer) HandleOrderCancel(session *FIXSession, msg *FIXMessage) (*FIXMessage, error) {
	if !session.IsLoggedOn {
		return s.CreateReject(msg, "Not logged on", 1), nil
	}

	// Create cancel reject (assuming success for demo)
	cancelReject := &FIXMessage{
		BeginString:   session.FIXVersion,
		MsgType:       MsgTypeOrderCancelReject,
		SenderCompID:  session.TargetCompID,
		TargetCompID:  session.SenderCompID,
		MsgSeqNum:     atomic.AddUint64(&s.MsgCounter, 1),
		SendingTime:    time.Now(),
		OrderID:       msg.CustomFields["37"],
		ClOrdID:       msg.CustomFields["41"],
		OrigClOrdID:   msg.ClOrdID,
		OrdStatus:     OrdStatusCanceled,
	}

	return cancelReject, nil
}

// Handle order status request
func (s *FIXServer) HandleOrderStatus(session *FIXSession, msg *FIXMessage) (*FIXMessage, error) {
	if !session.IsLoggedOn {
		return s.CreateReject(msg, "Not logged on", 1), nil
	}

	// Create execution report with current status
	execReport := &FIXMessage{
		BeginString:   session.FIXVersion,
		MsgType:       MsgTypeExecutionReport,
		SenderCompID:  session.TargetCompID,
		TargetCompID:  session.SenderCompID,
		MsgSeqNum:     atomic.AddUint64(&s.MsgCounter, 1),
		SendingTime:    time.Now(),
		OrderID:       msg.CustomFields["37"],
		ClOrdID:       msg.ClOrdID,
		ExecID:        fmt.Sprintf("EXEC-%d", time.Now().UnixNano()),
		ExecType:       ExecTypeNew,
		OrdStatus:      OrdStatusNew,
		Side:           msg.Side,
		OrderQty:       1.0,
		LeavesQty:      1.0,
		CumQty:         0,
		AvgPx:          0,
	}

	return execReport, nil
}

// Create reject message
func (s *FIXServer) CreateReject(msg *FIXMessage, text string, code int) *FIXMessage {
	return &FIXMessage{
		BeginString: FIX44,
		MsgType:    MsgTypeReject,
		Text:      fmt.Sprintf("%s (Code: %d)", text, code),
		RefSeqNum: int64(msg.MsgSeqNum),
	}
}

// ============================================================================
// TCP FIX SERVER
// ============================================================================

type FIXTCPHandler struct {
	Server     *FIXServer
	Session    *FIXSession
	Conn       net.Conn
	ReadChan   chan []byte
	WriteChan  chan string
	DoneChan   chan bool
}

func (h *FIXTCPHandler) Start() {
	go h.readLoop()
	go h.writeLoop()
	go h.heartbeatLoop()
	
	<-h.DoneChan
}

func (h *FIXTCPHandler) readLoop() {
	buf := make([]byte, 8192)
	
	for {
		n, err := h.Conn.Read(buf)
		if err != nil {
			h.Session.IsLoggedOn = false
			h.DoneChan <- true
			return
		}

		data := string(buf[:n])
		h.ReadChan <- []byte(data)
	}
}

func (h *FIXTCPHandler) writeLoop() {
	for {
		select {
		case msg := <-h.WriteChan:
			_, err := h.Conn.Write([]byte(msg))
			if err != nil {
				h.DoneChan <- true
				return
			}
		}
	}
}

func (h *FIXTCPHandler) heartbeatLoop() {
	ticker := time.NewTicker(time.Duration(h.Session.HeartBtInt) * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			heartbeat := &FIXMessage{
				BeginString:   h.Session.FIXVersion,
				MsgType:       MsgTypeHeartbeat,
				SenderCompID:  h.Session.TargetCompID,
				TargetCompID:  h.Session.SenderCompID,
				MsgSeqNum:     atomic.AddUint64(&h.Server.MsgCounter, 1),
				SendingTime:   time.Now(),
			}
			h.WriteChan <- heartbeat.ToString()
		case msg := <-h.ReadChan:
			h.handleMessage(string(msg))
		}
	}
}

func (h *FIXTCPHandler) handleMessage(data string) {
	msg, err := ParseFIXMessage(data)
	if err != nil {
		return
	}

	var response *FIXMessage

	switch msg.MsgType {
	case MsgTypeLogon:
		response, _ = h.Server.HandleLogon(h.Session, msg)
	case MsgTypeNewOrderSingle:
		response, _ = h.Server.HandleNewOrder(h.Session, msg)
	case MsgTypeOrderCancelRequest:
		response, _ = h.Server.HandleOrderCancel(h.Session, msg)
	case MsgTypeOrderStatusRequest:
		response, _ = h.Server.HandleOrderStatus(h.Session, msg)
	case MsgTypeHeartbeat:
		// Respond to heartbeat
		response = &FIXMessage{
			BeginString:   h.Session.FIXVersion,
			MsgType:       MsgTypeHeartbeat,
			SenderCompID:  h.Session.TargetCompID,
			TargetCompID:  h.Session.SenderCompID,
			MsgSeqNum:     atomic.AddUint64(&h.Server.MsgCounter, 1),
			SendingTime:   time.Now(),
		}
	case MsgTypeTestRequest:
		response = &FIXMessage{
			BeginString:   h.Session.FIXVersion,
			MsgType:       MsgTypeHeartbeat,
			SenderCompID:  h.Session.TargetCompID,
			TargetCompID:  h.Session.SenderCompID,
			MsgSeqNum:     atomic.AddUint64(&h.Server.MsgCounter, 1),
			SendingTime:   time.Now(),
		}
	}

	if response != nil {
		h.WriteChan <- response.ToString()
	}
}

// ============================================================================
// REST API FOR FIX SESSION MANAGEMENT
// ============================================================================

func setupFIXAPIRoutes(r *gin.Engine, server *FIXServer) {
	fix := r.Group("/api/v1/fix")
	{
		// Create session
		fix.POST("/session", func(c *gin.Context) {
			var req struct {
				FIXVersion string `json:"fixVersion"`
				Sender     string `json:"senderCompID"`
				Target    string `json:"targetCompID"`
				Username  string `json:"username"`
				Password  string `json:"password"`
				HeartBtInt int    `json:"heartBtInt"`
			}
			
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}

			session := server.CreateSession(
				req.FIXVersion,
				req.Sender,
				req.Target,
				req.Username,
				req.Password,
				req.HeartBtInt,
			)

			c.JSON(200, gin.H{
				"sessionID":    session.SessionID,
				"fixVersion":   session.FIXVersion,
				"heartBtInt":   session.HeartBtInt,
			})
		})

		// Get session info
		fix.GET("/session/:id", func(c *gin.Context) {
			id := c.Param("id")
			
			server.SessionsMu.RLock()
			session, exists := server.Sessions[id]
			server.SessionsMu.RUnlock()

			if !exists {
				c.JSON(404, gin.H{"error": "Session not found"})
				return
			}

			c.JSON(200, gin.H{
				"sessionID":       session.SessionID,
				"fixVersion":     session.FIXVersion,
				"isLoggedOn":     session.IsLoggedOn,
				"msgSeqNum":      session.NextMsgSeqNum,
				"inMsgs":         session.InMsgs,
				"outMsgs":        session.OutMsgs,
			})
		})

		// Get server stats
		fix.GET("/stats", func(c *gin.Context) {
			server.SessionsMu.RLock()
			activeSessions := 0
			for _, s := range server.Sessions {
				if s.IsLoggedOn {
					activeSessions++
				}
			}
			server.SessionsMu.RUnlock()

			c.JSON(200, gin.H{
				"uptime":         time.Since(server.StartTime).String(),
				"totalSessions":  len(server.Sessions),
				"activeSessions": activeSessions,
				"totalMsgs":      server.MsgCounter,
			})
		})
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx FIX API Gateway v1.0.0")
	
	server := NewFIXServer()
	
	// Setup HTTP server with Gin
	r := gin.Default()
	setupFIXAPIRoutes(r, server)
	
	// Start TCP FIX server on port 8900
	go func() {
		ln, err := net.Listen("tcp", ":8900")
		if err != nil {
			fmt.Printf("FIX TCP server error: %v\n", err)
			return
		}
		
		fmt.Println("FIX TCP server listening on :8900")
		
		for {
			conn, err := ln.Accept()
			if err != nil {
				continue
			}
			
			// Create default session for demo
			session := server.CreateSession(FIX44, "TIGEREX", "CLIENT1", "demo", "demo", 30)
			
			handler := &FIXTCPHandler{
				Server:    server,
				Session:   session,
				Conn:      conn,
				ReadChan:  make(chan []byte, 100),
				WriteChan: make(chan string, 100),
				DoneChan:  make(chan bool),
			}
			
			go handler.Start()
		}
	}()
	
	// Start HTTP server
	fmt.Println("REST API listening on :8445")
	r.Run(":8445")
}