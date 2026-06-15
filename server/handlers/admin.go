// Admin HTTP Handlers - Complete Admin Operations
package handlers

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"tigerex/server/middleware"
	"tigerex/server/models"
)

// ============ ADMIN AUTH ============

func AdminLogin(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	var admin models.Admin
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT id, username, email, password_hash, role, status, permissions 
		FROM admins WHERE username = $1 OR email = $1
	`, req.Username).Scan(&admin.ID, &admin.Username, &admin.Email, &admin.PasswordHash, &admin.Role, &admin.Status, &admin.Permissions)

	if err != nil || admin.Username == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid credentials"}})
		return
	}

	if admin.Status != "active" {
		c.JSON(403, gin.H{"success": false, "error": gin.H{"code": 403, "message": "Account not active"}})
		return
	}

	valid := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password+"tigerex"))
	if valid != nil {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid credentials"}})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"admin_id": admin.ID.String(),
		"username": admin.Username,
		"role":     admin.Role,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
	})
	tokenStr, _ := token.SignedString(middleware.JWTSecret)

	// Update last login
	_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE admins SET last_login_at = NOW() WHERE id = $1", admin.ID)

	// Log action
	models.LogAdminAction(admin.ID, admin.Username, "LOGIN", "admin", admin.ID.String(), nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"token":     tokenStr,
		"expiresIn": 86400,
		"admin": gin.H{
			"id":          admin.ID,
			"username":    admin.Username,
			"email":       admin.Email,
			"role":        admin.Role,
			"permissions": admin.Permissions,
		},
	}})
}

func AdminLogout(c *gin.Context) {
	adminID := getAdminID(c)
	username := c.GetString("admin_username")

	if adminID != "" {
		models.LogAdminAction(adminID, username, "LOGOUT", "admin", adminID, nil)
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Logged out"}})
}

// ============ USER MANAGEMENT ============

func GetAllUsers(c *gin.Context) {
	adminID := checkAdminPermission(c, "users")
	if adminID == "" {
		return
	}

	limit := 50
	offset := 0
	if l := c.Query("limit"); l != "" {
		limit, _ = strconv.Atoi(l)
	}
	if o := c.Query("offset"); o != "" {
		offset, _ = strconv.Atoi(o)
	}

	status := c.Query("status")
	email := c.Query("email")

	query := `SELECT id, email, username, kyc_level, status, email_verified, 
					  two_factor_enabled, created_at, last_login_at 
			  FROM users WHERE 1=1`
	args := []interface{}{}
	argNum := 1

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argNum)
		args = append(args, status)
		argNum++
	}
	if email != "" {
		query += fmt.Sprintf(" AND email LIKE $%d", argNum)
		args = append(args, "%"+email+"%")
		argNum++
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argNum, argNum+1)
	args = append(args, limit, offset)

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	users := []gin.H{}
	for rows.Next() {
		var u gin.H
		rows.Scan(&u["id"], &u["email"], &u["username"], &u["kycLevel"], &u["status"],
			&u["emailVerified"], &u["twoFactorEnabled"], &u["createdAt"], &u["lastLoginAt"])
		users = append(users, u)
	}

	// Log action
	models.LogAdminAction(adminID, c.GetString("admin_username"), "LIST_USERS", "users", "", gin.H{"count": len(users)})

	c.JSON(200, gin.H{"success": true, "data": users})
}

func GetUserDetail(c *gin.Context) {
	adminID := checkAdminPermission(c, "users")
	if adminID == "" {
		return
	}

	userID := c.Param("userId")

	var user gin.H
	err := models.Pool.QueryRow(c.Request.Context(), `
		SELECT id, email, username, kyc_level, status, email_verified, phone_verified,
		       two_factor_enabled, risk_score, risk_category, jurisdiction, referral_code,
		       created_at, last_login_at, last_login_ip
		FROM users WHERE id = $1
	`, userID).Scan(&user["id"], &user["email"], &user["username"], &user["kycLevel"],
		&user["status"], &user["emailVerified"], &user["phoneVerified"], &user["twoFactorEnabled"],
		&user["riskScore"], &user["riskCategory"], &user["jurisdiction"], &user["referralCode"],
		&user["createdAt"], &user["lastLoginAt"], &user["lastLoginIp"])

	if err != nil || user["id"] == "" {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "User not found"}})
		return
	}

	// Get user wallets
	wallets, _ := getUserWallets(userID)

	// Get KYC status
	kyc, _ := GetUserKYC(userID)

	user["wallets"] = wallets
	user["kyc"] = kyc

	// Log action
	models.LogAdminAction(adminID, c.GetString("admin_username"), "VIEW_USER", "users", userID, nil)

	c.JSON(200, gin.H{"success": true, "data": user})
}

func UpdateUser(c *gin.Context) {
	adminID := checkAdminPermission(c, "users")
	if adminID == "" {
		return
	}

	userID := c.Param("userId")

	var req struct {
		KycLevel     *int    `json:"kycLevel"`
		Status       *string `json:"status"`
		RiskScore    *int    `json:"riskScore"`
		RiskCategory *string `json:"riskCategory"`
	}
	c.ShouldBindJSON(&req)

	query := "UPDATE users SET updated_at = NOW()"
	args := []interface{}{}
	argNum := 1

	if req.KycLevel != nil {
		query += fmt.Sprintf(", kyc_level = $%d", argNum)
		args = append(args, *req.KycLevel)
		argNum++
	}
	if req.Status != nil {
		query += fmt.Sprintf(", status = $%d", argNum)
		args = append(args, *req.Status)
		argNum++
	}
	if req.RiskScore != nil {
		query += fmt.Sprintf(", risk_score = $%d", argNum)
		args = append(args, *req.RiskScore)
		argNum++
	}
	if req.RiskCategory != nil {
		query += fmt.Sprintf(", risk_category = $%d", argNum)
		args = append(args, *req.RiskCategory)
		argNum++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argNum)
	args = append(args, userID)

	_, err := models.Pool.Exec(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}

	// Log action
	models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_USER", "users", userID, gin.H{
		"kycLevel": req.KycLevel, "status": req.Status, "riskScore": req.RiskScore,
	})

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "User updated"}})
}

func DeleteUser(c *gin.Context) {
	adminID := checkAdminPermission(c, "users")
	if adminID == "" {
		return
	}

	userID := c.Param("userId")

	_, err := models.Pool.Exec(c.Request.Context(), "UPDATE users SET status = 'deleted' WHERE id = $1", userID)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Delete failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "DELETE_USER", "users", userID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "User deleted"}})
}

func ForceResetPassword(c *gin.Context) {
	adminID := checkAdminPermission(c, "users")
	if adminID == "" {
		return
	}

	userID := c.Param("userId")

	var req struct {
		NewPassword string `json:"newPassword" binding:"required"`
	}
	c.ShouldBindJSON(&req)

	salt := models.GenerateSalt()
	newHash, _ := bcrypt.GenerateFromPassword([]byte(req.NewPassword+salt), bcrypt.DefaultCost)

	_, err := models.Pool.Exec(c.Request.Context(),
		"UPDATE users SET password_hash = $1, password_salt = $2 WHERE id = $3", string(newHash), salt, userID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Reset failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "RESET_PASSWORD", "users", userID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Password reset"}})
}

// ============ ADMIN MANAGEMENT ============

func CreateAdmin(c *gin.Context) {
	adminID := checkAdminPermission(c, "admins")
	if adminID == "" {
		return
	}

	var req struct {
		Username    string   `json:"username" binding:"required"`
		Email       string   `json:"email" binding:"required"`
		Password    string   `json:"password" binding:"required"`
		Role        string   `json:"role"`
		Permissions []string `json:"permissions"`
	}
	c.ShouldBindJSON(&req)

	if req.Role == "" {
		req.Role = "admin"
	}
	if req.Permissions == nil {
		req.Permissions = []string{}
	}

	salt := models.GenerateSalt()
	pwHash, _ := bcrypt.GenerateFromPassword([]byte(req.Password+salt), bcrypt.DefaultCost)

	newAdminID := uuid.New()
	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO admins (id, username, email, password_hash, password_salt, role, status, permissions, super_admin_id)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
	`, newAdminID, req.Username, req.Email, string(pwHash), salt, req.Role, req.Permissions, adminID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create admin"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_ADMIN", "admins", newAdminID.String(), nil)

	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": newAdminID, "message": "Admin created"}})
}

func UpdateAdmin(c *gin.Context) {
	adminID := checkAdminPermission(c, "admins")
	if adminID == "" {
		return
	}

	targetID := c.Param("adminId")

	var req struct {
		Role        *string   `json:"role"`
		Status      *string   `json:"status"`
		Permissions *[]string `json:"permissions"`
	}
	c.ShouldBindJSON(&req)

	query := "UPDATE admins SET updated_at = NOW()"
	args := []interface{}{}
	argNum := 1

	if req.Role != nil {
		query += fmt.Sprintf(", role = $%d", argNum)
		args = append(args, *req.Role)
		argNum++
	}
	if req.Status != nil {
		query += fmt.Sprintf(", status = $%d", argNum)
		args = append(args, *req.Status)
		argNum++
	}
	if req.Permissions != nil {
		query += fmt.Sprintf(", permissions = $%d", argNum)
		args = append(args, req.Permissions)
		argNum++
	}

	query += fmt.Sprintf(", super_admin_id = $%d WHERE id = $%d", argNum, argNum+1)
	args = append(args, adminID, targetID)

	_, err := models.Pool.Exec(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_ADMIN", "admins", targetID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Admin updated"}})
}

func DeleteAdmin(c *gin.Context) {
	adminID := checkAdminPermission(c, "admins")
	if adminID == "" {
		return
	}

	targetID := c.Param("adminId")

	if targetID == adminID {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Cannot delete yourself"}})
		return
	}

	_, err := models.Pool.Exec(c.Request.Context(), "UPDATE admins SET status = 'deleted' WHERE id = $1", targetID)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Delete failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "DELETE_ADMIN", "admins", targetID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Admin deleted"}})
}

func GetAllAdmins(c *gin.Context) {
	adminID := checkAdminPermission(c, "admins")
	if adminID == "" {
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, username, email, role, status, permissions, created_at, last_login_at
		FROM admins WHERE status != 'deleted' ORDER BY created_at DESC
	`)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	admins := []gin.H{}
	for rows.Next() {
		var a gin.H
		rows.Scan(&a["id"], &a["username"], &a["email"], &a["role"], &a["status"],
			&a["permissions"], &a["createdAt"], &a["lastLoginAt"])
		admins = append(admins, a)
	}

	c.JSON(200, gin.H{"success": true, "data": admins})
}

// ============ KYC MANAGEMENT ============

func GetAllKYCDocuments(c *gin.Context) {
	adminID := checkAdminPermission(c, "kyc")
	if adminID == "" {
		return
	}

	status := c.Query("status")

	query := `SELECT k.id, k.user_id, u.username, k.document_type, k.document_number, 
			  k.status, k.created_at, k.updated_at
		  FROM kyc_documents k
		  LEFT JOIN users u ON k.user_id = u.id WHERE 1=1`
	args := []interface{}{}

	if status != "" {
		query += " AND k.status = $1"
		args = append(args, status)
	}

	query += " ORDER BY k.created_at DESC LIMIT 100"

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	documents := []gin.H{}
	for rows.Next() {
		var d gin.H
		rows.Scan(&d["id"], &d["userId"], &d["username"], &d["documentType"],
			&d["documentNumber"], &d["status"], &d["createdAt"], &d["updatedAt"])
		documents = append(documents, d)
	}

	c.JSON(200, gin.H{"success": true, "data": documents})
}

func ApproveKYC(c *gin.Context) {
	adminID := checkAdminPermission(c, "kyc")
	if adminID == "" {
		return
	}

	docID := c.Param("docId")

	var req struct {
		Status string `json:"status" binding:"required,oneof=approved rejected"`
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&req)

	// Update KYC document
	_, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE kyc_documents SET status = $1, reject_reason = $2, updated_at = NOW() WHERE id = $3
	`, req.Status, req.Reason, docID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}

	// Update user KYC level
	if req.Status == "approved" {
		var userID string
		models.Pool.QueryRow(c.Request.Context(), "SELECT user_id FROM kyc_documents WHERE id = $1", docID).Scan(&userID)
		if userID != "" {
			_, _ = models.Pool.Exec(c.Request.Context(), "UPDATE users SET kyc_level = 2 WHERE id = $1", userID)
		}
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_KYC", "kyc", docID, gin.H{"status": req.Status})

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "KYC " + req.Status}})
}

// ============ PAIRS MANAGEMENT ============

func GetAllPairs(c *gin.Context) {
	adminID := checkAdminPermission(c, "pairs")
	if adminID == "" {
		return
	}

	status := c.Query("status")
	search := c.Query("search")

	query := `SELECT id, symbol, base_currency, quote_currency, price_precision, 
			  quantity_precision, maker_fee, taker_fee, status, is_default, source_exchange, created_at
		  FROM market_pairs WHERE 1=1`
	args := []interface{}{}
	argNum := 1

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argNum)
		args = append(args, status)
		argNum++
	}
	if search != "" {
		query += fmt.Sprintf(" AND (symbol LIKE $%d OR base_currency LIKE $%d OR quote_currency LIKE $%d)", argNum, argNum, argNum)
		args = append(args, "%"+search+"%", "%"+search+"%", "%"+search+"%")
		argNum++
	}

	query += " ORDER BY created_at DESC"

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	pairs := []gin.H{}
	for rows.Next() {
		var p gin.H
		rows.Scan(&p["id"], &p["symbol"], &p["baseCurrency"], &p["quoteCurrency"],
			&p["pricePrecision"], &p["quantityPrecision"], &p["makerFee"], &p["takerFee"],
			&p["status"], &p["isDefault"], &p["sourceExchange"], &p["createdAt"])
		pairs = append(pairs, p)
	}

	c.JSON(200, gin.H{"success": true, "data": pairs})
}

func CreatePair(c *gin.Context) {
	adminID := checkAdminPermission(c, "pairs")
	if adminID == "" {
		return
	}

	var req struct {
		Symbol            string  `json:"symbol" binding:"required"`
		BaseCurrency      string  `json:"baseCurrency" binding:"required"`
		QuoteCurrency     string  `json:"quoteCurrency" binding:"required"`
		PricePrecision    int     `json:"pricePrecision"`
		QuantityPrecision int     `json:"quantityPrecision"`
		MakerFee          float64 `json:"makerFee"`
		TakerFee          float64 `json:"takerFee"`
		SourceExchange    string  `json:"sourceExchange"`
	}
	c.ShouldBindJSON(&req)

	if req.PricePrecision == 0 {
		req.PricePrecision = 8
	}
	if req.QuantityPrecision == 0 {
		req.QuantityPrecision = 8
	}
	if req.MakerFee == 0 {
		req.MakerFee = 0.001
	}
	if req.TakerFee == 0 {
		req.TakerFee = 0.001
	}

	pairID := uuid.New()
	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO market_pairs 
		(id, symbol, base_currency, quote_currency, price_precision, quantity_precision, 
		 maker_fee, taker_fee, status, source_exchange, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)
	`, pairID, req.Symbol, req.BaseCurrency, req.QuoteCurrency, req.PricePrecision, req.QuantityPrecision,
		req.MakerFee, req.TakerFee, req.SourceExchange, adminID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create pair"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_PAIR", "pairs", pairID.String(), nil)

	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": pairID, "message": "Pair created"}})
}

func UpdatePair(c *gin.Context) {
	adminID := checkAdminPermission(c, "pairs")
	if adminID == "" {
		return
	}

	pairID := c.Param("pairId")

	var req struct {
		PricePrecision    *int     `json:"pricePrecision"`
		QuantityPrecision *int     `json:"quantityPrecision"`
		MakerFee          *float64 `json:"makerFee"`
		TakerFee          *float64 `json:"takerFee"`
		Status            *string  `json:"status"`
	}
	c.ShouldBindJSON(&req)

	// Build update query dynamically
	updates := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argNum := 1

	if req.PricePrecision != nil {
		updates = append(updates, fmt.Sprintf("price_precision = $%d", argNum))
		args = append(args, *req.PricePrecision)
		argNum++
	}
	if req.QuantityPrecision != nil {
		updates = append(updates, fmt.Sprintf("quantity_precision = $%d", argNum))
		args = append(args, *req.QuantityPrecision)
		argNum++
	}
	if req.MakerFee != nil {
		updates = append(updates, fmt.Sprintf("maker_fee = $%d", argNum))
		args = append(args, *req.MakerFee)
		argNum++
	}
	if req.TakerFee != nil {
		updates = append(updates, fmt.Sprintf("taker_fee = $%d", argNum))
		args = append(args, *req.TakerFee)
		argNum++
	}
	if req.Status != nil {
		updates = append(updates, fmt.Sprintf("status = $%d", argNum))
		args = append(args, *req.Status)
		argNum++
	}

	query := "UPDATE market_pairs SET " + strings.Join(updates, ", ") + fmt.Sprintf(" WHERE id = $%d", argNum)
	args = append(args, pairID)

	_, err := models.Pool.Exec(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_PAIR", "pairs", pairID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Pair updated"}})
}

func DeletePair(c *gin.Context) {
	adminID := checkAdminPermission(c, "pairs")
	if adminID == "" {
		return
	}

	pairID := c.Param("pairId")

	_, err := models.Pool.Exec(c.Request.Context(), "UPDATE market_pairs SET status = 'deleted' WHERE id = $1", pairID)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Delete failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "DELETE_PAIR", "pairs", pairID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Pair deleted"}})
}

func ImportPairsFromCEX(c *gin.Context) {
	adminID := checkAdminPermission(c, "pairs")
	if adminID == "" {
		return
	}

	var req struct {
		Source string `json:"source" binding:"required,oneof=binance bybit okx kucoin gate huobi"`
	}
	c.ShouldBindJSON(&req)

	// Mock import from exchanges
	importPairs := map[string][]string{
		"binance": {"BTC-USDT", "ETH-USDT", "BNB-USDT", "SOL-USDT", "XRP-USDT", "ADA-USDT", "DOGE-USDT"},
		"bybit":   {"BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT"},
		"okx":     {"BTC-USDT", "ETH-USDT", "BNB-USDT", "SOL-USDT"},
		"kucoin":  {"BTC-USDT", "ETH-USDT", "KCS-USDT", "SOL-USDT"},
		"gate":    {"BTC-USDT", "ETH-USDT", "GT-USDT", "SOL-USDT"},
		"huobi":   {"BTC-USDT", "ETH-USDT", "HT-USDT", "SOL-USDT"},
	}

	pairs := importPairs[req.Source]
	imported := 0

	for _, symbol := range pairs {
		parts := strings.Split(symbol, "-")
		if len(parts) == 2 {
			pairID := uuid.New()
			_, err := models.Pool.Exec(c.Request.Context(), `
				INSERT INTO market_pairs (id, symbol, base_currency, quote_currency, source_exchange, created_by)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (symbol) DO NOTHING
			`, pairID, symbol, parts[0], parts[1], req.Source, adminID)

			if err == nil {
				imported++
			}
		}
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "IMPORT_PAIRS", "pairs", "", gin.H{
		"source": req.Source, "imported": imported,
	})

	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"imported": imported,
		"message":  fmt.Sprintf("Imported %d pairs from %s", imported, req.Source),
	}})
}

// ============ FEES MANAGEMENT ============

func CreateFeeStructure(c *gin.Context) {
	adminID := checkAdminPermission(c, "fees")
	if adminID == "" {
		return
	}

	var req struct {
		FeeType     string  `json:"feeType" binding:"required"`
		Currency    string  `json:"currency"`
		Tier        string  `json:"tier"`
		MakerFee    float64 `json:"makerFee"`
		TakerFee    float64 `json:"takerFee"`
		WithdrawFee float64 `json:"withdrawFee"`
		DepositFee  float64 `json:"depositFee"`
	}
	c.ShouldBindJSON(&req)

	feeID := uuid.New()
	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO fee_structures 
		(id, fee_type, currency, tier, maker_fee, taker_fee, withdraw_fee, deposit_fee, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, feeID, req.FeeType, req.Currency, req.Tier, req.MakerFee, req.TakerFee,
		req.WithdrawFee, req.DepositFee, adminID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create fee"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_FEE", "fees", feeID.String(), nil)

	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": feeID, "message": "Fee structure created"}})
}

func GetAllFeeStructures(c *gin.Context) {
	adminID := checkAdminPermission(c, "fees")
	if adminID == "" {
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, fee_type, currency, tier, maker_fee, taker_fee, withdraw_fee, deposit_fee, status
		FROM fee_structures ORDER BY created_at DESC
	`)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	fees := []gin.H{}
	for rows.Next() {
		var f gin.H
		rows.Scan(&f["id"], &f["feeType"], &f["currency"], &f["tier"],
			&f["makerFee"], &f["takerFee"], &f["withdrawFee"], &f["depositFee"], &f["status"])
		fees = append(fees, f)
	}

	c.JSON(200, gin.H{"success": true, "data": fees})
}

// ============ WITHDRAWALS MANAGEMENT ============

func GetAllWithdrawals(c *gin.Context) {
	adminID := checkAdminPermission(c, "withdrawals")
	if adminID == "" {
		return
	}

	status := c.Query("status")
	currency := c.Query("currency")

	query := `SELECT id, user_id, currency, amount, fee, status, to_address, network, 
			  created_at, completed_at
		  FROM transactions WHERE type = 'withdraw' AND 1=1`
	args := []interface{}{}
	argNum := 1

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argNum)
		args = append(args, status)
		argNum++
	}
	if currency != "" {
		query += fmt.Sprintf(" AND currency = $%d", argNum)
		args = append(args, currency)
		argNum++
	}

	query += " ORDER BY created_at DESC LIMIT 100"

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	withdrawals := []gin.H{}
	for rows.Next() {
		var w gin.H
		rows.Scan(&w["id"], &w["userId"], &w["currency"], &w["amount"], &w["fee"],
			&w["status"], &w["toAddress"], &w["network"], &w["createdAt"], &w["completedAt"])
		withdrawals = append(withdrawals, w)
	}

	c.JSON(200, gin.H{"success": true, "data": withdrawals})
}

func ProcessWithdrawal(c *gin.Context) {
	adminID := checkAdminPermission(c, "withdrawals")
	if adminID == "" {
		return
	}

	withdrawalID := c.Param("withdrawalId")

	var req struct {
		Action string `json:"action" binding:"required,oneof=approve reject process"`
		TxHash string `json:"txHash"`
	}
	c.ShouldBindJSON(&req)

	// Update withdrawal
	var status string
	if req.Action == "approve" || req.Action == "process" {
		status = "processing"
	} else {
		status = "rejected"
	}

	_, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE transactions SET status = $1, tx_hash = $2, completed_at = CASE WHEN $1 = 'completed' THEN NOW() END
		WHERE id = $3 AND type = 'withdraw'
	`, status, req.TxHash, withdrawalID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "PROCESS_WITHDRAWAL", "withdrawals", withdrawalID, gin.H{
		"action": req.Action, "txHash": req.TxHash,
	})

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Withdrawal " + req.Action}})
}

// ============ SUPPORT TICKETS ============

func GetAllTickets(c *gin.Context) {
	adminID := checkAdminPermission(c, "cs")
	if adminID == "" {
		return
	}

	status := c.Query("status")
	priority := c.Query("priority")

	query := `SELECT t.id, t.user_id, u.username, t.subject, t.description, t.priority, 
			  t.status, t.assigned_to, t.created_at, t.updated_at
		  FROM support_tickets t
		  LEFT JOIN users u ON t.user_id = u.id WHERE 1=1`
	args := []interface{}{}
	argNum := 1

	if status != "" {
		query += fmt.Sprintf(" AND t.status = $%d", argNum)
		args = append(args, status)
		argNum++
	}
	if priority != "" {
		query += fmt.Sprintf(" AND t.priority = $%d", argNum)
		args = append(args, priority)
		argNum++
	}

	query += " ORDER BY t.created_at DESC LIMIT 100"

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	tickets := []gin.H{}
	for rows.Next() {
		var t gin.H
		rows.Scan(&t["id"], &t["userId"], &t["username"], &t["subject"], &t["description"],
			&t["priority"], &t["status"], &t["assignedTo"], &t["createdAt"], &t["updatedAt"])
		tickets = append(tickets, t)
	}

	c.JSON(200, gin.H{"success": true, "data": tickets})
}

func RespondToTicket(c *gin.Context) {
	adminID := checkAdminPermission(c, "cs")
	if adminID == "" {
		return
	}

	ticketID := c.Param("ticketId")

	var req struct {
		Status   string `json:"status" binding:"required"`
		Reply    string `json:"reply"`
		AssignTo string `json:"assignTo"`
	}
	c.ShouldBindJSON(&req)

	updates := "updated_at = NOW()"
	args := []interface{}{}

	if req.Status != "" {
		updates += ", status = $1"
		args = append(args, req.Status)
	}
	if req.AssignTo != "" {
		updates += fmt.Sprintf(", assigned_to = $%d", len(args)+1)
		args = append(args, req.AssignTo)
	}

	query := "UPDATE support_tickets SET " + updates + " WHERE id = $1"
	args = append(args, ticketID)

	_, err := models.Pool.Exec(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "RESPOND_TICKET", "cs", ticketID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Ticket updated"}})
}

// ============ ANALYTICS ============

func GetAnalytics(c *gin.Context) {
	adminID := checkAdminPermission(c, "analytics")
	if adminID == "" {
		return
	}

	// Get various analytics
	stats := gin.H{}

	// Total users
	models.Pool.QueryRow(c.Request.Context(), "SELECT COUNT(*) FROM users").Scan(&stats["totalUsers"])

	// Active users
	models.Pool.QueryRow(c.Request.Context(), "SELECT COUNT(*) FROM users WHERE status = 'active'").Scan(&stats["activeUsers"])

	// Total trading volume 24h (mock)
	stats["volume24h"] = 150000000.0

	// Total deposits
	models.Pool.QueryRow(c.Request.Context(),
		"SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'deposit' AND created_at > NOW() - INTERVAL '24 hours'",
	).Scan(&stats["deposits24h"])

	// Total withdrawals
	models.Pool.QueryRow(c.Request.Context(),
		"SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'withdraw' AND created_at > NOW() - INTERVAL '24 hours'",
	).Scan(&stats["withdrawals24h"])

	// KYC pending
	models.Pool.QueryRow(c.Request.Context(), "SELECT COUNT(*) FROM kyc_documents WHERE status = 'pending'").Scan(&stats["kycPending"])

	// Support tickets open
	models.Pool.QueryRow(c.Request.Context(), "SELECT COUNT(*) FROM support_tickets WHERE status = 'open'").Scan(&stats["ticketsOpen"])

	models.LogAdminAction(adminID, c.GetString("admin_username"), "VIEW_ANALYTICS", "analytics", "", nil)

	c.JSON(200, gin.H{"success": true, "data": stats})
}

// ============ API MANAGEMENT ============

func GetAPIManagement(c *gin.Context) {
	adminID := checkAdminPermission(c, "api")
	if adminID == "" {
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, user_id, key_id, name, permissions, ip_whitelist, rate_limit, 
		       status, last_used_at, created_at
		FROM api_keys_management ORDER BY created_at DESC LIMIT 100
	`)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	keys := []gin.H{}
	for rows.Next() {
		var k gin.H
		rows.Scan(&k["id"], &k["userId"], &k["keyId"], &k["name"],
			&k["permissions"], &k["ipWhitelist"], &k["rateLimit"],
			&k["status"], &k["lastUsedAt"], &k["createdAt"])
		keys = append(keys, k)
	}

	c.JSON(200, gin.H{"success": true, "data": keys})
}

func RevokeAPIKey(c *gin.Context) {
	adminID := checkAdminPermission(c, "api")
	if adminID == "" {
		return
	}

	keyID := c.Param("keyId")

	_, err := models.Pool.Exec(c.Request.Context(),
		"UPDATE api_keys_management SET status = 'revoked' WHERE id = $1", keyID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Revoke failed"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "REVOKE_API_KEY", "api", keyID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "API key revoked"}})
}

// ============ TOKEN/NFT MANAGEMENT ============

func CreateToken(c *gin.Context) {
	adminID := checkAdminPermission(c, "token_create")
	if adminID == "" {
		return
	}

	var req struct {
		TokenName    string  `json:"tokenName" binding:"required"`
		TokenSymbol  string  `json:"tokenSymbol" binding:"required"`
		Blockchain   string  `json:"blockchain" binding:"required"`
		ContractAddr string  `json:"contractAddress" binding:"required"`
		TotalSupply  float64 `json:"totalSupply"`
		InitialPrice float64 `json:"initialPrice"`
		ListingFee   float64 `json:"listingFee"`
		ListingType  string  `json:"listingType"`
	}
	c.ShouldBindJSON(&req)

	tokenID := uuid.New()
	if req.ListingType == "" {
		req.ListingType = "standard"
	}

	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO token_listings 
		(id, token_name, token_symbol, blockchain, contract_address, total_supply, 
		 initial_price, listing_fee, status, listing_type, submitted_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
	`, tokenID, req.TokenName, req.TokenSymbol, req.Blockchain, req.ContractAddr,
		req.TotalSupply, req.InitialPrice, req.ListingFee, req.ListingType, adminID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create token"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_TOKEN", "tokens", tokenID.String(), nil)

	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": tokenID, "message": "Token created"}})
}

func CreateNFTCollection(c *gin.Context) {
	adminID := checkAdminPermission(c, "nft")
	if adminID == "" {
		return
	}

	var req struct {
		Name         string  `json:"name" binding:"required"`
		Symbol       string  `json:"symbol" binding:"required"`
		Blockchain   string  `json:"blockchain" binding:"required"`
		ContractAddr string  `json:"contractAddress"`
		RoyaltyFee   float64 `json:"royaltyFee"`
	}
	c.ShouldBindJSON(&req)

	nftID := uuid.New()
	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO nft_collections 
		(id, name, symbol, blockchain, contract_address, royalty_fee, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, nftID, req.Name, req.Symbol, req.Blockchain, req.ContractAddr, req.RoyaltyFee, adminID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create collection"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_NFT", "nft", nftID.String(), nil)

	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": nftID, "message": "NFT collection created"}})
}

// ============ CLOUD MINING ============

func CreateCloudMiningProduct(c *gin.Context) {
	adminID := checkAdminPermission(c, "cloud_mining")
	if adminID == "" {
		return
	}

	var req struct {
		Name          string  `json:"name" binding:"required"`
		Currency      string  `json:"currency" binding:"required"`
		DailyOutput   float64 `json:"dailyOutput" binding:"required"`
		PricePerTH    float64 `json:"pricePerTh" binding:"required"`
		MinInvestment float64 `json:"minInvestment"`
		MaxInvestment float64 `json:"maxInvestment"`
		Duration      int     `json:"duration"`
	}
	c.ShouldBindJSON(&req)

	if req.Duration == 0 {
		req.Duration = 365
	}

	productID := uuid.New()
	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO cloud_mining_products 
		(id, name, currency, daily_output, price_per_th, min_investment, max_investment, contract_duration, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, productID, req.Name, req.Currency, req.DailyOutput, req.PricePerTH,
		req.MinInvestment, req.MaxInvestment, req.Duration, adminID)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Failed to create product"}})
		return
	}

	models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_CLOUD_MINING", "cloud_mining", productID.String(), nil)

	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": productID, "message": "Cloud mining product created"}})
}

func GetCloudMiningProducts(c *gin.Context) {
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, name, currency, daily_output, price_per_th, min_investment, max_investment, 
		       contract_duration, status, created_at
		FROM cloud_mining_products ORDER BY created_at DESC
	`)

	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	products := []gin.H{}
	for rows.Next() {
		var p gin.H
		rows.Scan(&p["id"], &p["name"], &p["currency"], &p["dailyOutput"],
			&p["pricePerTh"], &p["minInvestment"], &p["maxInvestment"],
			&p["duration"], &p["status"], &p["createdAt"])
		products = append(products, p)
	}

	c.JSON(200, gin.H{"success": true, "data": products})
}

// ============ AUDIT LOG ============

func GetAuditLog(c *gin.Context) {
	adminID := getAdminID(c)
	if adminID == "" {
		return
	}

	limit := 100
	if l := c.Query("limit"); l != "" {
		limit, _ = strconv.Atoi(l)
	}

	adminUser := c.Query("admin")
	action := c.Query("action")
	resource := c.Query("resource")

	query := `SELECT id, admin_username, action, resource_type, resource_id, details, ip_address, created_at
		  FROM admin_audit_log WHERE 1=1`
	args := []interface{}{}
	argNum := 1

	if adminUser != "" {
		query += fmt.Sprintf(" AND admin_username = $%d", argNum)
		args = append(args, adminUser)
		argNum++
	}
	if action != "" {
		query += fmt.Sprintf(" AND action LIKE $%d", argNum)
		args = append(args, "%"+action+"%")
		argNum++
	}
	if resource != "" {
		query += fmt.Sprintf(" AND resource_type = $%d", argNum)
		args = append(args, resource)
		argNum++
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argNum)
	args = append(args, limit)

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()

	logs := []gin.H{}
	for rows.Next() {
		var l gin.H
		rows.Scan(&l["id"], &l["adminUsername"], &l["action"], &l["resourceType"],
			&l["resourceId"], &l["details"], &l["ipAddress"], &l["createdAt"])
		logs = append(logs, l)
	}

	c.JSON(200, gin.H{"success": true, "data": logs})
}

// ============ HELPER FUNCTIONS ============

func getAdminID(c *gin.Context) string {
	if id, exists := c.Get("admin_id"); exists {
		return id.(string)
	}
	return ""
}

func checkAdminPermission(c *gin.Context, permission string) string {
	adminID := getAdminID(c)
	if adminID == "" {
		c.JSON(401, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
		return ""
	}

	role := c.GetString("admin_role")

	// Super admin has full platform access; sub-admin roles are permission based.
	if role == models.RoleSuperAdmin {
		return adminID
	}

	permissions := c.GetString("admin_permissions")
	if !strings.Contains(permissions, permission) && !strings.Contains(permissions, models.PermFullAccess) {
		c.JSON(403, gin.H{"success": false, "error": gin.H{"code": 403, "message": "Permission denied"}})
		return ""
	}

	return adminID
}

func getUserWallets(userID string) ([]gin.H, error) {
	rows, err := models.Pool.Query(context.Background(), `
		SELECT currency, network, wallet_type, balance, locked, available
		FROM wallets WHERE user_id = $1
	`, userID)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	wallets := []gin.H{}
	for rows.Next() {
		var w gin.H
		rows.Scan(&w["currency"], &w["network"], &w["type"],
			&w["balance"], &w["locked"], &w["available"])
		wallets = append(wallets, w)
	}

	return wallets, nil
}

func GetUserKYC(userID string) (gin.H, error) {
	var kyc gin.H
	err := models.Pool.QueryRow(context.Background(), `
		SELECT id, document_type, document_number, status, created_at, updated_at
		FROM kyc_documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&kyc["id"], &kyc["documentType"], &kyc["documentNumber"],
		&kyc["status"], &kyc["createdAt"], &kyc["updatedAt"])

	if err != nil {
		return gin.H{"status": "none"}, nil
	}

	return kyc, nil
}
