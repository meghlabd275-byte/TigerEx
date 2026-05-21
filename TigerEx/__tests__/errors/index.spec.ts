/**
 * Error Tests
 */

import { 
  AppError, 
  ValidationError, 
  NotFoundError, 
  UnauthorizedError,
  InsufficientBalanceError,
  ErrorCode 
} from '../common/errors';

describe('Errors', () => {
  test('AppError serializes correctly', () => {
    const error = new AppError(ErrorCode.INTERNAL_ERROR, 'Test error', 500);
    const json = error.toJSON();
    
    expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(json.message).toBe('Test error');
  });

  test('ValidationError includes field', () => {
    const error = new ValidationError('Invalid email', 'email');
    const json = error.toJSON();
    
    expect(json.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(json.metadata?.field).toBe('email');
  });

  test('NotFoundError has 404 status', () => {
    const error = new NotFoundError('User');
    const json = error.toJSON();
    
    expect(json.statusCode).toBe(404);
    expect(json.message).toContain('not found');
  });

  test('UnauthorizedError has 401 status', () => {
    const error = new UnauthorizedError();
    const json = error.toJSON();
    
    expect(json.statusCode).toBe(401);
  });

  test('InsufficientBalanceError calculates correctly', () => {
    const error = new InsufficientBalanceError(100, 200);
    const json = error.toJSON();
    
    expect(json.statusCode).toBe(400);
    expect(json.message).toContain('100 < 200');
  });
});