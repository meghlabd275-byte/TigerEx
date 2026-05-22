/**
 * Global Regulatory Partitioning Platform
 * 
 * Enables running isolated regional entities with:
 * - Jurisdictional routing & geo-fencing
 * - Regional order book partitioning  
 * - Compliance data residency
 * - Legal entity accounting
 * - Restricted asset controls
 * 
 * This is what separates real exchanges (TigerEx US, etc.) from single-entity systems.
 */

// Supported jurisdictions with their regulations
export const JURISDICTIONS = {
  US: {
    code: 'US',
    name: 'United States',
    flag: '🇺🇸',
    entities: ['TigerEx US', 'TigerEx Delaware'],
    prohibited: ['USDT', 'MIRROR', 'FET'],
    kycLevel: 'strict',
    dataResidency: 'US',
    licenses: ['MSB', 'MTL']
  },
  JP: {
    code: 'JP',
    name: 'Japan', 
    flag: '🇯🇵',
    entities: ['TigerEx Japan'],
    prohibited: ['XRP', 'MATIC'],
    kycLevel: 'strict',
    dataResidency: 'JP',
    licenses: ['Kanto License']
  },
  UK: {
    code: 'UK',
    name: 'United Kingdom',
    flag: '🇬🇧',
    entities: ['TigerEx UK'],
    prohibited: ['USDT'],
    kycLevel: 'strict',
    dataResidency: 'UK',
    licenses: ['FCA']
  },
  UAE: {
    code: 'AE',
    name: 'UAE',
    flag: '🇦🇪',
    entities: ['TigerEx Abu Dhabi'],
    prohibited: [],
    kycLevel: 'medium',
    dataResidency: 'UAE',
    licenses: ['VASP']
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    flag: '🇸🇬',
    entities: ['TigerEx Singapore'],
    prohibited: [],
    kycLevel: 'strict',
    dataResidency: 'SG',
    licenses: ['PSA']
  },
  GLOBAL: {
    code: 'GLOBAL',
    name: 'Global',
    flag: '🌍',
    entities: ['TigerEx Global'],
    prohibited: [],
    kycLevel: 'basic',
    dataResidency: 'SG',
    licenses: []
  }
};

export type JurisdictionCode = keyof typeof JURISDICTIONS;

export class GlobalRegulatoryPlatform {
  private currentJurisdiction: JurisdictionCode = 'GLOBAL';
  private userJurisdictionMap: Map<string, JurisdictionCode> = new Map();

  /**
   * Determine user's jurisdiction based on IP and account
   */
  determineUserJurisdiction(userId: string, ip: string, countryFromDocs?: string): JurisdictionResult {
    // First check if user has restricted docs
    if (countryFromDocs && this.isRestrictedJurisdiction(countryFromDocs)) {
      const jurisdiction = this.getJurisdictionForCountry(countryFromDocs);
      return {
        jurisdiction,
        reason: 'Document country restriction',
        allowedProducts: this.getAllowedProducts(jurisdiction)
      };
    }

    // Then check IP-based geo-fencing
    const ipCountry = this.lookupIPCountry(ip);
    if (ipCountry && this.isRestrictedJurisdiction(ipCountry)) {
      return {
        jurisdiction: ipCountry as JurisdictionCode,
        reason: 'IP geo-restriction',
        requiresVerification: true,
        allowedProducts: []
      };
    }

    // Default to global
    return {
      jurisdiction: 'GLOBAL',
      reason: 'Default',
      allowedProducts: this.getAllowedProducts('GLOBAL')
    };
  }

  /**
   * Route order to correct regional orderbook
   */
  routeOrder(order: OrderRouteParams): RoutedOrder {
    const userJurisdiction = this.userJurisdictionMap.get(order.userId) || 'GLOBAL';
    const jurisdictionConfig = JURISDICTIONS[userJurisdiction];
    
    // Get regional orderbook endpoint
    const orderbookEndpoint = this.getOrderbookEndpoint(userJurisdiction, order.symbol);
    
    return {
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      jurisdiction: userJurisdiction,
      orderbookEndpoint,
      routingReason: jurisdictionConfig.name
    };
  }

  /**
   * Check if asset is allowed in user's jurisdiction
   */
  isAssetAllowed(userId: string, asset: string): AssetAllowedResult {
    const jurisdiction = this.userJurisdictionMap.get(userId) || 'GLOBAL';
    const config = JURISDICTIONS[jurisdiction];
    
    const isProhibited = config.prohibited.includes(asset);
    
    return {
      allowed: !isProhibited,
      asset,
      jurisdiction,
      reason: isProhibited ? 'Asset prohibited in jurisdiction' : 'Allowed'
    };
  }

  /**
   * Assign user to jurisdiction (for registered accounts)
   */
  assignUserToJurisdiction(userId: string, jurisdiction: JurisdictionCode): void {
    this.userJurisdictionMap.set(userId, jurisdiction);
  }

  /**
   * Get compliance report for jurisdiction
   */
  getJurisdictionComplianceReport(jurisdiction: JurisdictionCode): ComplianceReport {
    const config = JURISDICTIONS[jurisdiction];
    
    return {
      jurisdiction,
      entityName: config.entities[0],
      kycLevel: config.kycLevel,
      dataResidency: config.dataResidency,
      prohibitedAssets: config.prohibited,
      licenses: config.licenses,
      generatedAt: new Date()
    };
  }

  private getAllowedProducts(jurisdiction: JurisdictionCode): string[] {
    const allProducts = ['spot', 'futures', 'options', 'margin', 'p2p', 'earn'];
    const prohibited = JURISDICTIONS[jurisdiction].prohibited;
    
    // Very simplified - would need real mapping
    if (prohibited.length > 5) return ['spot', 'p2p'];  // US - restricted
    return allProducts;
  }

  private getOrderbookEndpoint(jurisdiction: JurisdictionCode, symbol: string): string {
    // Regional orderbook endpoints
    const endpoints: Record<string, string> = {
      US: 'https://api TigerEx US-orderbook',
      JP: 'https://api TigerEx JP-orderbook',
      UK: 'https://api TigerEx UK-orderbook',
      AE: 'https://api TigerEx AE-orderbook',
      SG: 'https://api TigerEx SG-orderbook',
      GLOBAL: 'https://api TigerEx Global-orderbook'
    };
    return endpoints[jurisdiction] || endpoints.GLOBAL;
  }

  private lookupIPCountry(ip: string): string | null {
    // In production, use MaxMind or similar
    // Simplified: return country code based on IP ranges
    return null;
  }

  private getJurisdictionForCountry(country: string): JurisdictionCode {
    const countryToJurisdiction: Record<string, JurisdictionCode> = {
      'US': 'US',
      'Japan': 'JP',
      'United Kingdom': 'UK',
      'UAE': 'AE',
      'Singapore': 'SG'
    };
    return countryToJurisdiction[country] || 'GLOBAL';
  }

  private isRestrictedJurisdiction(country: string): boolean {
    return ['US', 'JP', 'UK'].includes(country);
  }
}

interface JurisdictionResult {
  jurisdiction: JurisdictionCode;
  reason: string;
  requiresVerification?: boolean;
  allowedProducts: string[];
}

interface OrderRouteParams {
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
}

interface RoutedOrder {
  userId: string;
  symbol: string;
  side: string;
  quantity: number;
  price?: number;
  jurisdiction: JurisdictionCode;
  orderbookEndpoint: string;
  routingReason: string;
}

interface AssetAllowedResult {
  allowed: boolean;
  asset: string;
  jurisdiction: JurisdictionCode;
  reason: string;
}

interface ComplianceReport {
  jurisdiction: JurisdictionCode;
  entityName: string;
  kycLevel: string;
  dataResidency: string;
  prohibitedAssets: string[];
  licenses: string[];
  generatedAt: Date;
}

export { JURISDICTIONS };