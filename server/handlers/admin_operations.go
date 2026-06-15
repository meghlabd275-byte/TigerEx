package handlers

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tigerex/server/models"
)

var adminResourcePermissions = map[string]string{
	"liquidity":             models.PermLiquidityManagement,
	"cs":                    models.PermCSManagement,
	"iou":                   models.PermIOUManagement,
	"virtual-coins":         models.PermVirtualCoins,
	"market-maker-bots":     models.PermMarketMaker,
	"listings":              models.PermListingManagement,
	"whitelabel-clients":    models.PermWhitelabelClients,
	"whitelabel-wallets":    models.PermWhitelabelWallets,
	"block-explorers":       models.PermBlockExplorer,
	"cex-dex":               models.PermCEXDEXMgmt,
	"institutional-clients": models.PermInstitutional,
	"brokerage":             models.PermBrokerageMgmt,
	"multisend":             models.PermMultisend,
	"token-create":          models.PermTokenCreate,
	"cloud-mining-products": models.PermCloudMining,
	"withdrawal-rules":      models.PermWithdrawals,
}

var validAdminResourceActions = map[string]string{
	"suspend": "suspended", "halt": "halted", "start": "active", "stop": "stopped", "resume": "active", "remove": "removed",
}

type managedResourceRequest struct {
	Name           string                 `json:"name" binding:"required"`
	Status         string                 `json:"status"`
	SourceExchange string                 `json:"sourceExchange"`
	IntegrationRef string                 `json:"integrationRef"`
	Config         map[string]interface{} `json:"config"`
	Permissions    []string               `json:"permissions"`
}

func RegisterAdminOperationsRoutes(rg *gin.RouterGroup) {
	for resource := range adminResourcePermissions {
		base := "/operations/" + resource
		rg.GET(base, ListManagedResources(resource))
		rg.POST(base, CreateManagedResource(resource))
		rg.POST(base+"/import", ImportManagedResource(resource))
		rg.PUT(base+"/:id", UpdateManagedResource(resource))
		rg.DELETE(base+"/:id", DeleteManagedResource(resource))
		rg.POST(base+"/:id/:action", OperateManagedResource(resource))
	}
}

func ListManagedResources(resourceType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminID := checkAdminPermission(c, adminResourcePermissions[resourceType])
		if adminID == "" {
			return
		}
		status := c.Query("status")
		query := `SELECT id, name, status, source_exchange, integration_ref, config, permissions, created_at, updated_at FROM admin_managed_resources WHERE resource_type = $1`
		args := []interface{}{resourceType}
		if status != "" {
			query += " AND status = $2"
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
			var id, name, itemStatus, sourceExchange, integrationRef interface{}
			var config, permissions, createdAt, updatedAt interface{}
			if err := rows.Scan(&id, &name, &itemStatus, &sourceExchange, &integrationRef, &config, &permissions, &createdAt, &updatedAt); err == nil {
				items = append(items, gin.H{
					"id": id, "name": name, "status": itemStatus, "sourceExchange": sourceExchange,
					"integrationRef": integrationRef, "config": config, "permissions": permissions,
					"createdAt": createdAt, "updatedAt": updatedAt,
				})
			}
		}
		logManagedResourceAction(adminID, c, "LIST", resourceType, "", gin.H{"count": len(items)})
		c.JSON(200, gin.H{"success": true, "data": items})
	}
}

func CreateManagedResource(resourceType string) gin.HandlerFunc {
	return upsertManagedResource(resourceType, true, false)
}
func ImportManagedResource(resourceType string) gin.HandlerFunc {
	return upsertManagedResource(resourceType, true, true)
}
func UpdateManagedResource(resourceType string) gin.HandlerFunc {
	return upsertManagedResource(resourceType, false, false)
}

func upsertManagedResource(resourceType string, create bool, imported bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminID := checkAdminPermission(c, adminResourcePermissions[resourceType])
		if adminID == "" {
			return
		}
		var req managedResourceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
			return
		}
		if req.Status == "" {
			req.Status = "active"
		}
		if req.Config == nil {
			req.Config = map[string]interface{}{}
		}
		parsedID, _ := uuid.Parse(adminID)
		if create {
			var id string
			err := models.Pool.QueryRow(c.Request.Context(), `INSERT INTO admin_managed_resources (resource_type,name,status,source_exchange,integration_ref,config,permissions,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`, resourceType, req.Name, req.Status, req.SourceExchange, req.IntegrationRef, req.Config, req.Permissions, parsedID).Scan(&id)
			if err != nil {
				c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Create failed"}})
				return
			}
			action := "CREATE"
			if imported {
				action = "IMPORT"
			}
			logManagedResourceAction(adminID, c, action, resourceType, id, gin.H{"name": req.Name, "sourceExchange": req.SourceExchange})
			c.JSON(201, gin.H{"success": true, "data": gin.H{"id": id, "status": req.Status}})
			return
		}
		id := c.Param("id")
		_, err := models.Pool.Exec(c.Request.Context(), `UPDATE admin_managed_resources SET name=$1,status=$2,source_exchange=$3,integration_ref=$4,config=$5,permissions=$6,updated_by=$7,updated_at=NOW() WHERE id=$8 AND resource_type=$9`, req.Name, req.Status, req.SourceExchange, req.IntegrationRef, req.Config, req.Permissions, parsedID, id, resourceType)
		if err != nil {
			c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Update failed"}})
			return
		}
		logManagedResourceAction(adminID, c, "UPDATE", resourceType, id, gin.H{"name": req.Name})
		c.JSON(200, gin.H{"success": true, "data": gin.H{"id": id, "status": req.Status}})
	}
}

func DeleteManagedResource(resourceType string) gin.HandlerFunc {
	return func(c *gin.Context) { updateManagedResourceStatus(c, resourceType, "deleted", "DELETE") }
}

func OperateManagedResource(resourceType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		action := strings.ToLower(c.Param("action"))
		status, ok := validAdminResourceActions[action]
		if !ok {
			c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Unsupported action"}})
			return
		}
		updateManagedResourceStatus(c, resourceType, status, strings.ToUpper(action))
	}
}

func updateManagedResourceStatus(c *gin.Context, resourceType, status, action string) {
	adminID := checkAdminPermission(c, adminResourcePermissions[resourceType])
	if adminID == "" {
		return
	}
	id := c.Param("id")
	parsedID, _ := uuid.Parse(adminID)
	cmd, err := models.Pool.Exec(c.Request.Context(), `UPDATE admin_managed_resources SET status=$1,updated_by=$2,updated_at=NOW() WHERE id=$3 AND resource_type=$4`, status, parsedID, id, resourceType)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Operation failed"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(404, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Resource not found"}})
		return
	}
	logManagedResourceAction(adminID, c, action, resourceType, id, gin.H{"status": status})
	c.JSON(200, gin.H{"success": true, "data": gin.H{"id": id, "status": status}})
}

func logManagedResourceAction(adminID string, c *gin.Context, action, resourceType, resourceID string, details gin.H) {
	parsedID, err := uuid.Parse(adminID)
	if err != nil {
		fmt.Printf("ADMIN ACTION: %s %s %s\n", action, resourceType, resourceID)
		return
	}
	_ = models.LogAdminAction(parsedID, c.GetString("admin_username"), action+"_"+strings.ToUpper(strings.ReplaceAll(resourceType, "-", "_")), resourceType, resourceID, details)
}
