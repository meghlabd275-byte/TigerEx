package main

import (
	"fmt"
	"time"
)

// Call status
type CallStatus string

const (
	CallRinging CallStatus = "ringing"
	CallConnected CallStatus = "connected"
	CallOnHold CallStatus = "on_hold"
	CallTransferred CallStatus = "transferred"
	CallCompleted CallStatus = "completed"
	CallFailed CallStatus = "failed"
)

// Ticket priority
type TicketPriority string

const (
	PriorityLow TicketPriority = "low"
	PriorityMedium TicketPriority = "medium"
	PriorityHigh TicketPriority = "high"
	PriorityUrgent TicketPriority = "urgent"
)

// Ticket status
type TicketStatus string

const (
	TicketOpen TicketStatus = "open"
	TicketPending TicketStatus = "pending"
	TicketResolved TicketStatus = "resolved"
	TicketClosed TicketStatus = "closed"
)

// Support ticket
type SupportTicket struct {
	ID        string        `json:"id"`
	UserID    string        `json:"userId"`
	Subject   string        `json:"subject"`
	Priority TicketPriority `json:"priority"`
	Status    TicketStatus   `json:"status"`
	Messages []Message     `json:"messages"`
	CreatedAt int64         `json:"createdAt"`
}

// Message
type Message struct {
	Sender string `json:"sender"`
	Body   string `json:"body"`
	Time   int64  `json:"time"`
}

// Phone call
type PhoneCall struct {
	ID        string    `json:"id"`
	UserID  string    `json:"userId"`
	Number string    `json:"number"`
	Status CallStatus `json:"status"`
	StartTime int64   `json:"startTime"`
	EndTime  *int64  `json:"endTime,omitempty"`
}

// Phone support platform
type PhoneSupport struct {
	Tickets map[string]*SupportTicket
	Calls   map[string]*PhoneCall
}

// New creates platform
func NewPhoneSupport() *PhoneSupport {
	return &PhoneSupport{
		Tickets: make(map[string]*SupportTicket),
		Calls: make(map[string]*PhoneCall),
	}
}

// Create ticket
func (p *PhoneSupport) CreateTicket(userID, subject string, priority TicketPriority) *SupportTicket {
	id := fmt.Sprintf("ticket_%d", time.Now().UnixNano())
	
	ticket := &SupportTicket{
		ID: id,
		UserID: userID,
		Subject: subject,
		Priority: priority,
		Status: TicketOpen,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	p.Tickets[id] = ticket
	return ticket
}

// Add message
func (p *PhoneSupport) AddMessage(ticketID, sender, body string) {
	ticket := p.Tickets[ticketID]
	if ticket == nil {
		return
	}
	
	ticket.Messages = append(ticket.Messages, Message{
		Sender: sender,
		Body: body,
		Time: time.Now().UnixMilli(),
	})
}

// Initiate call
func (p *PhoneSupport) InitiateCall(userID, number string) *PhoneCall {
	id := fmt.Sprintf("call_%d", time.Now().UnixNano())
	
	call := &PhoneCall{
		ID: id,
		UserID: userID,
		Number: number,
		Status: CallRinging,
		StartTime: time.Now().UnixMilli(),
	}
	
	p.Calls[id] = call
	return call
}

// End call
func (p *PhoneSupport) EndCall(callID string) {
	call := p.Calls[callID]
	if call == nil {
		return
	}
	
	status := CallCompleted
	call.Status = status
	now := time.Now().UnixMilli()
	call.EndTime = &now
}

func main() {
	support := NewPhoneSupport()
	
	// Create ticket
	ticket := support.CreateTicket("user1", "Login issue", PriorityHigh)
	fmt.Printf("Ticket: %s - %s\n", ticket.ID, ticket.Subject)
	
	// Add message
	support.AddMessage(ticket.ID, "user1", "Cannot login to my account")
	fmt.Printf("Messages: %d\n", len(ticket.Messages))
	
	// Initiate call
	call := support.InitiateCall("user1", "+1234567890")
	fmt.Printf("Call: %s - %s\n", call.ID, call.Status)
	
	support.EndCall(call.ID)
	fmt.Printf("Status: %s\n", call.Status)
}