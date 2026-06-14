package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// FIX PROTOCOL IMPLEMENTATION
// Financial Information eXchange Protocol - Industry Standard for Institutional Trading
// High-performance, low-latency FIX engine in Go
// ============================================================================

// ============================================================================
// FIX MESSAGE TYPES
// ============================================================================

// MsgType represents FIX message types
type MsgType string

const (
	MsgTypeHeartbeat              MsgType = "0"
	MsgTypeTestRequest          MsgType = "1"
	MsgTypeResendRequest       MsgType = "2"
	MsgTypeReject           MsgType = "3"
	MsgTypeSequenceReset     MsgType = "4"
	MsgTypeLogout          MsgType = "5"
	MsgTypeIOI             MsgType = "6"
	MsgTypeAck             MsgType = "7"
	MsgTypeExecReport       MsgType = "8"
	MsgTypeOrderStatusReq  MsgType = "H"
	MsgTypeOrder          MsgType = "D"
	MsgTypeOrderCancel    MsgType = "F"
	MsgTypeOrderCancelReplace MsgType = "G"
	MsgTypeOrderStatus    MsgType = "I"
	MsgTypeBusinessReject  MsgType = "j"
)

// Side represents order side
type Side string

const (
	SideBuy   Side = "1"
	SideSell  Side = "2"
	SideSellShort Side = "5"
)

// OrdType represents order type
type OrdType string

const (
	OrdTypeMarket      OrdType = "1"
	OrdTypeLimit     OrdType = "2"
	OrdTypeStop      OrdType = "3"
	OrdTypeStopLimit  OrdType = "4"
	OrdTypeWithOrWithout OrdType = "5"
	OrdTypeLimitClose OrdType = "G"
)

// TimeInForce represents time in force
type TimeInForce string

const (
	TIFDay           TimeInForce = "0"
	TIFGTC          TimeInForce = "1"
	TIFIOC          TimeInForce = "3"
	TIFFOK          TimeInForce = "4"
	TIFGTX          TimeInForce = "7"
)

// ExecType represents execution type
type ExecType string

const (
	ExecNew             ExecType = "0"
	ExecPartialFill     ExecType = "1"
	ExecFilled        ExecType = "2"
	ExecDoneForDay   ExecType = "3"
	ExecCanceled     ExecType = "4"
	ExecReplaced     ExecType = "5"
	ExecPendingCancel ExecType = "6"
	ExecStopped      ExecType = "7"
	ExecRejected    ExecType = "8"
	ExecSuspended   ExecType = "9"
	ExecPendingNew  ExecType = "A"
	ExecPendingReplace ExecType = "E"
	ExecTrade       ExecType = "F"
	ExecTradeCancel  ExecType = "G"
	ExecOrderStatus ExecType = "I"
)

// OrdStatus represents order status
type OrdStatus string

const (
	OrdStatusNew             OrdStatus = "0"
	OrdStatusPartialFill     OrdStatus = "1"
	OrdStatusFilled        OrdStatus = "2"
	OrdStatusDoneForDay   OrdStatus = "3"
	OrdStatusCanceled     OrdStatus = "4"
	OrdStatusReplaced     OrdStatus = "5"
	OrdStatusPendingCancel OrdStatus = "6"
	OrdStatusStopped      OrdStatus = "7"
	OrdStatusRejected    OrdStatus = "8"
	OrdStatusSuspended   OrdStatus = "9"
)

// ============================================================================
// FIX MESSAGE STRUCTURE
// ============================================================================

// Field represents a FIX tag-value pair
type Field struct {
	Tag    int
	Value  string
}

// Message represents a FIX message
type Message struct {
	MsgType   MsgType
	Fields   map[int]string
	Body     string
	Checksum int
}

// NewMessage creates a new FIX message
func NewMessage(msgType MsgType) *Message {
	return &Message{
		MsgType: msgType,
		Fields:  make(map[int]string),
	}
}

// AddField adds a field to the message
func (m *Message) AddField(tag int, value string) {
	m.Fields[tag] = value
}

// GetField gets a field from the message
func (m *Message) GetField(tag int) string {
	return m.Fields[tag]
}

// ToString serializes the message to FIX format
func (m *Message) ToString() string {
	var fields []string
	
	// Add MsgType first (35)
	if m.MsgType != "" {
		fields = append(fields, fmt.Sprintf("35=%s", m.MsgType))
	}
	
	// Add timestamp (52)
	fields = append(fields, fmt.Sprintf("52=%s", time.Now().UTC().Format("20060102-15:04:05")))
	
	// Add all fields
	for tag, value := range m.Fields {
		fields = append(fields, fmt.Sprintf("%d=%s", tag, value))
	}
	
	// Build body
	body := strings.Join(fields, "\x01")
	
	// Calculate checksum (10)
	checksum := calculateChecksum(body)
	fields = append(fields, fmt.Sprintf("10=%03d", checksum))
	
	return strings.Join(fields, "\x01") + "\x01"
}

// Parse parses a FIX message from string
func ParseMessage(data string) (*Message, error) {
	reader := strings.NewReader(data)
	fields := make(map[int]string)
	
	scanner := bufio.NewScanner(reader)
	scanner.Split(func(data []byte, eof bool) (int, []byte, error) {
		if eof {
			return 0, nil, nil
		}
		for i := 0; i < len(data); i++ {
			if data[i] == 0x01 {
				return i + 1, data[:i+1], nil
			}
		}
		return 0, nil, nil
	})
	
	for scanner.Scan() {
		field := scanner.Text()
		if field == "" || field == "\x01" {
			continue
		}
		
		parts := strings.SplitN(field, "=", 2)
		if len(parts) != 2 {
			continue
		}
		
		var tag int
		fmt.Sscanf(parts[0], "%d", &tag)
		fields[tag] = parts[1]
	}
	
	msgType := MsgType(fields[35])
	return &Message{
		MsgType: msgType,
		Fields:  fields,
		Body:   data,
	}, nil
}

// ============================================================================
// FIX SESSION
// ============================================================================

// Session represents a FIX connection session
type Session struct {
	ID            string
	TargetCompID  string
	SenderCompID  string
	HeartBtInt   int
	Reconnect   int
	MaxDropped  int
	
	// Sequence numbers
	OutSeqNum    int64
	InSeqNum     int64
	
	// Connection
	conn        net.Conn
	reader      *bufio.Reader
	writer      *bufio.Writer
	
	// State
	Connected   bool
	LoggedIn   bool
	LastMsgTime time.Time
	
	// Synchronization
	mu          sync.RWMutex
	pendingAcks map[int64]*Message
	
	// Callbacks
	OnMessage func(*Message) error
	OnError   func(error)
}

// NewSession creates a new FIX session
func NewSession(senderCompID, targetCompID string) *Session {
	return &Session{
		ID:           fmt.Sprintf("%s-%s-%d", senderCompID, targetCompID, time.Now().Unix()),
		SenderCompID:  senderCompID,
		TargetCompID: targetCompID,
		HeartBtInt:  30,
		Reconnect:   5,
		MaxDropped: 3,
		
		OutSeqNum:   1,
		InSeqNum:   0,
		
		Connected: false,
		LoggedIn: false,
		
		pendingAcks: make(map[int64]*Message),
	}
}

// Connect establishes connection to FIX server
func (s *Session) Connect(addr string) error {
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return err
	}
	
	s.conn = conn
	s.reader = bufio.NewReader(conn)
	s.writer = bufio.NewWriter(conn)
	s.Connected = true
	s.LastMsgTime = time.Now()
	
	go s.readLoop()
	
	return nil
}

// Disconnect closes the connection
func (s *Session) Disconnect() error {
	if s.conn != nil {
		s.logout()
		return s.conn.Close()
	}
	return nil
}

// Send sends a FIX message
func (s *Session) Send(msg *Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Add sequence number
	msg.AddField(34, fmt.Sprintf("%d", s.OutSeqNum))
	s.OutSeqNum++
	
	// Add sender/target
	msg.AddField(49, s.SenderCompID)
	msg.AddField(56, s.TargetCompID)
	
	data := msg.ToString()
	_, err := s.writer.WriteString(data)
	if err != nil {
		return err
	}
	
	err = s.writer.Flush()
	if err != nil {
		return err
	}
	
	s.LastMsgTime = time.Now()
	return nil
}

// SendOrder sends a new order
func (s *Session) SendOrder(order *Order) (*Message, error) {
	msg := NewMessage(MsgTypeOrder)
	msg.AddField(11, order.ClientID)
	msg.AddField(55, order.Symbol)
	msg.AddField(54, string(order.Side))
	msg.AddField(60, time.Now().UTC().Format("20060102-15:04:05"))
	msg.AddField(38, fmt.Sprintf("%.f", order.Quantity))
	msg.AddField(40, string(order.OrdType))
	
	if order.Price > 0 {
		msg.AddField(44, fmt.Sprintf("%.8f", order.Price))
	}
	
	if order.StopPrice > 0 {
		msg.AddField(99, fmt.Sprintf("%.8f", order.StopPrice))
	}
	
	msg.AddField(59, string(order.TimeInForce))
	
	err := s.Send(msg)
	return msg, err
}

// SendCancel sends an order cancel request
func (s *Session) SendCancel(cancel *OrderCancel) (*Message, error) {
	msg := NewMessage(MsgTypeOrderCancel)
	msg.AddField(11, cancel.ClientID)
	msg.AddField(37, cancel.OrderID)
	msg.AddField(55, cancel.Symbol)
	msg.AddField(54, string(cancel.Side))
	msg.AddField(38, fmt.Sprintf("%.f", cancel.Quantity))
	msg.AddField(60, time.Now().UTC().Format("20060102-15:04:05"))
	
	err := s.Send(msg)
	return msg, err
}

// SendStatusRequest sends order status request
func (s *Session) SendStatusRequest(orderID, clientID string) (*Message, error) {
	msg := NewMessage(MsgTypeOrderStatusReq)
	msg.AddField(37, orderID)
	msg.AddField(11, clientID)
	
	err := s.Send(msg)
	return msg, err
}

// readLoop reads messages in background
func (s *Session) readLoop() {
	for {
		data, err := s.reader.ReadString('\x01')
		if err != nil {
			if err != io.EOF {
				s.OnError(err)
			}
			s.Connected = false
			return
		}
		
		msg, err := ParseMessage(data)
		if err != nil {
			s.OnError(err)
			continue
		}
		
		// Handle based on message type
		switch msg.MsgType {
		case MsgTypeHeartbeat:
			s.handleHeartbeat(msg)
		case MsgTypeTestRequest:
			s.handleTestRequest(msg)
		case MsgTypeLogout:
			s.handleLogout(msg)
		case MsgTypeExecReport, MsgTypeAck:
			s.handleExecution(msg)
		}
		
		if s.OnMessage != nil {
			s.OnMessage(msg)
		}
	}
}

func (s *Session) handleHeartbeat(msg *Message) {
	// Respond with heartbeat
	reply := NewMessage(MsgTypeHeartbeat)
	s.Send(reply)
}

func (s *Session) handleTestRequest(msg *Message) {
	// Respond with heartbeat containing test request ID
	reply := NewMessage(MsgTypeHeartbeat)
	testReqID := msg.GetField(112)
	if testReqID != "" {
		reply.AddField(112, testReqID)
	}
	s.Send(reply)
}

func (s *Session) handleLogout(msg *Message) {
	s.LoggedIn = false
	s.Connected = false
}

func (s *Session) handleExecution(msg *Message) {
	// Handle execution report
}

func (s *Session) login() error {
	msg := NewMessage(MsgType("A")) // Logon
	msg.AddField(98, "2")       // EncryptMethod (None)
	msg.AddField(108, fmt.Sprintf("%d", s.HeartBtInt)) // HeartBtInt
	
	return s.Send(msg)
}

func (s *Session) logout() error {
	msg := NewMessage(MsgTypeLogout)
	return s.Send(msg)
}

// ============================================================================
// ORDER TYPES
// ============================================================================

// Order represents a trading order
type Order struct {
	ClientID    string
	OrderID    string
	Symbol     string
	Side       Side
	OrdType    OrdType
	Quantity   float64
	Price      float64
	StopPrice  float64
	TimeInForce TimeInForce
}

// OrderCancel represents an order cancel request
type OrderCancel struct {
	ClientID string
	OrderID string
	Symbol  string
	Side    Side
	Quantity float64
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func calculateChecksum(data string) int {
	sum := 0
	for _, c := range data {
		sum += int(c)
	}
	return sum % 256
}

// ============================================================================
// FIX ENGINE
// ============================================================================

// Engine represents the FIX engine
type Engine struct {
	sessions map[string]*Session
	orders   map[string]*Order
	
	mu sync.RWMutex
}

// NewEngine creates a new FIX engine
func NewEngine() *Engine {
	return &Engine{
		sessions: make(map[string]*Session),
		orders:   make(map[string]*Order),
	}
}

// CreateSession creates and registers a new session
func (e *Engine) CreateSession(senderCompID, targetCompID string) *Session {
	session := NewSession(senderCompID, targetCompID)
	e.sessions[session.ID] = session
	return session
}

// GetSession gets a session by ID
func (e *Engine) GetSession(id string) *Session {
	return e.sessions[id]
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	fmt.Println("TigerEx FIX API Engine v1.0.0")
	
	// Create engine
	engine := NewEngine()
	
	// Create session
	session := engine.CreateSession("TIGEREX", "CLIENT1")
	session.OnMessage = func(msg *Message) error {
		log.Printf("Received: %s", msg.MsgType)
		return nil
	}
	
	// Create order
	order := &Order{
		ClientID:    "ORD001",
		Symbol:     "BTCUSD",
		Side:       SideBuy,
		OrdType:    OrdTypeLimit,
		Quantity:   1.0,
		Price:      50000.0,
		TimeInForce: TIFGTC,
	}
	
	// Test message creation
	msg := NewMessage(MsgTypeOrder)
	msg.AddField(11, order.ClientID)
	msg.AddField(55, order.Symbol)
	msg.AddField(54, string(order.Side))
	
	fmt.Println("FIX Message:", msg.ToString())
}