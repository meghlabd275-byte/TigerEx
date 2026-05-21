/**
 * Trading Tests
 */

import { ORDER_STATUS, ORDER_SIDE, ORDER_TYPE, OrderStatus, OrderSide, OrderType } from '../common/constants';

describe('Trading Constants', () => {
  test('ORDER_STATUS has all values', () => {
    expect(ORDER_STATUS.PENDING).toBe('pending');
    expect(ORDER_STATUS.OPEN).toBe('open');
    expect(ORDER_STATUS.FILLED).toBe('filled');
    expect(ORDER_STATUS.CANCELLED).toBe('cancelled');
  });

  test('ORDER_SIDE has buy and sell', () => {
    expect(ORDER_SIDE.BUY).toBe('buy');
    expect(ORDER_SIDE.SELL).toBe('sell');
  });

  test('ORDER_TYPE has all order types', () => {
    expect(ORDER_TYPE.MARKET).toBe('market');
    expect(ORDER_TYPE.LIMIT).toBe('limit');
    expect(ORDER_TYPE.STOP_MARKET).toBe('stop_market');
  });

  test('types are assignable', () => {
    const status: OrderStatus = ORDER_STATUS.OPEN;
    const side: OrderSide = ORDER_SIDE.BUY;
    const type: OrderType = ORDER_TYPE.LIMIT;
    
    expect(status).toBe('open');
    expect(side).toBe('buy');
    expect(type).toBe('limit');
  });
});

describe('Order Book Limits', () => {
  const { ORDER_BOOK, TRADING } = require('../common/constants');
  
  test('ORDER_BOOK has limits', () => {
    expect(ORDER_BOOK.MAX_ORDERS).toBe(5000);
    expect(ORDER_BOOK.MAX_PRICE_PRECISION).toBe(8);
  });

  test('TRADING has limits', () => {
    expect(TRADING.MIN_ORDER_VALUE).toBe(1);
    expect(TRADING.MAX_ORDER_VALUE).toBe(10000000);
  });
});