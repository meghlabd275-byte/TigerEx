/**
 * Health Tests
 */

import { healthService } from '../health';

describe('Health Service', () => {
  test('getHealth - returns status', async () => {
    const health = await healthService.getHealth();
    
    expect(health.status).toBeDefined();
    expect(health.timestamp).toBeDefined();
    expect(health.uptime).toBeGreaterThan(0);
    expect(health.version).toBeDefined();
    expect(health.checks).toBeInstanceOf(Array);
  });

  test('getReadiness - returns ready', async () => {
    const readiness = await healthService.getReadiness();
    
    expect(typeof readiness.ready).toBe('boolean');
    expect(readiness.services).toBeInstanceOf(Array);
  });

  test('isAlive - returns true', () => {
    expect(healthService.isAlive()).toBe(true);
  });
});