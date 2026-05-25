/**
 * Token Launchpad (IDO/IEO/IFO Platform)
 * Launch new tokens with fair allocation
 */

import { EventEmitter } from 'events';

// ============================================================================
// LAUNCHPAD TYPES
// ============================================================================

export type LaunchType = 'IDO' | 'IEO' | 'IFO' | 'ILO';
export type LaunchStatus = 'upcoming' | 'registration' | 'live' | 'completed' | 'cancelled';
export type AllocationType = 'lottery' | 'fcfs' | 'weighted' | 'tiered';

// ============================================================================
// LAUNCHPAD PROJECT
// ============================================================================

export interface LaunchProject {
  id: string;
  name: string;
  symbol: string;
  description: string;
  website: string;
  whitepaper: string;
  logo: string;
  banner: string;
  
  // Tokenomics
  totalSupply: number;
  initialPrice: number;
  priceCurrency: string;
  
  // Launch details
  type: LaunchType;
  status: LaunchStatus;
  startTime: number;
  endTime: number;
  
  // Allocation
  allocationType: AllocationType;
  totalTokens: number;
  minAllocation: number;
  maxAllocation: number;
  
  // Funding
  hardCap: number;
  raised: number;
  acceptedCoins: string[];
  
  // Vesting
  tgePercent: number;
  vestingPeriods: number;  // Number of periods
  vestingDuration: number;  // Days between periods
  
  // Token Contract
  contractAddress: string;
  listingDex: string;
  listingPrice: number;
  
  // Metrics
  applicants: number;
  winners: number;
  totalRaised: number;
  
  // KYC/Whitelist
  kycRequired: boolean;
  countryRestrictions: string[];
}

// ============================================================================
// PARTICIPATION RECORD
// ============================================================================

export interface ParticipationRecord {
  id: string;
  userId: string;
  projectId: string;
  allocationRequested: number;
  allocationGranted: number;
  tokensToReceive: number;
  status: 'pending' | 'confirmed' | 'dropped' | 'received';
  tier: 'public' | 'whale' | 'shark' | 'dolphin' | 'fish';
  timestamp: number;
  paymentTx?: string;
  receivedTx?: string;
}

// ============================================================================
// LAUNCHPAD MANAGER
// ============================================================================

export class LaunchpadManager extends EventEmitter {
  private projects: Map<string, LaunchProject> = new Map();
  private participations: Map<string, ParticipationRecord[]> = new Map();
  private whitelists: Map<string, Set<string>> = new Map();
  
  // ============================================================================
  // CREATE PROJECT
  // ============================================================================

  async createProject(project: Omit<LaunchProject, 'id' | 'status' | 'raised' | 'applicants' | 'winners' | 'totalRaised'>): Promise<string> {
    const projectId = `launch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    const fullProject: LaunchProject = {
      ...project,
      id: projectId,
      status: 'upcoming',
      raised: 0,
      applicants: 0,
      winners: 0,
      totalRaised: 0,
    };
    
    this.projects.set(projectId, fullProject);
    this.participations.set(projectId, []);
    this.whitelists.set(projectId, new Set());
    
    return projectId;
  }

  // ============================================================================
  // UPDATE PROJECT STATUS
  // ============================================================================

  async updateStatus(projectId: string, status: LaunchStatus): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;
    
    project.status = status;
    
    this.emit('statusChanged', { projectId, status });
    return true;
  }

  // ============================================================================
  // WHITELIST USER
  // ============================================================================

  async whitelistUser(projectId: string, userId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;
    
    const whitelist = this.whitelists.get(projectId);
    whitelist?.add(userId);
    
    return true;
  }

  // ============================================================================
  // BATCH WHITELIST
  // ============================================================================

  async batchWhitelist(projectId: string, userIds: string[]): Promise<number> {
    const project = this.projects.get(projectId);
    if (!project) return 0;
    
    const whitelist = this.whitelists.get(projectId);
    let added = 0;
    
    for (const userId of userIds) {
      if (whitelist?.add(userId)) added++;
    }
    
    return added;
  }

  // ============================================================================
  // APPLY TO LAUNCH
  // ============================================================================

  async apply(projectId: string, userId: string, allocationRequested: number): Promise<{
    success: boolean;
    position?: number;
    allocated?: number;
  }> {
    const project = this.projects.get(projectId);
    if (!project) return { success: false };
    
    if (project.status !== 'registration' && project.status !== 'live') {
      return { success: false };
    }
    
    // Check KYC and whitelist
    if (project.kycRequired || project.allocationType === 'tiered') {
      const whitelist = this.whitelists.get(projectId);
      if (!whitelist?.has(userId)) {
        return { success: false }; // Not whitelisted
      }
    }
    
    // Calculate tier based on holdings (mock)
    const tier = this.calculateTier(allocationRequested);
    
    // Calculate allocation
    const allocation = this.calculateAllocation(project, tier, allocationRequested);
    
    const participation: ParticipationRecord = {
      id: `part_${Date.now()}`,
      userId,
      projectId,
      allocationRequested,
      allocationGranted: allocation,
      tokensToReceive: allocation / project.initialPrice,
      status: 'pending',
      tier,
      timestamp: Date.now(),
    };
    
    this.participations.get(projectId)?.push(participation);
    project.applicants++;
    
    return {
      success: true,
      position: project.applicants,
      allocated: allocation,
    };
  }

  // ============================================================================
  // CALCULATE TIER
  // ============================================================================

  private calculateTier(userHoldings: number): ParticipationRecord['tier'] {
    if (userHoldings >= 100000) return 'whale';
    if (userHoldings >= 50000) return 'shark';
    if (userHoldings >= 10000) return 'dolphin';
    if (userHoldings >= 1000) return 'fish';
    return 'public';
  }

  // ============================================================================
  // CALCULATE ALLOCATION
  // ============================================================================

  private calculateAllocation(
    project: LaunchProject,
    tier: ParticipationRecord['tier'],
    requested: number
  ): number {
    const tierMultipliers: Record<ParticipationRecord['tier'], number> = {
      whale: 10,
      shark: 5,
      dolphin: 2,
      fish: 1,
      public: 0.5,
    };
    
    const allocation = requested * tierMultipliers[tier];
    
    // Cap at max allocation
    return Math.min(allocation, project.maxAllocation);
  }

  // ============================================================================
  // CONFIRM PARTICIPATION
  // ============================================================================

  async confirmParticipation(projectId: string, userId: string, paymentTx: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;
    
    const parts = this.participations.get(projectId) || [];
    const participation = parts.find(p => p.userId === userId && p.status === 'pending');
    
    if (!participation) return false;
    
    participation.status = 'confirmed';
    participation.paymentTx = paymentTx;
    
    project.raised += participation.allocationGranted;
    project.totalRaised = project.raised;
    project.winners++;
    
    return true;
  }

  // ============================================================================
  // DISTRIBUTE TOKENS
  // ============================================================================

  async distributeTokens(projectId: string, userId: string, distributionTx: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project || project.status !== 'live') return false;
    
    const parts = this.participations.get(projectId) || [];
    const participation = parts.find(p => p.userId === userId && p.status === 'confirmed');
    
    if (!participation) return false;
    
    participation.status = 'received';
    participation.receivedTx = distributionTx;
    
    this.emit('tokensDistributed', { projectId, userId, amount: participation.tokensToReceive });
    
    return true;
  }

  // ============================================================================
  // GET PROJECT
  // ============================================================================

  getProject(projectId: string): LaunchProject | undefined {
    return this.projects.get(projectId);
  }

  getProjects(status?: LaunchStatus): LaunchProject[] {
    let projects = Array.from(this.projects.values());
    
    if (status) {
      projects = projects.filter(p => p.status === status);
    }
    
    return projects;
  }

  // ============================================================================
  // GET PARTICIPATION
  // ============================================================================

  getParticipation(projectId: string, userId: string): ParticipationRecord | undefined {
    return this.participations.get(projectId)?.find(p => p.userId === userId);
  }

  // ============================================================================
  // TRACK LISTING PRICE
  // ============================================================================

  async updateListingPrice(projectId: string, price: number): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;
    
    project.listingPrice = price;
    return true;
  }

  // ============================================================================
  // GET STATS
  // ============================================================================

  async getProjectStats(projectId: string): Promise<{
    applicants: number;
    averageAllocation: number;
    totalRaised: number;
    progress: number;
  }> {
    const project = this.projects.get(projectId);
    if (!project) return { applicants: 0, averageAllocation: 0, totalRaised: 0, progress: 0 };
    
    const parts = this.participations.get(projectId) || [];
    const avgAllocation = parts.reduce((sum, p) => sum + p.allocationGranted, 0) / parts.length;
    const progress = (project.raised / project.hardCap) * 100;
    
    return {
      applicants: project.applicants,
      averageAllocation: avgAllocation,
      totalRaised: project.raised,
      progress,
    };
  }
}

export default LaunchpadManager;