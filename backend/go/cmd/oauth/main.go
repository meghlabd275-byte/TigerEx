package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX OAUTH SERVICE - GO
// OAuth 2.0 provider for third-party integrations
// ============================================================================

// ============== MODELS ==============

type OAuthClient struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	ClientID    string   `json:"client_id"`
	ClientSecret string   `json:"-"`
	RedirectURIs []string `json:"redirect_uris"`
	Scopes      []string `json:"scopes"`
	Status     string   `json:"status"` // active, suspended, revoked
	GrantTypes []string `json:"grant_types"`
	CreatedAt   int64    `json:"created_at"`
}

type OAuthAuthorization struct {
	ClientID    string    `json:"client_id"`
	Code       string    `json:"code"`
	RedirectURI string    `json:"redirect_uri"`
	Scope       string    `json:"scope"`
	State       string    `json:"state"`
	UserID     string    `json:"user_id"`
	ExpiresAt  int64     `json:"expires_at"`
	Used       bool      `json:"used"`
	UsedAt     int64     `json:"used_at"`
}

type OAuthToken struct {
	AccessToken  string `json:"access_token"`
	TokenType  string `json:"token_type"`
	ExpiresIn int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope     string `json:"scope"`
}

type OAuthUser struct {
	UserID       string   `json:"user_id"`
	Provider    string   `json:"provider"`
	ProviderUserID string `json:"provider_user_id"`
	Email       string   `json:"email"`
	Name        string   `json:"name"`
	AccessToken string   `json:"-"`
	RefreshToken string  `json:"-"`
	ExpiresAt  int64    `json:"expires_at"`
}

// ============== SERVICE ==============

type OAuthService struct {
	clients map[string]*OAuthClient
	authorizations map[string]*OAuthAuthorization
	tokens map[string]*OAuthToken
	userConnections map[string][]*OAuthUser
}

func NewOAuthService() *OAuthService {
	s := &OAuthService{
		clients: make(map[string]*OAuthClient),
		authorizations: make(map[string]*OAuthAuthorization),
		tokens: make(map[string]*OAuthToken),
		userConnections: make(map[string][]*OAuthUser),
	}

	// Register demo clients
	s.clients["tigerex_mobile"] = &OAuthClient{
		ID: "tigerex_mobile",
		Name: "TigerEx Mobile App",
		ClientID: "mobile_client_id",
		ClientSecret: "mobile_secret",
		RedirectURIs: []string{"tigerex://oauth", "https://mobile.tigerex.com/oauth"},
		Scopes: []string{"profile", "wallet:read", "trades:read"},
		Status: "active",
		GrantTypes: []string{"authorization_code", "refresh_token"},
		CreatedAt: time.Now().Unix(),
	}

	s.clients["partners_api"] = &OAuthClient{
		ID: "partners_api",
		Name: "Partners API",
		ClientID: "partner_client_id",
		ClientSecret: "partner_secret",
		RedirectURIs: []string{"https://partner.example.com/oauth"},
		Scopes: []string{"profile", "trades:read", "withdrawals:read"},
		Status: "active",
		GrantTypes: []string{"client_credentials", "authorization_code"},
		CreatedAt: time.Now().Unix(),
	}

	return s
}

// Client Management
func (s *OAuthService) RegisterClient(name, redirectURI string, scopes []string) (*OAuthClient, error) {
	clientID := generateRandomString(16)
	clientSecret := generateRandomString(32)

	client := &OAuthClient{
		ID: name,
		Name: name,
		ClientID: clientID,
		ClientSecret: clientSecret,
		RedirectURIs: []string{redirectURI},
		Scopes: scopes,
		Status: "active",
		GrantTypes: []string{"authorization_code", "refresh_token"},
		CreatedAt: time.Now().Unix(),
	}

	s.clients[client.ID] = client
	return client, nil
}

func (s *OAuthService) GetClient(clientID string) (*OAuthClient, error) {
	for _, c := range s.clients {
		if c.ClientID == clientID {
			return c, nil
		}
	}
	return nil, fmt.Errorf("client not found")
}

// Authorization Code Flow
func (s *OAuthService) CreateAuthorization(clientID, userID, redirectURI, scope, state string) (*OAuthAuthorization, error) {
	client, err := s.GetClient(clientID)
	if err != nil {
		return nil, err
	}

	// Verify redirect URI
	validURI := false
	for _, uri := range client.RedirectURIs {
		if uri == redirectURI {
			validURI = true
			break
		}
	}
	if !validURI {
		return nil, fmt.Errorf("invalid redirect_uri")
	}

	code := generateRandomString(32)
	auth := &OAuthAuthorization{
		ClientID: clientID,
		Code: code,
		RedirectURI: redirectURI,
		Scope: scope,
		State: state,
		UserID: userID,
		ExpiresAt: time.Now().Add(10 * time.Minute).Unix(),
		Used: false,
	}

	s.authorizations[code] = auth
	return auth, nil
}

func (s *OAuthService) ExchangeCode(code, clientID, clientSecret, redirectURI string) (*OAuthToken, error) {
	auth, ok := s.authorizations[code]
	if !ok {
		return nil, fmt.Errorf("invalid code")
	}

	if auth.Used {
		return nil, fmt.Errorf("code already used")
	}

	if time.Now().Unix() > auth.ExpiresAt {
		return nil, fmt.Errorf("code expired")
	}

	client, err := s.GetClient(clientID)
	if err != nil {
		return nil, err
	}

	if client.ClientSecret != clientSecret {
		return nil, fmt.Errorf("invalid client secret")
	}

	if auth.RedirectURI != redirectURI {
		return nil, fmt.Errorf("redirect_uri mismatch")
	}

	// Mark code as used
	auth.Used = true
	auth.UsedAt = time.Now().Unix()

	// Generate tokens
	token := s.createUserToken(auth.UserID, auth.Scope)
	return token, nil
}

// Client Credentials Flow
func (s *OAuthService) ClientCredentialsGrant(clientID, clientSecret, scope string) (*OAuthToken, error) {
	client, err := s.GetClient(clientID)
	if err != nil {
		return nil, err
	}

	if client.ClientSecret != clientSecret {
		return nil, fmt.Errorf("invalid client secret")
	}

	tokenID := generateRandomString(32)
	token := &OAuthToken{
		AccessToken: tokenID,
		TokenType: "Bearer",
		ExpiresIn: 3600,
		Scope: scope,
	}

	s.tokens[tokenID] = token
	return token, nil
}

func (s *OAuthService) createUserToken(userID, scope string) *OAuthToken {
	accessToken := generateRandomString(32)
	refreshToken := generateRandomString(32)

	token := &OAuthToken{
		AccessToken: accessToken,
		TokenType: "Bearer",
		ExpiresIn: 3600,
		RefreshToken: refreshToken,
		Scope: scope,
	}

	s.tokens[accessToken] = token
	return token
}

func (s *OAuthService) RefreshTokenGrant(refreshToken string) (*OAuthToken, error) {
	// Find token by refresh token (simplified)
	for _, t := range s.tokens {
		if t.RefreshToken == refreshToken {
			// Create new tokens
			newToken := s.createUserToken("", t.Scope)
			return newToken, nil
		}
	}
	return nil, fmt.Errorf("invalid refresh token")
}

func (s *OAuthService) ValidateToken(tokenString string) (string, error) {
	token, ok := s.tokens[tokenString]
	if !ok {
		return "", fmt.Errorf("invalid token")
	}

	if time.Now().Unix() > token.ExpiresIn {
		return "", fmt.Errorf("token expired")
	}

	return token.Scope, nil
}

// OAuth User Connections (social login)
func (s *OAuthService) ConnectSocialAccount(userID, provider, providerUserID, email, name, accessToken string) {
	connection := &OAuthUser{
		UserID: userID,
		Provider: provider,
		ProviderUserID: providerUserID,
		Email: email,
		Name: name,
		AccessToken: accessToken,
		ExpiresAt: time.Now().Add(365 * 24 * time.Hour).Unix(),
	}

	s.userConnections[userID] = append(s.userConnections[userID], connection)
}

func (s *OAuthService) GetConnectedAccounts(userID string) []*OAuthUser {
	return s.userConnections[userID]
}

func (s *OAuthService) RevokeConnection(userID, provider string) error {
	connections := s.userConnections[userID]
	for i, c := range connections {
		if c.Provider == provider {
			s.userConnections[userID] = append(connections[:i], connections[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("connection not found")
}

// ============== HELPERS ==============

func generateRandomString(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)[:length]
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return base64.StdEncoding.EncodeToString(h[:])
}

// ============== HTTP HANDLERS ==============

func SetupOAuthRoutes(r *gin.Engine, svc *OAuthService) {
	oauth := r.Group("/oauth")

	// Authorization endpoint
	oauth.GET("/authorize", func(c *gin.Context) {
		clientID := c.Query("client_id")
		redirectURI := c.Query("redirect_uri")
		scope := c.DefaultQuery("scope", "profile")
		state := c.Query("state")
		responseType := c.Query("response_type")

		// Demo: require user login
		userID := c.DefaultQuery("user_id", "demo_user")

		if responseType != "code" {
			c.JSON(400, gin.H{"error": "unsupported_response_type"})
			return
		}

		auth, err := svc.CreateAuthorization(clientID, userID, redirectURI, scope, state)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		// Redirect with code
		redirectURL := redirectURI + "?code=" + auth.Code
		if state != "" {
			redirectURL += "&state=" + state
		}
		c.Redirect(http.StatusFound, redirectURL)
	})

	// Token endpoint
	oauth.POST("/token", func(c *gin.Context) {
		grantType := c.PostForm("grant_type")

		if grantType == "authorization_code" {
			code := c.PostForm("code")
			clientID := c.PostForm("client_id")
			clientSecret := c.PostForm("client_secret")
			redirectURI := c.PostForm("redirect_uri")

			token, err := svc.ExchangeCode(code, clientID, clientSecret, redirectURI)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, token)

		} else if grantType == "client_credentials" {
			clientID := c.PostForm("client_id")
			clientSecret := c.PostForm("client_secret")
			scope := c.PostForm("scope")

			token, err := svc.ClientCredentialsGrant(clientID, clientSecret, scope)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, token)

		} else if grantType == "refresh_token" {
			refreshToken := c.PostForm("refresh_token")

			token, err := svc.RefreshTokenGrant(refreshToken)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, token)

		} else {
			c.JSON(400, gin.H{"error": "unsupported_grant_type"})
		}
	})

	// Token validation
	oauth.POST("/validate", func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		tokenString := strings.TrimPrefix(auth, "Bearer ")

		scope, err := svc.ValidateToken(tokenString)
		if err != nil {
			c.JSON(401, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"valid": true, "scope": scope})
	})

	// Social connections
	oauth.POST("/connect/:provider", func(c *gin.Context) {
		provider := c.Param("provider")

		var req struct {
			UserID string `json:"user_id" binding:"required"`
			ProviderUserID string `json:"provider_user_id"`
			Email string `json:"email"`
			Name string `json:"name"`
			AccessToken string `json:"access_token"`
		}
		c.ShouldBindJSON(&req)

		svc.ConnectSocialAccount(req.UserID, provider, req.ProviderUserID, req.Email, req.Name, req.AccessToken)
		c.JSON(200, gin.H{"success": true})
	})

	oauth.GET("/connections/:user_id", func(c *gin.Context) {
		userID := c.Param("user_id")
		connections := svc.GetConnectedAccounts(userID)
		c.JSON(200, connections)
	})

	oauth.DELETE("/connections/:user_id/:provider", func(c *gin.Context) {
		userID := c.Param("user_id")
		provider := c.Param("provider")

		err := svc.RevokeConnection(userID, provider)
		if err != nil {
			c.JSON(404, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true})
	})
}

// ============== MAIN ==============

func main() {
	r := gin.Default()
	svc := NewOAuthService()
	SetupOAuthRoutes(r, svc)

	log.Println("OAuth service starting on :8080")
	log.Fatal(r.Run(":8080"))
}