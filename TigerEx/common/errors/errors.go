package common

import (
	"encoding/json"
	"fmt"
)

// Error codes
const (
	ErrInternalError     = "INTERNAL_ERROR"
	ErrValidationError  = "VALIDATION_ERROR"
	ErrNotFound       = "NOT_FOUND"
	ErrUnauthorized   = "UNAUTHORIZED"
	ErrForbidden     = "FORBIDDEN"

	ErrInsufficientBalance = "INSUFFICIENT_BALANCE"
	ErrInvalidOrderType   = "INVALID_ORDER_TYPE"
	ErrOrderNotFound    = "ORDER_NOT_FOUND"
	ErrOrderClosed     = "ORDER_CLOSED"
	ErrPriceOutRange  = "PRICE_OUT_OF_RANGE"
	ErrQtyTooSmall   = "QUANTITY_TOO_SMALL"
	ErrLeverageHigh   = "LEVERAGE_TOO_HIGH"

	ErrAccountNotVerified = "ACCOUNT_NOT_VERIFIED"
	ErrKYCRequired   = "KYC_REQUIRED"
	ErrAccountFrozen = "ACCOUNT_FROZEN"
	ErrWithdrawalDisabled = "WITHDRAWAL_DISABLED"

	ErrRiskLimitExceeded = "RISK_LIMIT_EXCEEDED"
	ErrMarginInsufficient = "MARGIN_INSUFFICIENT"
	ErrLiquidationImminent = "LIQUIDATION_IMMINENT"

	ErrServiceUnavailable = "SERVICE_UNAVAILABLE"
	ErrRateLimitExceeded = "RATE_LIMIT_EXCEEDED"
	ErrMaintenanceMode = "MAINTENANCE_MODE"
)

// ErrorCode type
type ErrorCode string

// AppError main error type
type AppError struct {
	Code       ErrorCode              `json:"code"`
	Message   string               `json:"message"`
	StatusCode int                  `json:"-"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

func (e *AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *AppError) ToJSON() map[string]interface{} {
	result := map[string]interface{}{
		"code":    e.Code,
		"message": e.Message,
	}
	if e.Metadata != nil {
		result["metadata"] = e.Metadata
	}
	return result
}

func (e *AppError) MarshalJSON() ([]byte, error) {
	return json.Marshal(e.ToJSON())
}

// NewAppError creates a new AppError
func NewAppError(code ErrorCode, message string, statusCode int, metadata map[string]interface{}) *AppError {
	return &AppError{
		Code:       code,
		Message:    message,
		StatusCode: statusCode,
		Metadata:  metadata,
	}
}

// ValidationError for input validation failures
type ValidationError struct {
	*AppError
	Field string `json:"field,omitempty"`
}

func NewValidationError(message, field string) *ValidationError {
	return &ValidationError{
		AppError: NewAppError(ErrValidationError, message, 400, map[string]interface{}{"field": field}),
		Field:   field,
	}
}

func (e *ValidationError) Error() string {
	return e.Message
}

// NotFoundError for missing resources
type NotFoundError struct {
	*AppError
	Resource string `json:"resource,omitempty"`
}

func NewNotFoundError(resource string) *NotFoundError {
	return &NotFoundError{
		AppError:  NewAppError(ErrNotFound, resource+" not found", 404, nil),
		Resource: resource,
	}
}

func (e *NotFoundError) Error() string {
	return e.Message
}

// UnauthorizedError for auth failures
type UnauthorizedError struct {
	*AppError
}

func NewUnauthorizedError(message string) *UnauthorizedError {
	msg := message
	if msg == "" {
		msg = "Unauthorized"
	}
	return &UnauthorizedError{
		AppError: NewAppError(ErrUnauthorized, msg, 401, nil),
	}
}

func (e *UnauthorizedError) Error() string {
	return e.Message
}

// ForbiddenError for permission failures
type ForbiddenError struct {
	*AppError
}

func NewForbiddenError(message string) *ForbiddenError {
	msg := message
	if msg == "" {
		msg = "Forbidden"
	}
	return &ForbiddenError{
		AppError: NewAppError(ErrForbidden, msg, 403, nil),
	}
}

func (e *ForbiddenError) Error() string {
	return e.Message
}

// InsufficientBalanceError for trades lacking funds
type InsufficientBalanceError struct {
	*AppError
	Available float64 `json:"available"`
	Required float64 `json:"required"`
}

func NewInsufficientBalanceError(available, required float64) *InsufficientBalanceError {
	return &InsufficientBalanceError{
		AppError: NewAppError(
			ErrInsufficientBalance,
			fmt.Sprintf("Insufficient balance: %.8f < %.8f", available, required),
			400,
			map[string]interface{}{"available": available, "required": required},
		),
		Available: available,
		Required: required,
	}
}

func (e *InsufficientBalanceError) Error() string {
	return e.Message
}

// RiskLimitExceededError for risk limit breaches
type RiskLimitExceededError struct {
	*AppError
	Limit  string  `json:"limit"`
	Current float64 `json:"current"`
}

func NewRiskLimitExceededError(limit string, current float64) *RiskLimitExceededError {
	return &RiskLimitExceededError{
		AppError: NewAppError(
			ErrRiskLimitExceeded,
			fmt.Sprintf("Risk limit exceeded: %s (%.8f)", limit, current),
			400,
			map[string]interface{}{"limit": limit, "current": current},
		),
		Limit:  limit,
		Current: current,
	}
}

func (e *RiskLimitExceededError) Error() string {
	return e.Message
}

// RateLimitError for rate limiting
type RateLimitError struct {
	*AppError
	RetryAfter int `json:"retryAfter,omitempty"`
}

func NewRateLimitError(retryAfter int) *RateLimitError {
	metadata := map[string]interface{}{}
	if retryAfter > 0 {
		metadata["retryAfter"] = retryAfter
	}
	return &RateLimitError{
		AppError:   NewAppError(ErrRateLimitExceeded, "Rate limit exceeded", 429, metadata),
		RetryAfter: retryAfter,
	}
}

func (e *RateLimitError) Error() string {
	return e.Message
}

// ServiceUnavailableError for service downtime
type ServiceUnavailableError struct {
	*AppError
	Service string `json:"service,omitempty"`
}

func NewServiceUnavailableError(service string) *ServiceUnavailableError {
	return &ServiceUnavailableError{
		AppError:  NewAppError(ErrServiceUnavailable, "Service unavailable: "+service, 503, nil),
		Service: service,
	}
}

func (e *ServiceUnavailableError) Error() string {
	return e.Message
}

// ErrorHandler converts errors to JSON-friendly format
func ErrorHandler(err error) map[string]interface{} {
	switch e := err.(type) {
	case *AppError:
		return e.ToJSON()
	case *ValidationError:
		return e.AppError.ToJSON()
	case *NotFoundError:
		return e.AppError.ToJSON()
	case *UnauthorizedError:
		return e.AppError.ToJSON()
	case *ForbiddenError:
		return e.AppError.ToJSON()
	case *InsufficientBalanceError:
		return e.AppError.ToJSON()
	case *RiskLimitExceededError:
		return e.AppError.ToJSON()
	case *RateLimitError:
		return e.AppError.ToJSON()
	case *ServiceUnavailableError:
		return e.AppError.ToJSON()
	default:
		return map[string]interface{}{
			"code":      ErrInternalError,
			"message":   "Internal server error",
			"statusCode": 500,
		}
	}
}