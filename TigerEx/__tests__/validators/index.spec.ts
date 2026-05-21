/**
 * Validators Tests
 */

import { userValidators, tradingValidators, walletValidators, validateAll } from '../common/validators';

describe('User Validators', () => {
  test('validate email - valid', () => {
    expect(() => userValidators.email('test@example.com')).not.toThrow();
  });

  test('validate email - invalid', () => {
    expect(() => userValidators.email('invalid')).toThrow();
  });

  test('validate password - strong', () => {
    expect(() => userValidators.password('Password1')).not.toThrow();
  });

  test('validate password - weak', () => {
    expect(() => userValidators.password('weak')).toThrow();
  });

  test('validate username - valid', () => {
    expect(() => userValidators.username('user_123')).not.toThrow();
  });
});

describe('Trading Validators', () => {
  test('validate order side - buy', () => {
    expect(() => tradingValidators.orderSide('buy')).not.toThrow();
  });

  test('validate order side - sell', () => {
    expect(() => tradingValidators.orderSide('SELL')).not.toThrow();
  });

  test('validate order side - invalid', () => {
    expect(() => tradingValidators.orderSide('invalid')).toThrow();
  });

  test('validate order type - valid', () => {
    expect(() => tradingValidators.orderType('limit')).not.toThrow();
  });

  test('validate price - valid', () => {
    expect(() => tradingValidators.price(50000)).not.toThrow();
  });

  test('validate quantity - valid', () => {
    expect(() => tradingValidators.quantity(1)).not.toThrow();
  });
});

describe('Wallet Validators', () => {
  test('validate address - valid', () => {
    expect(() => walletValidators.address('0x1234567890abcdef', 'ethereum')).not.toThrow();
  });

  test('validate amount - valid', () => {
    expect(() => walletValidators.amount(100)).not.toThrow();
  });

  test('validate amount - negative', () => {
    expect(() => walletValidators.amount(-10)).toThrow();
  });
});