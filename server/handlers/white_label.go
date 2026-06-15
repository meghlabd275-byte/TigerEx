package handlers

import (
	"strings"

	"github.com/gin-gonic/gin"

	"tigerex/server/models"
)

type whiteLabelExchangeRequest struct {
	Name               string                 `json:"name" binding:"required"`
	Slug               string                 `json:"slug"`
	Status             string                 `json:"status"`
	Branding           map[string]interface{} `json:"branding"`
	Domains            []string               `json:"domains"`
	LiquiditySources   []string               `json:"liquiditySources"`
	TradingPairSources []string               `json:"tradingPairSources"`
	Infrastructure     map[string]interface{} `json:"infrastructure"`
	Modules            map[string]interface{} `json:"modules"`
	AdminPermissions   []string               `json:"adminPermissions"`
	DeploymentConfig   map[string]interface{} `json:"deploymentConfig"`
}

type whiteLabelOperationRequest struct {
	Reason         string                 `json:"reason"`
	Infrastructure map[string]interface{} `json:"infrastructure"`
	Config         map[string]interface{} `json:"config"`
}

func RegisterWhiteLabelRoutes(rg *gin.RouterGroup) {
	wl := rg.Group("/white-label")
	{
		wl.GET("/exchanges", ListWhiteLabelExchanges)
		wl.POST("/exchanges", CreateWhiteLabelExchange)
		wl.GET("/exchanges/:id", GetWhiteLabelExchange)
		wl.PUT("/exchanges/:id", UpdateWhiteLabelExchange)
		wl.DELETE("/exchanges/:id", DeleteWhiteLabelExchange)
		wl.POST("/exchanges/:id/deploy", DeployWhiteLabelExchange)
		wl.POST("/exchanges/:id/pause", PauseWhiteLabelExchange)
		wl.POST("/exchanges/:id/resume", ResumeWhiteLabelExchange)
		wl.POST("/exchanges/:id/halt", HaltWhiteLabelExchange)
		wl.PUT("/exchanges/:id/infrastructure", UpdateWhiteLabelInfrastructure)
		wl.GET("/analytics", GetWhiteLabelAnalytics)
	}
}

func ListWhiteLabelExchanges(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	status := c.Query("status")
	query := `SELECT id, name, slug, status, domains, liquidity_sources, trading_pair_sources, modules, deployed_at, created_at, updated_at FROM white_label_exchanges WHERE 1=1`
	args := []interface{}{}
	if status != "" {
		query += " AND status = $1"
		args = append(args, status)
	}
	query += " ORDER BY updated_at DESC LIMIT 200"
	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Database error"}})
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, name, slug, itemStatus, domains, liquiditySources, tradingPairSources, modules, deployedAt, createdAt, updatedAt interface{}
		if err := rows.Scan(&id, &name, &slug, &itemStatus, &domains, &liquiditySources, &tradingPairSources, &modules, &deployedAt, &createdAt, &updatedAt); err == nil {
			items = append(items, gin.H{"id": id, "name": name, "slug": slug, "status": itemStatus, "domains": domains, "liquiditySources": liquiditySources, "tradingPairSources": tradingPairSources, "modules": modules, "deployedAt": deployedAt, "createdAt": createdAt, "updatedAt": updatedAt})
		}
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "LIST_WHITE_LABEL_EXCHANGES", "white_label", "", gin.H{"count": len(items)})
	c.JSON(200, gin.H{"success": true, "data": items})
}

func CreateWhiteLabelExchange(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	var req whiteLabelExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}
	defaultsForWhiteLabel(&req)
	var id string
	err := models.Pool.QueryRow(c.Request.Context(), `
		INSERT INTO white_label_exchanges
		(name, slug, status, branding, domains, liquidity_sources, trading_pair_sources, infrastructure, modules, admin_permissions, deployment_config, created_by, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id
	`, req.Name, req.Slug, req.Status, req.Branding, req.Domains, req.LiquiditySources, req.TradingPairSources, req.Infrastructure, req.Modules, req.AdminPermissions, req.DeploymentConfig, adminID).Scan(&id)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Create failed"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_WHITE_LABEL_EXCHANGE", "white_label", id, gin.H{"name": req.Name, "slug": req.Slug})
	c.JSON(201, gin.H{"success": true, "data": gin.H{"id": id, "status": req.Status}})
}

func GetWhiteLabelExchange(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	item, err := fetchWhiteLabelExchange(c, c.Param("id"))
	if err != nil {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Exchange not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "VIEW_WHITE_LABEL_EXCHANGE", "white_label", c.Param("id"), nil)
	c.JSON(200, gin.H{"success": true, "data": item})
}

func UpdateWhiteLabelExchange(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	var req whiteLabelExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}
	defaultsForWhiteLabel(&req)
	id := c.Param("id")
	cmd, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE white_label_exchanges SET name=$1, slug=$2, status=$3, branding=$4, domains=$5, liquidity_sources=$6,
		trading_pair_sources=$7, infrastructure=$8, modules=$9, admin_permissions=$10, deployment_config=$11, updated_by=$12, updated_at=NOW()
		WHERE id=$13
	`, req.Name, req.Slug, req.Status, req.Branding, req.Domains, req.LiquiditySources, req.TradingPairSources, req.Infrastructure, req.Modules, req.AdminPermissions, req.DeploymentConfig, adminID, id)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Exchange not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_WHITE_LABEL_EXCHANGE", "white_label", id, gin.H{"name": req.Name, "status": req.Status})
	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": id, "status": req.Status}})
}

func DeleteWhiteLabelExchange(c *gin.Context) {
	changeWhiteLabelStatus(c, "deleted", "DELETE_WHITE_LABEL_EXCHANGE")
}
func PauseWhiteLabelExchange(c *gin.Context) {
	changeWhiteLabelStatus(c, "paused", "PAUSE_WHITE_LABEL_EXCHANGE")
}
func ResumeWhiteLabelExchange(c *gin.Context) {
	changeWhiteLabelStatus(c, "active", "RESUME_WHITE_LABEL_EXCHANGE")
}
func HaltWhiteLabelExchange(c *gin.Context) {
	changeWhiteLabelStatus(c, "halted", "HALT_WHITE_LABEL_EXCHANGE")
}

func DeployWhiteLabelExchange(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	var req whiteLabelOperationRequest
	_ = c.ShouldBindJSON(&req)
	id := c.Param("id")
	cmd, err := models.Pool.Exec(c.Request.Context(), `UPDATE white_label_exchanges SET status='deployed', deployment_config=COALESCE($1, deployment_config), updated_by=$2, deployed_at=NOW(), updated_at=NOW() WHERE id=$3`, req.Config, adminID, id)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Deploy failed"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Exchange not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "DEPLOY_WHITE_LABEL_EXCHANGE", "white_label", id, gin.H{"config": req.Config})
	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": id, "status": "deployed"}})
}

func UpdateWhiteLabelInfrastructure(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	var req whiteLabelOperationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}
	id := c.Param("id")
	cmd, err := models.Pool.Exec(c.Request.Context(), `UPDATE white_label_exchanges SET infrastructure=$1, updated_by=$2, updated_at=NOW() WHERE id=$3`, req.Infrastructure, adminID, id)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Infrastructure update failed"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Exchange not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_WHITE_LABEL_INFRASTRUCTURE", "white_label", id, gin.H{"infrastructure": req.Infrastructure})
	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": id, "message": "Infrastructure updated"}})
}

func GetWhiteLabelAnalytics(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermAnalytics)
	if adminID == "" {
		return
	}
	rows, err := models.Pool.Query(c.Request.Context(), `SELECT status, COUNT(*) FROM white_label_exchanges GROUP BY status`)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Analytics failed"}})
		return
	}
	defer rows.Close()
	byStatus := gin.H{}
	for rows.Next() {
		var status string
		var count int
		if rows.Scan(&status, &count) == nil {
			byStatus[status] = count
		}
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "VIEW_WHITE_LABEL_ANALYTICS", "white_label", "", nil)
	c.JSON(200, gin.H{"success": true, "data": gin.H{"byStatus": byStatus}})
}

func changeWhiteLabelStatus(c *gin.Context, status, action string) {
	adminID := checkAdminPermission(c, models.PermWhitelabelClients)
	if adminID == "" {
		return
	}
	var req whiteLabelOperationRequest
	_ = c.ShouldBindJSON(&req)
	id := c.Param("id")
	cmd, err := models.Pool.Exec(c.Request.Context(), `UPDATE white_label_exchanges SET status=$1, updated_by=$2, updated_at=NOW() WHERE id=$3`, status, adminID, id)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Operation failed"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Exchange not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), action, "white_label", id, gin.H{"status": status, "reason": req.Reason})
	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": id, "status": status}})
}

func defaultsForWhiteLabel(req *whiteLabelExchangeRequest) {
	if req.Slug == "" {
		req.Slug = strings.ToLower(strings.ReplaceAll(req.Name, " ", "-"))
	}
	if req.Status == "" {
		req.Status = "draft"
	}
	if req.Branding == nil {
		req.Branding = gin.H{"theme": "default", "logo": "", "primaryColor": "#f59e0b"}
	}
	if req.Infrastructure == nil {
		req.Infrastructure = gin.H{"region": "global", "scaling": "auto", "deploymentMode": "cex"}
	}
	if req.Modules == nil {
		req.Modules = gin.H{"tokenManagement": true, "marketMakerBots": true, "listingManagement": true, "wallets": true, "blockchains": true, "explorers": true, "cexDex": true, "brokerage": true, "nft": true, "institutional": true}
	}
	if req.DeploymentConfig == nil {
		req.DeploymentConfig = gin.H{"fullExchangeDeployment": true, "customDomains": req.Domains, "liquidityImport": req.LiquiditySources, "tradingPairImport": req.TradingPairSources}
	}
}

func fetchWhiteLabelExchange(c *gin.Context, id string) (gin.H, error) {
	var name, slug, status, branding, domains, liquiditySources, tradingPairSources, infrastructure, modules, adminPermissions, deploymentConfig, deployedAt, createdAt, updatedAt interface{}
	err := models.Pool.QueryRow(c.Request.Context(), `SELECT name, slug, status, branding, domains, liquidity_sources, trading_pair_sources, infrastructure, modules, admin_permissions, deployment_config, deployed_at, created_at, updated_at FROM white_label_exchanges WHERE id=$1`, id).Scan(&name, &slug, &status, &branding, &domains, &liquiditySources, &tradingPairSources, &infrastructure, &modules, &adminPermissions, &deploymentConfig, &deployedAt, &createdAt, &updatedAt)
	return gin.H{"id": id, "name": name, "slug": slug, "status": status, "branding": branding, "domains": domains, "liquiditySources": liquiditySources, "tradingPairSources": tradingPairSources, "infrastructure": infrastructure, "modules": modules, "adminPermissions": adminPermissions, "deploymentConfig": deploymentConfig, "deployedAt": deployedAt, "createdAt": createdAt, "updatedAt": updatedAt}, err
}
