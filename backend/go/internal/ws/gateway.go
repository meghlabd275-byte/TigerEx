// WebSocket Gateway - Real-time trading platform
package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	MaxMsgSize     = 10 * 1024 * 1024
	MaxConnects   = 100000
	HeartbeatInt  = 30
	PongTimeout   = 30
)

type State int
const (
	StateConnecting State = iota
	StateAuthenticated
	StateOpen
	StateClosing
	StateClosed
)

type Subscription struct {
	Channel string
	Filter  string
}

type Connection struct {
	id       string
	conn    *websocket.Conn
	state   State
	userID  string
	subs    map[string]Subscription
	writeMu sync.Mutex
	
	msgsSent atomic.Int64
	msgsRecv atomic.Int64
	bytesSent atomic.Int64
	bytesRecv atomic.Int64
	lastAct atomic.Int64
	rateBucket int
	rateReset time.Time
}

type Message struct {
	Type    string          `json:"type"`
	Channel string          `json:"channel,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Data   interface{}    `json:"data,omitempty"`
	Error string          `json:"error,omitempty"`
	ID    string          `json:"id,omitempty"`
}

type Gateway struct {
	Addr      string
	Port      int
	conns     map[string]*Connection
	connMu    sync.RWMutex
	channels  map[string]map[string]*Connection
	channelMu sync.RWMutex
	routes    map[string]MessageHandler
	fanout    *Fanout
	stats    GatewayStats
	ctx      context.Context
	cancel   context.CancelFunc
}

type MessageHandler func(*Connection, *Message) error

type Fanout struct {
	mu   sync.RWMutex
	subs map[string]map[*Connection]bool
}

type GatewayStats struct {
	connects    atomic.Int64
	msgsSent   atomic.Int64
	msgsRecv  atomic.Int64
	bytesSent  atomic.Int64
	bytesRecv atomic.Int64
	errors   atomic.Int64
}

var upgrader = websocket.Upgrader{
	HandshakeTimeout: 10,
	CheckOrigin: func(r *http.Request) bool { return true },
}

func NewGateway(addr string, port int) *Gateway {
	ctx, cancel := context.WithCancel(context.Background())
	gw := &Gateway{
		Addr:    addr,
		Port:    port,
		conns:   make(map[string]*Connection),
		channels: make(map[string]map[string]*Connection),
		routes: make(map[string]MessageHandler),
		fanout: &Fanout{subs: make(map[string]map[*Connection]bool)},
		ctx:    ctx,
		cancel: cancel,
	}
	gw.routeDefaults()
	return gw
}

func (gw *Gateway) routeDefaults() {
	gw.routes["subscribe"] = gw.hSub
	gw.routes["unsubscribe"] = gw.hUnsub
	gw.routes["ping"] = gw.hPing
	gw.routes["auth"] = gw.hAuth
}

func (gw *Gateway) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.serveWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})
	
	srv := &http.Server{Addr: fmt.Sprintf("%s:%d", gw.Addr, gw.Port), Handler: mux}
	go srv.ListenAndServe()
	log.Printf("WS Gateway: %s:%d", gw.Addr, gw.Port)
	return nil
}

func (gw *Gateway) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.UpGRade(w, r, nil)
	if err != nil { return }
	
	c := &Connection{
		id:    fmt.Sprintf("c%d", time.Now().UnixNano()),
		conn:  conn,
		state: StateConnecting,
		subs:  make(map[string]Subscription),
	}
	
	gw.connMu.Lock()
	gw.conns[c.id] = c
	gw.stats.connects.Add(1)
	gw.connMu.Unlock()
	
	go gw.handleConn(c)
}

func (gw *Gateway) handleConn(c *Connection) {
	defer func() {
		c.close()
		gw.connMu.Lock()
		delete(gw.conns, c.id)
		gw.stats.connects.Add(-1)
		gw.connMu.Unlock()
	}()
	
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil { break }
		
		c.bytesRecv.Add(int64(len(data)))
		gw.stats.bytesRecv.Add(int64(len(data)))
		
		var msg Message
		if json.Unmarshal(data, &msg) != nil { continue }
		
		if h := gw.routes[msg.Type]; h != nil {
			h(c, &msg)
		}
		
		c.msgsRecv.Add(1)
		c.lastAct.Store(time.Now().UnixMilli())
	}
}

func (c *Connection) Write(msg Message) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.conn == nil || c.state == StateClosed { return }
	
	if data, err := json.Marshal(msg); err == nil {
		c.conn.WriteMessage(websocket.TextMessage, data)
		c.msgsSent.Add(1)
	}
}

func (c *Connection) close() {
	c.state = StateClosing
	if c.conn != nil {
		c.conn.WriteMessage(websocket.CloseMessage, []byte{})
		c.conn.Close()
	}
	c.state = StateClosed
}

func (gw *Gateway) hSub(c *Connection, m *Message) error {
	var p struct{ Channel string `json:"channel"` }
	json.Unmarshal(m.Params, &p)
	
	c.subs[p.Channel] = Subscription{Channel: p.Channel}
	gw.fanout.Sub(p.Channel, c)
	return nil
}

func (gw *Gateway) hUnsub(c *Connection, m *Message) error {
	var p struct{ Channel string `json:"channel"` }
	json.Unmarshal(m.Params, &p)
	delete(c.subs, p.Channel)
	gw.fanout.Unsub(p.Channel, c)
	return nil
}

func (gw *Gateway) hPing(c *Connection, m *Message) error {
	c.Write(Message{Type: "pong"})
	return nil
}

func (gw *Gateway) hAuth(c *Connection, m *Message) error {
	var p struct{ Token string `json:"token"` }
	json.Unmarshal(m.Params, &p)
	c.userID = p.Token[:min(8,len(p.Token))]
	c.state = StateAuthenticated
	return nil
}

func (f *Fanout) Sub(ch string, c *Connection) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.subs[ch] == nil { f.subs[ch] = make(map[*Connection]bool) }
	f.subs[ch][c] = true
}

func (f *Fanout) Unsub(ch string, c *Connection) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.subs[ch] != nil { delete(f.subs[ch], c) }
}

func min(a, b int) int { if a < b { return a }; return b }

// Broadcast sends to channel
func (gw *Gateway) Broadcast(ch string, data interface{}) {
	gw.fanout.mu.RLock()
	subs := gw.fanout.subs[ch]
	gw.fanout.mu.RUnlock()
	
	for c := range subs {
		if c.state == StateOpen {
			c.Write(Message{Type: "broadcast", Channel: ch, Data: data})
		}
	}
}