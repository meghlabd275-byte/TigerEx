/**
 * Health Endpoints
 * 
 * Health check and readiness probes
 */

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  latency?: number;
  message?: string;
}

export interface ReadinessStatus {
  ready: boolean;
  services: ServiceReady[];
}

export interface ServiceReady {
  name: string;
  ready: boolean;
  error?: string;
}

class HealthService {
  private startTime = Date.now();
  private version = '1.0.0';
  private checks: Map<string, HealthCheck> = new Map();
  
  // Health check - is service alive?
  async getHealth(): Promise<HealthStatus> {
    const checks = await this.runChecks();
    const hasErrors = checks.some(c => c.status === 'error');
    
    return {
      status: hasErrors ? 'unhealthy' : checks.some(c => c.status === 'warning') ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: this.version,
      checks
    };
  }
  
  // Readiness check - is service ready to accept traffic?
  async getReadiness(): Promise<ReadinessStatus> {
    const services = await this.checkServices();
    const allReady = services.every(s => s.ready);
    
    return {
      ready: allReady,
      services
    };
  }
  
  // Liveness probe
  isAlive(): boolean {
    return true;
  }
  
  private async runChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    
    // Database check
    const dbCheck = await this.checkDatabase();
    checks.push(dbCheck);
    
    // Redis check  
    const redisCheck = await this.checkRedis();
    checks.push(redisCheck);
    
    // Kafka check
    const kafkaCheck = await this.checkKafka();
    checks.push(kafkaCheck);
    
    return checks;
  }
  
  private async checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      // Simulate DB check
      return { name: 'database', status: 'ok', latency: Date.now() - start };
    } catch {
      return { name: 'database', status: 'error', message: 'Database unavailable' };
    }
  }
  
  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      // Simulate Redis check
      return { name: 'redis', status: 'ok', latency: Date.now() - start };
    } catch {
      return { name: 'redis', status: 'error', message: 'Redis unavailable' };
    }
  }
  
  private async checkKafka(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      // Simulate Kafka check
      return { name: 'kafka', status: 'ok', latency: Date.now() - start };
    } catch {
      return { name: 'kafka', status: 'error', message: 'Kafka unavailable' };
    }
  }
  
  private async checkServices(): Promise<ServiceReady[]> {
    return [
      { name: 'database', ready: true },
      { name: 'redis', ready: true },
      { name: 'kafka', ready: true },
      { name: 'message_queue', ready: true }
    ];
  }
  
  // Register custom check
  registerCheck(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }
}

export const healthService = new HealthService();
export { HealthService };