/**
 * TigerEx Engine Router & Auto-Switcher
 * Routes traffic to correct engine with automatic failover
 */

import { EventEmitter } from 'events';

// ============================================================================
// ENGINE TYPES
// ============================================================================

export type EngineType = 'matching' | 'risk' | 'liquidation' | 'pricing';

export interface Engine {
  id: string;
  type: EngineType;
  language: 'typescript' | 'go' | 'rust' | 'cpp';
  status: 'active' | 'standby' | 'failed';
  weight: number;  // Load distribution weight
  tpsCapacity: number;
  currentTPS: number;
  latencyUs: number;  // Average latency in microseconds
  lastHealthCheck: number;
}

// ============================================================================
// TRAFFIC LEVELS
// ============================================================================

export type TrafficLevel = 'low' | 'medium' | 'high' | 'extreme';

// ============================================================================
// ENGINE ROUTER
// ============================================================================

export class EngineRouter extends EventEmitter {
  private engines: Map<string, Engine> = new Map();
  private healthCheckInterval: number = 5000;  // 5 seconds
  private maxFailuresBeforeSwitch: number = 3;
  private failureCount: Map<string, number> = new Map();

  // ============================================================================
  // REGISTER ENGINE
  // ============================================================================

  registerEngine(engine: Engine): void {
    this.engines.set(engine.id, engine);
    console.log(`[Router] Registered ${engine.type} engine: ${engine.id} (${engine.language})`);
  }

  // ============================================================================
  // ACTIVE ENGINES BY TYPE
  // ============================================================================

  getActiveEngines(type: EngineType): Engine[] {
    return Array.from(this.engines.values())
      .filter(e => e.type === type && e.status === 'active')
      .sort((a, b) => a.latencyUs - b.latencyUs);  // Lowest latency first
  }

  // ============================================================================
  // ROUTE REQUEST TO BEST ENGINE
  // ============================================================================

  route(type: EngineType, payload: any): { 
    success: boolean; 
    engine: Engine | null; 
    reason: string 
  } {
    const active = this.getActiveEngines(type);
    
    if (active.length === 0) {
      return { success: false, engine: null, reason: `No active ${type} engines` };
    }

    // Select based on current load and latency
    const selected = this.selectBestEngine(active);
    
    return { 
      success: true, 
      engine: selected, 
      reason: `Routed to ${selected.id}`
    };
  }

  // ============================================================================
  // SELECT BEST ENGINE
  // ============================================================================

  private selectBestEngine(engines: Engine[]): Engine {
    // Find engine with lowest latency and available capacity
    let best = engines[0];
    
    for (const engine of engines) {
      // Check if engine has capacity (current TPS < 80% of capacity)
      const utilization = engine.currentTPS / engine.tpsCapacity;
      
      if (utilization < 0.8 && engine.latencyUs < best.latencyUs) {
        best = engine;
      }
    }
    
    return best;
  }

  // ============================================================================
  // AUTO-FAILOVER LOGIC
  // ============================================================================

  async checkHealthAndFailover(): Promise<void> {
    for (const [id, engine] of this.engines) {
      const now = Date.now();
      
      // Skip if healthy and recently checked
      if (now - engine.lastHealthCheck < this.healthCheckInterval) {
        continue;
      }

      // Simulate health check (in production, ping actual engine)
      const isHealthy = await this.healthCheck(engine);
      
      if (isHealthy) {
        // Engine recovered
        if (engine.status === 'failed') {
          engine.status = 'standby';
          this.emit('engineRecovered', engine);
        }
        engine.lastHealthCheck = now;
        this.failureCount.set(id, 0);
      } else {
        // Engine failed
        const failures = (this.failureCount.get(id) || 0) + 1;
        this.failureCount.set(id, failures);
        
        if (failures >= this.maxFailuresBeforeSwitch) {
          engine.status = 'failed';
          this.emit('engineFailed', engine);
          
          // Trigger failover
          await this.failover(engine.type, id);
        }
      }
    }
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  private async healthCheck(engine: Engine): Promise<boolean> {
    // In production, pinger the engine endpoint
    // For now, simulate health check
    return engine.currentTPS < engine.tpsCapacity && engine.latencyUs > 0;
  }

  // ============================================================================
  // FAILOVER TO NEXT ENGINE
  // ============================================================================

  private async failover(type: EngineType, failedEngineId: string): Promise<boolean> {
    const alternatives = this.getActiveEngines(type)
      .filter(e => e.id !== failedEngineId);
    
    if (alternatives.length === 0) {
      this.emit('noFallbackAvailable', type);
      return false;
    }

    const newEngine = alternatives[0];
    newEngine.status = 'active';
    
    this.emit('failoverComplete', {
      type,
      from: failedEngineId,
      to: newEngine.id,
    });

    return true;
  }

  // ============================================================================
  // TRAFFIC LEVEL SWITCHING
  // ============================================================================

  selectEngineByTrafficLevel(type: EngineType, level: TrafficLevel): Engine | null {
    const active = this.getActiveEngines(type);
    if (active.length === 0) return null;

    // Map traffic level to requirements
    const requirements = {
      low: { maxTps: 10000, maxLatency: 10000 },       // Microseconds
      medium: { maxTps: 100000, maxLatency: 1000 },
      high: { maxTps: 1000000, maxLatency: 100 },
      extreme: { maxTps: 50000000, maxLatency: 10 },
    };

    const req = requirements[level];

    // Find engine meeting requirements
    for (const engine of active) {
      if (engine.tpsCapacity >= req.maxTps && engine.latencyUs <= req.maxLatency) {
        return engine;
      }
    }

    // Fallback to highest capacity
    return active.sort((a, b) => b.tpsCapacity - a.tpsCapacity)[0];
  }

  // ============================================================================
  // LOAD BALANCING (WEIGHTED ROUND ROBIN)
  // ============================================================================

  private roundRobinIndex: Map<EngineType, number> = new Map();

  routeWeightedRoundRobin(type: EngineType): Engine | null {
    const active = this.getActiveEngines(type);
    if (active.length === 0) return null;

    // Initialize index
    if (!this.roundRobinIndex.has(type)) {
      this.roundRobinIndex.set(type, 0);
    }

    let idx = this.roundRobinIndex.get(type)!;
    const engine = active[idx % active.length];

    // Update stats
    engine.currentTPS++;

    // Move to next weighted by capacity
    const weights = active.map(e => e.weight);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    idx = (idx + 1) % totalWeight;
    this.roundRobinIndex.set(type, idx);

    return engine;
  }

  // ============================================================================
  // UPDATE ENGINE STATS
  // ============================================================================

  updateStats(engineId: string, tps: number, latency: number): void {
    const engine = this.engines.get(engineId);
    if (engine) {
      engine.currentTPS = tps;
      engine.latencyUs = latency;
    }
  }

  // ============================================================================
  // GET ROUTING DECISION
  // ============================================================================

  getRoutingDecision(type: EngineType, currentTPS: number): {
    engine: string;
    strategy: string;
  } {
    // Decide based on current load
    if (currentTPS < 10000) {
      return { engine: 'typescript', strategy: 'direct' };
    } else if (currentTPS < 100000) {
      return { engine: 'go', strategy: 'load-balance' };
    } else if (currentTPS < 1000000) {
      return { engine: 'cpp-production', strategy: 'failover-ready' };
    } else {
      return { engine: 'ultra-low-latency', strategy: 'maximum-performance' };
    }
  }
}

// ============================================================================
// ENGINE MANAGER (CREATES DEFAULT ENGINES)
// ============================================================================

export class EngineManager {
  router: EngineRouter;

  constructor() {
    this.router = new EngineRouter();
    this.initDefaultEngines();
  }

  private initDefaultEngines(): void {
    // Matching Engines (5)
    this.router.registerEngine({
      id: 'typescript-matching',
      type: 'matching',
      language: 'typescript',
      status: 'active',
      weight: 1,
      tpsCapacity: 10000,
      currentTPS: 0,
      latencyUs: 5000,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'go-matching',
      type: 'matching',
      language: 'go',
      status: 'standby',
      weight: 5,
      tpsCapacity: 100000,
      currentTPS: 0,
      latencyUs: 500,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'cpp-production',
      type: 'matching',
      language: 'cpp',
      status: 'standby',
      weight: 10,
      tpsCapacity: 1000000,
      currentTPS: 0,
      latencyUs: 50,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'ultra-low-latency',
      type: 'matching',
      language: 'cpp',
      status: 'standby',
      weight: 20,
      tpsCapacity: 50000000,
      currentTPS: 0,
      latencyUs: 1,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'fpga-match',
      type: 'matching',
      language: 'cpp',
      status: 'standby',
      weight: 50,
      tpsCapacity: 100000000,
      currentTPS: 0,
      latencyUs: 0.1,
      lastHealthCheck: Date.now(),
    });

    // Risk Engines (3)
    this.router.registerEngine({
      id: 'typescript-risk',
      type: 'risk',
      language: 'typescript',
      status: 'active',
      weight: 1,
      tpsCapacity: 5000,
      currentTPS: 0,
      latencyUs: 10000,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'python-quant',
      type: 'risk',
      language: 'python',
      status: 'standby',
      weight: 3,
      tpsCapacity: 1000,
      currentTPS: 0,
      latencyUs: 50000,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'rust-risk',
      type: 'risk',
      language: 'rust',
      status: 'standby',
      weight: 10,
      tpsCapacity: 500000,
      currentTPS: 0,
      latencyUs: 10,
      lastHealthCheck: Date.now(),
    });

    this.router.registerEngine({
      id: 'cpp-liquidation',
      type: 'liquidation',
      language: 'cpp',
      status: 'active',
      weight: 10,
      tpsCapacity: 1000000,
      currentTPS: 0,
      latencyUs: 5,
      lastHealthCheck: Date.now(),
    });

    // ===== UPGRADE 1: GEO-DISTRIBUTED MATCHING ENGINES =====
    // Europe Matching (for EU customers)
    this.router.registerEngine({
      id: 'eu-matching',
      type: 'matching',
      language: 'cpp',
      status: 'standby',
      weight: 15,
      tpsCapacity: 25000000,
      currentTPS: 0,
      latencyUs: 2,
      lastHealthCheck: Date.now(),
    });

    // Asia-Pacific Matching (for Asian customers)
    this.router.registerEngine({
      id: 'apac-matching',
      type: 'matching',
      language: 'cpp',
      status: 'standby',
      weight: 15,
      tpsCapacity: 25000000,
      currentTPS: 0,
      latencyUs: 2,
      lastHealthCheck: Date.now(),
    });

    // US-East Matching (for US customers)
    this.router.registerEngine({
      id: 'useast-matching',
      type: 'matching',
      language: 'cpp',
      status: 'standby',
      weight: 15,
      tpsCapacity: 25000000,
      currentTPS: 0,
      latencyUs: 2,
      lastHealthCheck: Date.now(),
    });

    // ===== UPGRADE 2: ADDITIONAL RISK ENGINES =====
    // Real-time Rust risk engine
    this.router.registerEngine({
      id: 'rust-risk-realtime',
      type: 'risk',
      language: 'rust',
      status: 'standby',
      weight: 15,
      tpsCapacity: 750000,
      currentTPS: 0,
      latencyUs: 5,
      lastHealthCheck: Date.now(),
    });

    // GPU-accelerated risk engine
    this.router.registerEngine({
      id: 'gpu-risk',
      type: 'risk',
      language: 'cpp',
      status: 'standby',
      weight: 20,
      tpsCapacity: 2000000,
      currentTPS: 0,
      latencyUs: 1,
      lastHealthCheck: Date.now(),
    });

    // ===== UPGRADE 3: ADDITIONAL LIQUIDATION ENGINES =====
    // Hot backup liquidation
    this.router.registerEngine({
      id: 'liquidation-hot-backup',
      type: 'liquidation',
      language: 'cpp',
      status: 'standby',
      weight: 8,
      tpsCapacity: 1000000,
      currentTPS: 0,
      latencyUs: 5,
      lastHealthCheck: Date.now(),
    });

    // Cold storage liquidation (slow but reliable)
    this.router.registerEngine({
      id: 'liquidation-cold',
      type: 'liquidation',
      language: 'rust',
      status: 'standby',
      weight: 5,
      tpsCapacity: 500000,
      currentTPS: 0,
      latencyUs: 50,
      lastHealthCheck: Date.now(),
    });
  }

  // Get engine counts by type (UPGRADED)
  getEngineCounts(): { matching: number; risk: number; liquidation: number; total: number } {
    const all = Array.from(this.router.engines.values());
    return {
      matching: all.filter(e => e.type === 'matching').length,
      risk: all.filter(e => e.type === 'risk').length,
      liquidation: all.filter(e => e.type === 'liquidation').length,
      total: all.length,
    };
  }

  // Start health checks
  startHealthChecks(): void {
    setInterval(() => {
      this.router.checkHealthAndFailover();
    }, 5000);
  }
}

export default EngineManager;