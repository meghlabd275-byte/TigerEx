/**
 * Security Program Platform
 * 
 * Bug bounty, penetration testing, DDoS protection, WAF, SOC operations
 */

export enum VulnerabilitySeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info'
}

export class SecurityProgramPlatform {
  private vulnerabilities: Vulnerability[] = [];
  private bountyProgram: BountyProgram | null = null;

  /**
   * Submit vulnerability report
   */
  async submitReport(report: VulnerabilityReport): Promise<Vulnerability> {
    const vuln: Vulnerability = {
      id: `VULN-${Date.now()}`,
      title: report.title,
      severity: this.calculateSeverity(report),
      status: 'submitted',
      reporter: report.reporter,
      description: report.description,
      impact: report.impact,
      stepsToReproduce: report.steps,
      submittedAt: new Date()
    };

    this.vulnerabilities.push(vuln);
    return vuln;
  }

  /**
   * Award bounty for confirmed vulnerability
   */
  async awardBounty(vulnId: string, amount: number): Promise<void> {
    const vuln = this.vulnerabilities.find(v => v.id === vulnId);
    if (!vuln) throw new Error('Vulnerability not found');

    vuln.status = 'confirmed';
    vuln.bountyAwarded = amount;
    vuln.resolvedAt = new Date();
  }

  /**
   * Get active security disclosures
   */
  async getDisclosures(): Promise<SecurityDisclosure[]> {
    return this.vulnerabilities
      .filter(v => v.status === 'resolved' && v.public)
      .map(v => ({
        id: v.id,
        title: v.title,
        severity: v.severity,
        disclosedAt: v.resolvedAt!
      }));
  }

  /**
   * Configure bounty program
   */
  configureBountyProgram(config: BountyConfig): void {
    this.bountyProgram = {
      ...config,
      active: true
    };
  }

  private calculateSeverity(report: VulnerabilityReport): VulnerabilitySeverity {
    if (report.impact.includes('data breach')) return VulnerabilitySeverity.CRITICAL;
    if (report.impact.includes('financial loss')) return VulnerabilitySeverity.HIGH;
    if (report.impact.includes('service disruption')) return VulnerabilitySeverity.MEDIUM;
    return VulnerabilitySeverity.LOW;
  }
}

interface VulnerabilityReport {
  title: string;
  reporter: string;
  description: string;
  impact: string;
  steps: string[];
}

interface Vulnerability {
  id: string;
  title: string;
  severity: VulnerabilitySeverity;
  status: string;
  reporter: string;
  description: string;
  impact: string;
  stepsToReproduce: string[];
  bountyAwarded?: number;
  resolvedAt?: Date;
  submittedAt: Date;
  public?: boolean;
}

interface SecurityDisclosure {
  id: string;
  title: string;
  severity: VulnerabilitySeverity;
  disclosedAt: Date;
}

interface BountyProgram {
  active: boolean;
  scope: string[];
  rewards: Record<VulnerabilitySeverity, number>;
}

interface BountyConfig {
  scope: string[];
  rewards: Record<VulnerabilitySeverity, number>;
}

export { VulnerabilitySeverity };