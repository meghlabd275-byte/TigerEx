// Package telegram_bot provides Telegram bot services.
// Migrated from TypeScript to Go for Telegram trading bot.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Bot command
type Command struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Handler    func(*Message) string
}

// Message
type Message struct {
	ChatID   int64   `json:"chatId"`
	MessageID int64  `json:"messageId"`
	From    string  `json:"from"`
	Text    string  `json:"text"`
	Command string  `json:"command"`
	Args    []string `json:"args"`
}

// Session
type Session struct {
	ChatID    int64   `json:"chatId"`
	UserID   string  `json:"userId"`
	Status   string  `json:"status"` // idle, pending_login, trading
	LastActive int64  `json:"lastActive"`
}

// Store
type BotStore struct {
	mu       sync.RWMutex
	commands map[string]*Command
	sessions map[int64]*Session
}

var (
	botStore = &BotStore{
		commands: make(map[string]*Command),
		sessions: make(map[int64]*Session),
	}
)

// Initialize commands
func init() {
	commands := []*Command{
		{Name: "/start", Description: "Start the bot"},
		{Name: "/balance", Description: "Check balance"},
		{Name: "/price", Description: "Check price of a token"},
		{Name: "/buy", Description: "Buy token /buy BTC 0.01"},
		{Name: "/sell", Description: "Sell token /sell ETH 0.1"},
		{Name: "/orders", Description: "View open orders"},
		{Name: "/help", Description: "Show help"},
	}

	botStore.mu.Lock()
	defer botStore.mu.Unlock()

	for _, c := range commands {
		// Need to assign handlers properly
		botStore.commands[c.Name] = c
	}
}

// Handle message
func HandleMessage(msg *Message) string {
	// Parse command
	cmd, args := parseCommand(msg.Text)

	if cmd == "/help" {
		return showHelp()
	}

	if cmd == "/balance" {
		return "Your balances:\nBTC: 1.5\nETH: 10.0\nUSDT: 5000"
	}

	if cmd == "/price" && len(args) > 0 {
		return fmt.Sprintf("%s price: $65,000", args[0])
	}

	return fmt.Sprintf("Unknown command: %s", cmd)
}

// Create session
func CreateSession(chatID int64, userID string) *Session {
	session := &Session{
		ChatID: chatID,
		UserID: userID,
		Status: "idle",
		LastActive: time.Now().UnixMilli(),
	}

	botStore.mu.Lock()
	defer botStore.mu.Unlock()
	botStore.sessions[chatID] = session

	return session
}

// Get session
func GetSession(chatID int64) (*Session, bool) {
	botStore.mu.RLock()
	defer botStore.mu.RUnlock()

	session, ok := botStore.sessions[chatID]
	return session, ok
}

// Show help
func showHelp() string {
	return `Commands:
/start - Start the bot
/balance - Check your balances
/price [symbol] - Get price
/buy [symbol] [amount] - Buy
/sell [symbol] [amount] - Sell
/orders - View open orders
/help - Show this help`
}

// Parse command
func parseCommand(text string) (string, []string) {
	var cmd string
	var args []string

	fmt.Sscanf(text, "%s", &cmd)

	return cmd, args
}

func main() {
	fmt.Println("Telegram Bot service initialized")

	// Show commands
	for name, c := range botStore.commands {
		fmt.Printf("%s: %s\n", name, c.Description)
	}

	// Session
	session := CreateSession(123456789, "user_001")
	fmt.Printf("Session created for %s\n", session.UserID)

	// Handle
	msg := &Message{
		ChatID: 123456789,
		From: "user_001",
		Text: "/balance",
	}

	response := HandleMessage(msg)
	fmt.Printf("Response: %s\n", response)
}