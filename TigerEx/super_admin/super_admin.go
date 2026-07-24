// TigerEx Super Admin System
// Built with Go for high-load worldwide distributed systems

package main

import (
"fmt"
"sync"
"time"
)

type Admin struct {
ID          string
Username    string
Email       string
Role        string
Permissions []string
Status      string
}

type WhiteLabelClient struct {
ID       string
Name     string
Domain   string
Status   string
AdminID  string
Products []string
Fee      float64
}

type AuditLog struct {
ID        string
AdminID   string
Action    string
Resource  string
Details   string
Timestamp time.Time
}

type SuperAdminService struct {
mu      sync.RWMutex
admins  map[string]*Admin
clients map[string]*WhiteLabelClient
logs    []AuditLog
perms   map[string][]string
}

func New() *SuperAdminService {
svc := &SuperAdminService{
admins:  make(map[string]*Admin),
clients: make(map[string]*WhiteLabelClient),
logs:    make([]AuditLog, 0),
perms: map[string][]string{
"SUPER_ADMIN": {"*"},
"WHITE_LABEL_ADMIN": {"users.manage", "pairs.manage", "fees.manage"},
"SUPPORT": {"users.view"},
},
}
svc.admins["ADMIN_001"] = &Admin{ID: "ADMIN_001", Username: "superadmin", Role: "SUPER_ADMIN", Permissions: svc.perms["SUPER_ADMIN"], Status: "ACTIVE"}
return svc
}

func (s *SuperAdminService) CreateAdmin(username, email, role string) *Admin {
s.mu.Lock()
defer s.mu.Unlock()
admin := &Admin{ID: fmt.Sprintf("ADMIN_%d", time.Now().Unix()), Username: username, Email: email, Role: role, Permissions: s.perms[role], Status: "ACTIVE"}
s.admins[admin.ID] = admin
s.logs = append(s.logs, AuditLog{ID: fmt.Sprintf("LOG_%d", time.Now().UnixNano()), AdminID: admin.ID, Action: "CREATE_ADMIN", Resource: "admin", Details: "Created " + username})
return admin
}

func (s *SuperAdminService) CreateWhiteLabel(name, domain, adminID string, products []string, fee float64) *WhiteLabelClient {
s.mu.Lock()
defer s.mu.Unlock()
client := &WhiteLabelClient{ID: fmt.Sprintf("WL_%d", time.Now().Unix()), Name: name, Domain: domain, AdminID: adminID, Products: products, Fee: fee, Status: "ACTIVE"}
s.clients[client.ID] = client
s.logs = append(s.logs, AuditLog{ID: fmt.Sprintf("LOG_%d", time.Now().UnixNano()), AdminID: adminID, Action: "CREATE_WHITELABEL", Resource: "whitelabel", Details: "Created " + name})
return client
}

func (s *SuperAdminService) SuspendWhiteLabel(clientID string) {
s.mu.Lock()
defer s.mu.Unlock()
if c, ok := s.clients[clientID]; ok {
c.Status = "SUSPENDED"
}
}

func (s *SuperAdminService) DeleteWhiteLabel(clientID string) {
s.mu.Lock()
defer s.mu.Unlock()
delete(s.clients, clientID)
}

func (s *SuperAdminService) GetWhiteLabels() []*WhiteLabelClient {
s.mu.RLock()
defer s.mu.RUnlock()
var result []*WhiteLabelClient
for _, c := range s.clients { result = append(result, c) }
return result
}

func (s *SuperAdminService) GetAdmins() []*Admin {
s.mu.RLock()
defer s.mu.RUnlock()
var result []*Admin
for _, a := range s.admins { result = append(result, a) }
return result
}

func (s *SuperAdminService) GetLogs(limit int) []AuditLog {
s.mu.RLock()
defer s.mu.RUnlock()
if limit > len(s.logs) { limit = len(s.logs) }
return s.logs[len(s.logs)-limit:]
}

func main() {
fmt.Println("TigerEx Super Admin System")
svc := New()

// Create admins
admin1 := svc.CreateAdmin("admin1", "admin1@tigerex.com", "WHITE_LABEL_ADMIN")
admin2 := svc.CreateAdmin("support1", "support@tigerex.com", "SUPPORT")

// Create white label clients
wl1 := svc.CreateWhiteLabel("Custom Exchange", "custom.exchange", admin1.ID, []string{"CEX", "DEX"}, 0.001)
wl2 := svc.CreateWhiteLabel("My Exchange", "my.exchange", admin1.ID, []string{"CEX"}, 0.002)

fmt.Printf("\nAdmins: %d\n", len(svc.GetAdmins()))
for _, a := range svc.GetAdmins() { fmt.Printf("  %s: %s\n", a.Username, a.Role) }

fmt.Printf("\nWhite Labels: %d\n", len(svc.GetWhiteLabels()))
for _, w := range svc.GetWhiteLabels() { fmt.Printf("  %s: %s (Fee: %.2f%%)\n", w.Name, w.Status, w.Fee*100) }

fmt.Printf("\nAudit Logs: %d\n", len(svc.GetLogs(10)))
for _, l := range svc.GetLogs(10) { fmt.Printf("  %s: %s\n", l.Action, l.Details) }

svc.SuspendWhiteLabel(wl2.ID)
fmt.Printf("\nSuspended: %s\n", wl2.Status)
}
