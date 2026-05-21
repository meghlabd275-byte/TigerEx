/**
 * Utils Tests
 */

import { 
  round, floor, ceil, formatCurrency, formatPercent, 
  chunk, unique, groupBy, slugify, capitalize, 
  truncate, delay, retry, debounce, throttle 
} from '../common/utils';

describe('Number Utils', () => {
  test('round - basic', () => {
    expect(round(1.23456789, 2)).toBe(1.23);
  });

  test('floor - basic', () => {
    expect(floor(1.999, 2)).toBe(1.99);
  });

  test('ceil - basic', () => {
    expect(ceil(1.001, 2)).toBe(1.01);
  });
});

describe('Format Utils', () => {
  test('formatCurrency - basic', () => {
    expect(formatCurrency(1234.56)).toBe('1,234.56');
  });

  test('formatPercent - basic', () => {
    expect(formatPercent(0.1234)).toBe('12.34%');
  });
});

describe('Array Utils', () => {
  test('chunk - splits array', () => {
    expect(chunk([1,2,3,4,5], 2)).toEqual([[1,2], [3,4], [5]]);
  });

  test('unique - removes duplicates', () => {
    expect(unique([1,2,2,3,3,3])).toEqual([1,2,3]);
  });

  test('groupBy - groups by key', () => {
    const data = [{type:'a',val:1}, {type:'b',val:2}, {type:'a',val:3}];
    const grouped = groupBy(data, 'type');
    expect(grouped.a?.length).toBe(2);
    expect(grouped.b?.length).toBe(1);
  });
});

describe('String Utils', () => {
  test('slugify - converts to slug', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  test('capitalize - capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  test('truncate - truncates long string', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });
});

describe('Async Utils', () => {
  test('delay - resolves after time', async () => {
    const start = Date.now();
    await delay(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });

  test('retry - retries on failure', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'success';
    };
    
    const result = await retry(fn, { retries: 3, delay: 1 });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });
});