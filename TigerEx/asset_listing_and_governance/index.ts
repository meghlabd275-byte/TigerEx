/**
 * Asset Listing & Governance Platform
 * 
 * Comprehensive token listing workflow with due diligence,
 * ongoing monitoring, and delisting procedures.
 */

export enum ListingStatus {
  APPLICATION = 'application',
  DUE_DILIGENCE = 'due_diligence',
  TECHNICAL_AUDIT = 'technical_audit',
  LEGAL_REVIEW = 'legal_review',
  MARKET_PREP = 'market_prep',
  LISTED = 'listed',
  DELISTING = 'delisting',
  DELISTED = 'delisted'
}

export enum DelistingReason {
  LOW_VOLUME = 'low_volume',
  SECURITY_CONCERN = 'security_concern',
  REGULATORY = 'regulatory',
  PROJECT_ABANDONED = 'project_abandoned',
  FRAUD = 'fraud'
}

export class AssetListingGovernance {
  private assets: Map<string, ListedAsset> = new Map();
  private applications: ListingApplication[] = [];
  private delistingQueue: string[] = [];

  /**
   * Submit new token for listing
   */
  async submitApplication(input: ListingApplicationInput): Promise<ListingApplication> {
    const application: ListingApplication = {
      id: `APP-${Date.now()}`,
      projectName: input.projectName,
      tokenSymbol: input.tokenSymbol,
      tokenContract: input.tokenContract,
      chain: input.chain,
      status: ListingStatus.APPLICATION,
      submittedAt: new Date(),
      submittedBy: input.submittedBy,
      checklist: this.getDefaultChecklist(input.chain),
      timeline: [{
        stage: 'application',
        completedAt: new Date(),
        completedBy: input.submittedBy
      }]
    };

    this.applications.push(application);
    return application;
  }

  /**
   * Progress application through stages
   */
  async progressApplication(
    applicationId: string,
    newStatus: ListingStatus,
    completedBy: string,
    notes?: string
  ): Promise<void> {
    const app = this.applications.find(a => a.id === applicationId);
    if (!app) throw new Error('Application not found');

    app.status = newStatus;
    app.timeline.push({
      stage: newStatus,
      completedAt: new Date(),
      completedBy,
      notes
    });

    // Auto-progress when complete
    if (newStatus === ListingStatus.MARKET_PREP) {
      await this.approveListing(app);
    }
  }

  /**
   * Approve and list token
   */
  async approveListing(app: ListingApplication): Promise<ListedAsset> {
    const asset: ListedAsset = {
      assetId: `ASSET-${app.tokenSymbol}`,
      projectName: app.projectName,
      tokenSymbol: app.tokenSymbol,
      tokenContract: app.tokenContract,
      chain: app.chain,
      status: ListingStatus.LISTED,
      listedAt: new Date(),
      listingFees: {
        spot: 10000,  // BNB equivalent
        futures: 20000
      },
      marketMakerRequirement: {
        minVolume24h: 50000,
        minBidAskSpread: 0.001
      },
      monitoringEnabled: true,
      metadata: {}
    };

    this.assets.set(app.tokenSymbol, asset);
    return asset;
  }

  /**
   * Initiate delisting process
   */
  async initiateDelisting(
    tokenSymbol: string,
    reason: DelistingReason,
    initiatedBy: string
  ): Promise<void> {
    const asset = this.assets.get(tokenSymbol);
    if (!asset) throw new Error('Asset not found');

    asset.status = ListingStatus.DELISTING;
    asset.delistingReason = reason;
    asset.delistingAnnounced = new Date();
    asset.delistingDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    
    this.delistingQueue.push(tokenSymbol);
  }

  /**
   * Get asset risk score (monitoring)
   */
  async getAssetRiskScore(tokenSymbol: string): Promise<AssetRiskScore> {
    const asset = this.assets.get(tokenSymbol);
    if (!asset) throw new Error('Asset not found');

    // Simplified scoring based on metrics
    const volume24h = asset.volume24h || 0;
    const liquidity = asset.liquidity || 0;
    const holderCount = asset.holderCount || 0;

    // Risk factors
    const volumeRisk = volume24h < 10000 ? 30 : 0;
    const liquidityRisk = liquidity < 50000 ? 20 : 0;
    const holderRisk = holderCount < 100 ? 25 : 0;
    const ageRisk = this.calculateAgeRisk(asset.listedAt);

    // Check for active alerts
    const alertCount = (asset.alerts || []).length;

    return {
      assetId: tokenSymbol,
      overallScore: Math.max(0, 100 - volumeRisk - liquidityRisk - holderRisk - ageRisk),
      factors: {
        volumeRisk: volumeRisk + '/30',
        liquidityRisk: liquidityRisk + '/20',
        holderRisk: holderRisk + '/25',
        ageRisk: ageRisk + '/25'
      },
      recommendation: alertCount > 2 ? 'MONITOR_CLOSELY' :
                   alertCount > 0 ? 'review' : 'healthy',
      alerts: alertCount,
      checkedAt: new Date()
    };
  }

  /**
   * Get all monitoring alerts
   */
  async getMonitoringAlerts(): Promise<AssetAlert[]> {
    const alerts: AssetAlert[] = [];
    
    for (const asset of this.assets.values()) {
      if (asset.monitoringEnabled && asset.status === ListingStatus.LISTED) {
        const risk = await this.getAssetRiskScore(asset.tokenSymbol);
        if (risk.alerts > 0 || risk.recommendation !== 'healthy') {
          alerts.push({
            assetId: asset.tokenSymbol,
            riskScore: risk.overallScore,
            recommendation: risk.recommendation,
            createdAt: new Date()
          });
        }
      }
    }
    
    return alerts.sort((a, b) => a.riskScore - b.riskScore);
  }

  private getDefaultChecklist(chain: string): ChecklistItem[] {
    return [
      { id: 'whitepaper', label: 'Whitepaper', required: true },
      { id: 'tokenomics', label: 'Tokenomics Model', required: true },
      { id: 'code_audit', label: 'Smart Contract Audit', required: true },
      { id: 'team_kyc', label: 'Team KYC', required: true },
      { id: 'legal_opinion', label: 'Legal Opinion', required: false },
      { id: 'market_maker', label: 'Market Maker Agreement', required: true },
      { id: 'liquidity_commitment', label: 'Liquidity Commitment', required: true },
      { id: 'community', label: 'Community Size', required: true }
    ];
  }

  private calculateAgeRisk(listedAt: Date): number {
    const daysSinceListing = (Date.now() - listedAt.getTime()) / (24 * 60 * 60 * 1000);
    return daysSinceListing < 30 ? 25 : daysSinceListing < 90 ? 15 : 0;
  }
}

interface ListingApplicationInput {
  projectName: string;
  tokenSymbol: string;
  tokenContract: string;
  chain: string;
  submittedBy: string;
}

interface ListingApplication {
  id: string;
  projectName: string;
  tokenSymbol: string;
  tokenContract: string;
  chain: string;
  status: ListingStatus;
  submittedAt: Date;
  submittedBy: string;
  checklist: ChecklistItem[];
  timeline: ApplicationTimeline[];
}

interface ListedAsset {
  assetId: string;
  projectName: string;
  tokenSymbol: string;
  tokenContract: string;
  chain: string;
  status: ListingStatus;
  listedAt: Date;
  listingFees: Record<string, number>;
  marketMakerRequirement: Record<string, number>;
  monitoringEnabled: boolean;
  delistingReason?: DelistingReason;
  delistingAnnounced?: Date;
  delistingDeadline?: Date;
  volume24h?: number;
  liquidity?: number;
  holderCount?: number;
  metadata?: Record<string, unknown>;
  alerts?: string[];
}

interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  completed?: boolean;
}

interface ApplicationTimeline {
  stage: string;
  completedAt: Date;
  completedBy: string;
  notes?: string;
}

interface AssetRiskScore {
  assetId: string;
  overallScore: number;
  factors: Record<string, string>;
  recommendation: string;
  alerts: number;
  checkedAt: Date;
}

interface AssetAlert {
  assetId: string;
  riskScore: number;
  recommendation: string;
  createdAt: Date;
}

export { ListingStatus, DelistingReason };