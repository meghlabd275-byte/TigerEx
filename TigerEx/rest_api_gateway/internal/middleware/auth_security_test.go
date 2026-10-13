package middleware

import (
	"context"
	"strings"
	"testing"
	"time"

	"tigerEx/rest_api_gateway/internal/config"
)

func testAuthMiddleware() *AuthMiddleware {
	return NewAuthMiddleware(&config.Config{
		Server: config.ServerConfig{Mode:"production"},
		Auth: config.AuthConfig{Required:true},
		JWT: config.JWTConfig{Secret:strings.Repeat("s",48), Expiry:time.Hour, Issuer:"tigerex-test", Audience:"tigerex-api-test"},
	})
}

func TestJWTGeneratedTokenVerifies(t *testing.T) {
	am:=testAuthMiddleware()
	token,err:=am.GenerateJWT("user-123"); if err!=nil { t.Fatalf("GenerateJWT: %v",err) }
	claims,err:=am.parseJWT(token); if err!=nil { t.Fatalf("parseJWT: %v",err) }
	if claims["user_id"]!="user-123" { t.Fatalf("unexpected user_id: %#v",claims["user_id"]) }
}

func TestJWTRejectsTamperedSignature(t *testing.T) {
	am:=testAuthMiddleware()
	token,err:=am.GenerateJWT("user-123"); if err!=nil { t.Fatalf("GenerateJWT: %v",err) }
	parts:=strings.Split(token,"."); parts[2]=strings.Repeat("A",len(parts[2]))
	if _,err:=am.parseJWT(strings.Join(parts,".")); err==nil { t.Fatal("expected tampered signature rejection") }
}

func TestJWTRejectsWeakDefaultSecret(t *testing.T) {
	am:=NewAuthMiddleware(&config.Config{JWT:config.JWTConfig{Secret:"tigerex-secret-key-change-in-production",Expiry:time.Hour}})
	if _,err:=am.GenerateJWT("user-123"); err==nil { t.Fatal("expected default secret rejection") }
}

func TestAPIKeyAuthFailsClosedWithoutVerifier(t *testing.T) {
	am:=testAuthMiddleware()
	if _,err:=am.Authenticate(context.Background(),"APIKEY "+strings.Repeat("k",40)); err==nil {
		t.Fatal("expected API key auth to fail closed until a persistent verifier is configured")
	}
}
