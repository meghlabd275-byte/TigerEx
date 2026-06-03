// Package fix provides FIX Protocol 4.2/4.4 adapter for institutional trading.
// Supports order routing, market data, and trade capture.
package fix

import (
	"bufio"
	"context"
	"crypto/md5"
	"encoding/binary"
	"fmt"
	"math"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// FIXVersion represents FIX protocol version
type FIXVersion string

const (
	FIX42 FIXVersion = "FIX.4.2"
	FIX44 FIXVersion = "FIX.4.4"
)

// MsgType represents FIX message types
type MsgType string

const (
	MsgTypeHeartbeat          MsgType = "0"
	MsgTypeTestRequest        MsgType = "1"
	MsgTypeResendRequest      MsgType = "2"
	MsgTypeReject            MsgType = "3"
	MsgTypeSessionReset       MsgType = "4"
	MsgTypeLogon             MsgType = "A"
	MsgTypeLogout            MsgType = "5"
	MsgTypeNewOrderSingle    MsgType = "D"
	MsgTypeOrderCancelRequest MsgType = "F"
	MsgTypeOrderCancelReplace MsgType = "G"
	MsgTypeOrderStatusRequest MsgType = "H"
	MsgTypeTradeCaptureReport MsgType = "AE"
	MsgTypeTradeCaptureAck    MsgType = "AR"
	MsgTypeRequestForQuotes  MsgType = "R"
	MsgTypeQuote             MsgType = "S"
	MsgTypeMarketDataRequest MsgType = "V"
	MsgTypeMarketDataSnapshot MsgType = "W"
	MsgTypeMarketDataRequestReject MsgType = "Y"
)

// Side represents buy/sell side
type Side string

const (
	SideBuy  Side = "1"
	SideSell Side = "2"
)

// OrdType represents order type
type OrdType string

const (
	OrdTypeMarket    OrdType = "1"
	OrdTypeLimit     OrdType = "2"
	OrdTypeStop      OrdType = "3"
	OrdTypeStopLimit OrdType = "4"
)

// TimeInForce represents time in force
type TimeInForce string

const (
	TimeInForceDay      TimeInForce = "0"
	TimeInForceGTC      TimeInForce = "1"
	TimeInForceIOC      TimeInForce = "3"
	TimeInForceFOK      TimeInForce = "4"
)

// ExecType represents execution type
type ExecType string

const (
	ExecTypeNew         ExecType = "0"
	ExecTypeFill        ExecType = "1"
	ExecTypePartialFill ExecType = "2"
	ExecTypeCanceled    ExecType = "4"
	ExecTypeRejected    ExecType = "8"
	ExecTypeExpired     ExecType = "C"
)

// OrdStatus represents order status
type OrdStatus string

const (
	OrdStatusNew         OrdStatus = "0"
	OrdStatusPartial    OrdStatus = "1"
	OrdStatusFill       OrdStatus = "2"
	OrdStatusCanceled   OrdStatus = "4"
	OrdStatusRejected   OrdStatus = "8"
	OrdStatusExpired    OrdStatus = "C"
)

// FIXSession represents a FIX session
type FIXSession struct {
	SessionID     string
	Version      FIXVersion
	CompID       string // SenderCompID
	TargetCompID string // TargetCompID
	Socket      net.Conn
	Reader      *bufio.Reader
	Writer      *bufio.Writer
	OutSeqNum   int
	InSeqNum    int
	HeartbeatInterval int
	LastSent    time.Time
	LastReceived time.Time
	Connected   bool
	Authenticated bool
	mu         sync.RWMutex
	ctx        context.Context
	cancel     context.CancelFunc
}

// FIXMessage represents a FIX message
type FIXMessage struct {
	MsgType  MsgType
	Fields   map[string]string
	RawData  string
}

// FIXConfig represents FIX session configuration
type FIXConfig struct {
	Version         FIXVersion
	CompID         string
	TargetCompID   string
	Password       string
	HeartbeatInterval int
	ResetSeqNum   bool
}

// FIXAdapter provides FIX protocol interface
type FIXAdapter struct {
	mu          sync.RWMutex
	sessions    map[string]*FIXSession
	orderRouter OrderRouter
	marketData MarketDataProvider
	msgHandler MessageHandler
	encoder    *MessageEncoder
	decoder    *MessageDecoder
}

// OrderRouter routes orders to trading engine
type OrderRouter interface {
	RouteOrder(ctx context.Context, order *FIXOrder) (string, error)
	CancelOrder(ctx context.Context, orderID string) error
	ReplaceOrder(ctx context.Context, orderID string, order *FIXOrder) error
}

// MarketDataProvider provides market data
type MarketDataProvider interface {
	SubscribeMD(symbols []string) error
	UnsubscribeMD(symbols []string) error
	GetQuote(symbol string) (*FIXQuote, error)
}

// MessageHandler handles incoming FIX messages
type MessageHandler interface {
	OnNewOrder(*FIXOrder) (string, error)
	OnCancelRequest(*FIXCancelRequest) error
	OnReplaceRequest(*FIXReplaceRequest) error
}

// FIXOrder represents a FIX order
type FIXOrder struct {
	ClOrdID         string          // 11
	OrderID        string          // 37
	Symbol         string          // 55
	Side           Side            // 54
	OrderQty       decimal.Decimal // 38
	OrdType        OrdType         // 40
	Price          decimal.Decimal // 44
	StopPx         decimal.Decimal // 99
	TimeInForce    TimeInForce    // 59
	HandlInst      string          // 21
	ExpireDate     string          // 126
	Text           string          // 58
}

// FIXCancelRequest represents order cancel request
type FIXCancelRequest struct {
	OrigClOrdID   string // 41
	ClOrdID       string // 11
	OrderID       string // 37
	Symbol        string // 55
	Side          Side   // 54
}

// FIXReplaceRequest represents order replace request
type FIXReplaceRequest struct {
	OrigClOrdID   string          // 41
	ClOrdID       string          // 11
	OrderID       string          // 37
	Symbol        string          // 55
	Side          Side            // 54
	OrderQty      decimal.Decimal // 38
	OrdType       OrdType         // 40
	Price         decimal.Decimal // 44
	StopPx        decimal.Decimal // 99
	TimeInForce   TimeInForce    // 59
}

// FIXQuote represents market quote
type FIXQuote struct {
	Symbol    string
	BidPx    decimal.Decimal
	OfferPx  decimal.Decimal
	BidSize  decimal.Decimal
	OfferSize decimal.Decimal
	Timestamp time.Time
}

// FIXExecution represents execution report
type FIXExecution struct {
	OrderID       string
	ClOrdID       string
	ExecID        string
	ExecRefID     string
	ExecType      ExecType
	OrdStatus     OrdStatus
	Symbol        string
	Side          Side
	OrderQty      decimal.Decimal
	LeavesQty     decimal.Decimal
	CumQty        decimal.Decimal
	AvgPx         decimal.Decimal
	LastPx        decimal.Decimal
	LastQty       decimal.Decimal
	Text          string
	Timestamp     time.Time
}

// NewFIXAdapter creates new FIX adapter
func NewFIXAdapter() *FIXAdapter {
	return &FIXAdapter{
		sessions: make(map[string]*FIXSession),
		encoder:  NewMessageEncoder(),
		decoder:  NewMessageDecoder(),
	}
}

// Connect establishes FIX session connection
func (fa *FIXAdapter) Connect(ctx context.Context, conn net.Conn, config *FIXConfig) (*FIXSession, error) {
	session := &FIXSession{
		SessionID:     generateSessionID(),
		Version:      config.Version,
		CompID:       config.CompID,
		TargetCompID: config.TargetCompID,
		Socket:       conn,
		Reader:       bufio.NewReader(conn),
		Writer:       bufio.NewWriter(conn),
		OutSeqNum:   1,
		InSeqNum:    1,
		HeartbeatInterval: config.HeartbeatInterval,
		Connected:   true,
		ctx:        ctx,
	}

	// Send logon message
	logon := fa.buildLogon(config)
	err := fa.sendMessage(session, logon)
	if err != nil {
		return nil, err
	}

	// Expect logon response
	resp, err := fa.readMessage(session)
	if err != nil {
		return nil, err
	}

	if resp.MsgType != MsgTypeLogon {
		return nil, fmt.Errorf("unexpected message type: %s", resp.MsgType)
	}

	session.Authenticated = true

	fa.mu.Lock()
	fa.sessions[session.SessionID] = session
	fa.mu.Unlock()

	// Start message handlers
	go fa.handleSession(session)

	return session, nil
}

// Disconnect closes FIX session
func (fa *FIXAdapter) Disconnect(sessionID string) error {
	fa.mu.RLock()
	session, ok := fa.sessions[sessionID]
	fa.mu.RUnlock()

	if !ok {
		return fmt.Errorf("session not found")
	}

	if session.cancel != nil {
		session.cancel()
	}

	return session.Socket.Close()
}

// SendOrder sends a new order
func (fa *FIXAdapter) SendOrder(sessionID string, order *FIXOrder) (*FIXExecution, error) {
	session, err := fa.getSession(sessionID)
	if err != nil {
		return nil, err
	}

	msg := fa.buildNewOrderSingle(order)
	err = fa.sendMessage(session, msg)
	if err != nil {
		return nil, err
	}

	// Route to trading engine
	if fa.orderRouter != nil {
		orderID, err := fa.orderRouter.RouteOrder(session.ctx, order)
		if err != nil {
			// Send reject
			reject := fa.buildReject(order.ClOrdID, err.Error())
			fa.sendMessage(session, reject)
			return nil, err
		}
		order.OrderID = orderID
	}

	// In production: wait for execution report asynchronously
	return &FIXExecution{
		OrderID:   order.OrderID,
		ClOrdID:  order.ClOrdID,
		ExecID:   generateExecID(),
		ExecType: ExecTypeNew,
		OrdStatus: OrdStatusNew,
		Symbol:   order.Symbol,
		Side:    order.Side,
		OrderQty: order.OrderQty,
		Timestamp: time.Now(),
	}, nil
}

// CancelOrder cancels an order
func (fa *FIXAdapter) CancelOrder(sessionID string, cancel *FIXCancelRequest) error {
	session, err := fa.getSession(sessionID)
	if err != nil {
		return err
	}

	msg := fa.buildOrderCancelRequest(cancel)
	err = fa.sendMessage(session, msg)
	if err != nil {
		return err
	}

	if fa.orderRouter != nil {
		return fa.orderRouter.CancelOrder(session.ctx, cancel.OrigClOrdID)
	}

	return nil
}

// ReplaceOrder replaces an order
func (fa *FIXAdapter) ReplaceOrder(sessionID string, replace *FIXReplaceRequest) error {
	session, err := fa.getSession(sessionID)
	if err != nil {
		return err
	}

	msg := fa.buildOrderCancelReplaceRequest(replace)
	err = fa.sendMessage(session, msg)
	if err != nil {
		return err
	}

	if fa.orderRouter != nil {
		return fa.orderRouter.ReplaceOrder(session.ctx, replace.OrigClOrdID, &FIXOrder{
			ClOrdID:   replace.ClOrdID,
			OrderQty:  replace.OrderQty,
			Price:    replace.Price,
			OrdType:  replace.OrdType,
			TimeInForce: replace.TimeInForce,
		})
	}

	return nil
}

// SubscribeMarketData subscribes to market data
func (fa *FIXAdapter) SubscribeMarketData(sessionID string, symbols []string, depth int) error {
	session, err := fa.getSession(sessionID)
	if err != nil {
		return err
	}

	msg := fa.buildMarketDataRequest(symbols, true, depth)
	return fa.sendMessage(session, msg)
}

// Message building functions
func (fa *FIXAdapter) buildLogon(config *FIXConfig) *FIXMessage {
	fields := map[string]string{
		"58": "8=FIX.4.2",
		"98":  "0",           // EncryptMethod (None)
		"108": strconv.Itoa(config.HeartbeatInterval), // Heartbeat
		"553": config.CompID, // Username
		"554": config.Password, // Password
	}

	if config.ResetSeqNum {
		"141": "Y", // ResetSeqNumFlag
	}

	msg := &FIXMessage{
		MsgType: MsgTypeLogon,
		Fields:  fields,
	}

	fa.encoder.Encode(msg)

	return msg
}

func (fa *FIXAdapter) buildNewOrderSingle(order *FIXOrder) *FIXMessage {
	fields := map[string]string{
		"11": order.ClOrdID,  // ClOrdID
		"55": order.Symbol,   // Symbol
		"54": string(order.Side), // Side
		"38": order.OrderQty.String(), // OrderQty
		"40": string(order.OrdType), // OrdType
		"21": "1", // HandlInst (AutoExec)
	}

	if order.Price.GreaterThan(decimal.Zero) {
		fields["44"] = order.Price.String() // Price
	}

	if order.StopPx.GreaterThan(decimal.Zero) {
		fields["99"] = order.StopPx.String() // StopPx
	}

	if order.TimeInForce != "" {
		fields["59"] = string(order.TimeInForce) // TimeInForce
	}

	if order.Text != "" {
		fields["58"] = order.Text // Text
	}

	msg := &FIXMessage{
		MsgType: MsgTypeNewOrderSingle,
		Fields:  fields,
	}

	return msg
}

func (fa *FIXAdapter) buildOrderCancelRequest(cancel *FIXCancelRequest) *FIXMessage {
	fields := map[string]string{
		"11": cancel.ClOrdID,      // ClOrdID
		"41": cancel.OrigClOrdID, // OrigClOrdID
		"55": cancel.Symbol,       // Symbol
		"54": string(cancel.Side), // Side
	}

	msg := &FIXMessage{
		MsgType: MsgTypeOrderCancelRequest,
		Fields:  fields,
	}

	return msg
}

func (fa *FIXAdapter) buildOrderCancelReplaceRequest(replace *FIXReplaceRequest) *FIXMessage {
	fields := map[string]string{
		"11": replace.ClOrdID,
		"41": replace.OrigClOrdID,
		"37": replace.OrderID,
		"55": replace.Symbol,
		"54": string(replace.Side),
		"38": replace.OrderQty.String(),
		"40": string(replace.OrdType),
	}

	msg := &FIXMessage{
		MsgType: MsgTypeOrderCancelReplace,
		Fields:  fields,
	}

	return msg
}

func (fa *FIXAdapter) buildReject(clOrdID, text string) *FIXMessage {
	fields := map[string]string{
		"45": clOrdID, // RefSeqNum (placeholder)
		"58": text,    // Text
	}

	msg := &FIXMessage{
		MsgType: MsgTypeReject,
		Fields:  fields,
	}

	return msg
}

func (fa *FIXAdapter) buildMarketDataRequest(symbols []string, subscribe bool, depth int) *FIXMessage {
	fields := map[string]string{
		"262": generateMDReqID(),    // MDReqID
		"263": "1",                 // SubscriptionRequestType (Snapshot + Updates)
		"264": strconv.Itoa(depth), // MarketDepth
		"265": "1",                 // MDUpdateType (Full Refresh)
	}

	// Add symbol entries
	symbolStr := strings.Join(symbols, ",")
	fields["55"] = symbolStr

	msg := &FIXMessage{
		MsgType: MsgTypeMarketDataRequest,
		Fields:  fields,
	}

	return msg
}

// Session handling
func (fa *FIXAdapter) handleSession(session *FIXSession) {
	defer func() {
		session.Connected = false
		session.Socket.Close()
	}()

	heartbeat := time.NewTicker(time.Duration(session.HeartbeatInterval) * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-session.ctx.Done():
			return
		case <-heartbeat.C:
			fa.sendHeartbeat(session)
		default:
			msg, err := fa.readMessage(session)
			if err != nil {
				return
			}

			session.LastReceived = time.Now()
			fa.processMessage(session, msg)
		}
	}
}

func (fa *FIXAdapter) processMessage(session *FIXSession, msg *FIXMessage) {
	switch msg.MsgType {
	case MsgTypeNewOrderSingle:
		order := fa.parseNewOrderSingle(msg)
		if fa.msgHandler != nil {
			_, err := fa.msgHandler.OnNewOrder(order)
			if err != nil {
				reject := fa.buildReject(order.ClOrdID, err.Error())
				fa.sendMessage(session, reject)
			}
		}

	case MsgTypeOrderCancelRequest:
		cancel := fa.parseCancelRequest(msg)
		if fa.msgHandler != nil {
			err := fa.msgHandler.OnCancelRequest(cancel)
			if err != nil {
				// Send reject
			}
		}

	case MsgTypeOrderCancelReplace:
		replace := fa.parseReplaceRequest(msg)
		if fa.msgHandler != nil {
			err := fa.msgHandler.OnReplaceRequest(replace)
			if err != nil {
				// Send reject
			}
		}

	case MsgTypeHeartbeat:
		// Heartbeat received

	case MsgTypeTestRequest:
		// Respond with heartbeat

	case MsgTypeLogout:
		session.Connected = false
	}
}

func (fa *FIXAdapter) sendMessage(session *FIXSession, msg *FIXMessage) error {
	session.mu.Lock()
	defer session.mu.Unlock()

	// Add standard header fields
	session.OutSeqNum++

	data := fa.encoder.EncodeToString(msg, session.OutSeqNum, session.CompID, session.TargetCompID)

	_, err := session.Writer.WriteString(data)
	if err != nil {
		return err
	}

	err = session.Writer.Flush()
	session.LastSent = time.Now()

	return err
}

func (fa *FIXAdapter) readMessage(session *FIXSession) (*FIXMessage, error) {
	data, err := session.Reader.ReadString('\x01')
	if err != nil {
		return nil, err
	}

	return fa.decoder.Decode(data)
}

func (fa *FIXAdapter) sendHeartbeat(session *FIXSession) {
	msg := &FIXMessage{
		MsgType: MsgTypeHeartbeat,
		Fields:  map[string]string{},
	}
	fa.sendMessage(session, msg)
}

// Parsing functions
func (fa *FIXAdapter) parseNewOrderSingle(msg *FIXMessage) *FIXOrder {
	order := &FIXOrder{
		ClOrdID:    msg.Fields["11"],
		Symbol:     msg.Fields["55"],
		Side:       Side(msg.Fields["54"]),
		OrdType:    OrdType(msg.Fields["40"]),
		HandlInst:  msg.Fields["21"],
	}

	if qty, ok := msg.Fields["38"]; ok {
		order.OrderQty, _ = decimal.NewFromString(qty)
	}

	if price, ok := msg.Fields["44"]; ok {
		order.Price, _ = decimal.NewFromString(price)
	}

	if stopPx, ok := msg.Fields["99"]; ok {
		order.StopPx, _ = decimal.NewFromString(stopPx)
	}

	if tif, ok := msg.Fields["59"]; ok {
		order.TimeInForce = TimeInForce(tif)
	}

	return order
}

func (fa *FIXAdapter) parseCancelRequest(msg *FIXMessage) *FIXCancelRequest {
	return &FIXCancelRequest{
		ClOrdID:     msg.Fields["11"],
		OrigClOrdID: msg.Fields["41"],
		OrderID:     msg.Fields["37"],
		Symbol:      msg.Fields["55"],
		Side:        Side(msg.Fields["54"]),
	}
}

func (fa *FIXAdapter) parseReplaceRequest(msg *FIXMessage) *FIXReplaceRequest {
	replace := &FIXReplaceRequest{
		ClOrdID:     msg.Fields["11"],
		OrigClOrdID: msg.Fields["41"],
		OrderID:     msg.Fields["37"],
		Symbol:      msg.Fields["55"],
		Side:        Side(msg.Fields["54"]),
	}

	if qty, ok := msg.Fields["38"]; ok {
		replace.OrderQty, _ = decimal.NewFromString(qty)
	}

	if price, ok := msg.Fields["44"]; ok {
		replace.Price, _ = decimal.NewFromString(price)
	}

	return replace
}

func (fa *FIXAdapter) getSession(sessionID string) (*FIXSession, error) {
	fa.mu.RLock()
	session, ok := fa.sessions[sessionID]
	fa.mu.RUnlock()

	if !ok || !session.Connected {
		return nil, fmt.Errorf("session not found or disconnected")
	}

	return session, nil
}

// MessageEncoder encodes FIX messages
type MessageEncoder struct{}

func NewMessageEncoder() *MessageEncoder {
	return &MessageEncoder{}
}

func (e *MessageEncoder) Encode(msg *FIXMessage, seqNum int, sender, target string) {
	// Adds standard header fields
	msg.Fields["8"] = "FIX.4.2"
	msg.Fields["9"] = "" // Body length - calculated
	msg.Fields["35"] = string(msg.MsgType)
	msg.Fields["34"] = strconv.Itoa(seqNum)
	msg.Fields["49"] = sender
	msg.Fields["56"] = target
	msg.Fields["52"] = time.Now().Format("20060102-15:04:05")
}

func (e *MessageEncoder) EncodeToString(msg *FIXMessage, seqNum int, sender, target string) string {
	e.Encode(msg, seqNum, sender, target)

	var parts []string
	for k, v := range msg.Fields {
		parts = append(parts, fmt.Sprintf("%s=%s", k, v))
	}

	body := strings.Join(parts, "\x01") + "\x01"
	length := len(body)

	// Insert length at position 9
	parts = append([]string{}, parts...)
	parts = append(parts[:9], append([]string{fmt.Sprintf("9=%d", length)}, parts[9:]...)...)

	result := strings.Join(parts, "\x01") + "\x01"

	// Calculate checksum
	checksum := calculateChecksum(result)
	result += fmt.Sprintf("10=%s\x01", checksum)

	return result
}

// MessageDecoder decodes FIX messages
type MessageDecoder struct{}

func NewMessageDecoder() *MessageDecoder {
	return &MessageDecoder{}
}

func (d *MessageDecoder) Decode(data string) (*FIXMessage, error) {
	fields := make(map[string]string)

	pairs := strings.Split(data, "\x01")
	for _, pair := range pairs {
		if pair == "" {
			continue
		}

		idx := strings.Index(pair, "=")
		if idx < 0 {
			continue
		}

		tag := pair[:idx]
		value := pair[idx+1:]
		fields[tag] = value
	}

	msgType, ok := fields["35"]
	if !ok {
		return nil, fmt.Errorf("missing message type")
	}

	return &FIXMessage{
		MsgType: MsgType(msgType),
		Fields:  fields,
	}, nil
}

// Helper functions
func generateSessionID() string {
	return fmt.Sprintf("FIX%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateExecID() string {
	return fmt.Sprintf("EX%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateMDReqID() string {
	return fmt.Sprintf("MD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func calculateChecksum(data string) string {
	hash := md5.Sum([]byte(data))
	sum := binary.BigEndian.Uint32(hash[:4])
	return fmt.Sprintf("%03d", sum%256)
}

func (fa *FIXAdapter) buildExecutionReport(order *FIXOrder, exec *FIXExecution) *FIXMessage {
	fields := map[string]string{
		"37":  exec.OrderID,         // OrderID
		"11":  exec.ClOrdID,         // ClOrdID
		"17":  exec.ExecID,          // ExecID
		"20":  string(exec.ExecType), // ExecTransType (New)
		"150": string(exec.ExecType), // ExecType
		"39":  string(exec.OrdStatus), // OrdStatus
		"55":  exec.Symbol,            // Symbol
		"54":  string(exec.Side),      // Side
		"38":  exec.OrderQty.String(), // OrderQty
		"151": exec.LeavesQty.String(), // LeavesQty
		"14":  exec.CumQty.String(),   // CumQty
		"6":   exec.AvgPx.String(),   // AvgPx
	}

	msg := &FIXMessage{
		MsgType: "8", // ExecutionReport
		Fields:  fields,
	}

	return msg
}

var _ = math.Max // Prevent unused