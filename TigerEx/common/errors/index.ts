/**
 * Error Handling System
 * 
 * Centralized error classes for the exchange
 */

export enum ErrorCode {
  // General errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // Trading errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ORDER_TYPE = 'INVALID_ORDER_TYPE',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_CLOSED = 'ORDER_CLOSED',
  PRICE_OUT_OF_RANGE = 'PRICE_OUT_OF_RANGE',
  QUANTITY_TOO_SMALL = 'QUANTITY_TOO_SMALL',
  LEVERAGE_TOO_HIGH = 'LEVERAGE_TOO_HIGH',
  
  // Account errors
  ACCOUNT_NOT_VERIFIED = 'ACCOUNT_NOT_VERIFIED',
  KYC_REQUIRED = 'KYC_REQUIRED',
  ACCOUNT_FROZEN = 'ACCOUNT_FROZEN',
  WITHDRAWAL_DISABLED = 'WITHDRAWAL_DISABLED',
  
  // Risk errors
  RISK_LIMIT_EXCEEDED = 'RISK_LIMIT_EXCEEDED',
  MARGIN_INSUFFICIENT = 'MARGIN_INSUFFICIENT',
  LIQUIDATION_IMMINENT = 'LIQUIDATION_IMMINENT',
  
  // System errors
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  MAINTENANCE_MODE = 'MAINTENANCE_MODE'
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: number = 500,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.metadata && { metadata: this.metadata })
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public field?: string) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, { field });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(ErrorCode.NOT_FOUND, `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(ErrorCode.UNAUTHORIZED, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(ErrorCode.FORBIDDEN, message, 403);
    this.name = 'ForbiddenError';
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(available: number, required: number) {
    super(ErrorCode.INSUFFICIENT_BALANCE, `Insufficient balance: ${available} < ${required}`, 400);
    this.name = 'InsufficientBalanceError';
  }
}

export class RiskLimitExceededError extends AppError {
  constructor(limit: string, current: number) {
    super(ErrorCode.RISK_LIMIT_EXCEEDED, `Risk limit exceeded: ${limit} (${current})`, 400);
    this.name = 'RiskLimitExceededError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded', 429);
    this.metadata = { retryAfter };
    this.name = 'RateLimitError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(ErrorCode.SERVICE_UNAVAILABLE, `Service unavailable: ${service}`, 503);
    this.name = 'ServiceUnavailableError';
  }
}

// Error handler middleware
export function errorHandler(err: Error) {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      ...(err.metadata && { metadata: err.metadata })
    };
  }
  
  // Unknown error
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
    statusCode: 500
  };
}

export { ErrorCode };