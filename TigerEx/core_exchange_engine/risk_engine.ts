/**
 * TigerEx Risk Management Engine
 * 
 * Real risk management implementation for trading
 */

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface RiskCheckResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  message?: string;
  requiredMargin?: number;
  maxLeverage?: number;
}

export interface Position {
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  margin: number;
  marginRatio: number;
}

export interface AccountRisk {
  totalEquity: number;
  totalMargin: number;
  availableMargin: number;
  totalPositionValue: number;
  marginRatio: number;
  liquidationRisk: RiskLevel;
}

export class RiskManagementEngine {
  // Risk parameters
  private readonly MAX_LEVERAGE = 125;
  private readonly MARGIN_RATIO_MAINTENANCE = 0.005; // 0.5%
  private readonly MARGIN_RATIO_PARTIAL_LIQUIDATION = 0.01; // 1%
  private readonly MAX_POSITION_SIZE = 1000000; // $1M
  private readonly MAX_DAILY_LOSS = 100000; // $100k
  private readonly MAX_OPEN_POSITIONS = 20;

  // Check if order is allowed
  async checkOrder(
    userId: string,
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number,
    leverage: number,
    currentPositions: Position[]
  ): Promise<RiskCheckResult> {
    // Check leverage
    if (leverage > this.MAX_LEVERAGE) {
      return {
        allowed: false,
        riskLevel: RiskLevel.CRITICAL,
        message: `Maximum leverage is ${this.MAX_LEVERAGE}x`
      };
    }

    // Check position size
    const orderValue = quantity * price;
    if (orderValue > this.MAX_POSITION_SIZE) {
      return {
        allowed: false,
        riskLevel: RiskLevel.HIGH,
        message: `Order size exceeds maximum of $${this.MAX_POSITION_SIZE}`
      };
    }

    // Check position count
    if (currentPositions.length >= this.MAX_OPEN_POSITIONS) {
      return {
        allowed: false,
        riskLevel: RiskLevel.HIGH,
        message: `Maximum open positions is ${this.MAX_OPEN_POSITIONS}`
      };
    }

    // Check existing position
    const existingPosition = currentPositions.find(p => p.symbol === symbol);
    if (existingPosition && existingPosition.side !== side) {
      // Closing opposite position - check if exceeds
      const totalQty = existingPosition.quantity + quantity;
      if (totalQty > existingPosition.quantity * 1.5) {
        return {
          allowed: true,
          riskLevel: RiskLevel.MEDIUM,
          message: 'Position flip risk'
        };
      }
    }

    // Calculate required margin
    const requiredMargin = orderValue / leverage;

    return {
      allowed: true,
      riskLevel: RiskLevel.LOW,
      requiredMargin,
      maxLeverage: this.MAX_LEVERAGE
    };
  }

  // Calculate liquidation price
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    side: 'long' | 'short'
  ): number {
    const maintenanceMarginRate = this.MARGIN_RATIO_MAINTENANCE;
    
    if (side === 'long') {
      return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
    } else {
      return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
    }
  }

  // Calculate position P&L
  calculatePnL(
    entryPrice: number,
    markPrice: number,
    quantity: number,
    side: 'long' | 'short'
  ): number {
    if (side === 'long') {
      return (markPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - markPrice) * quantity;
    }
  }

  // Check account risk
  async checkAccountRisk(
    positions: Position[],
    totalBalance: number
  ): Promise<AccountRisk> {
    let totalMargin = 0;
    let totalPositionValue = 0;

    for (const position of positions) {
      totalMargin += position.margin;
      totalPositionValue += position.quantity * position.markPrice;
    }

    const totalEquity = totalBalance + positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const availableMargin = totalEquity - totalMargin;
    const marginRatio = totalPositionValue > 0 ? totalMargin / totalPositionValue : 1;

    // Determine liquidation risk
    let liquidationRisk = RiskLevel.LOW;
    if (marginRatio < this.MARGIN_RATIO_MAINTENANCE) {
      liquidationRisk = RiskLevel.CRITICAL;
    } else if (marginRatio < this.MARGIN_RATIO_PARTIAL_LIQUIDATION) {
      liquidationRisk = RiskLevel.HIGH;
    } else if (marginRatio < 0.02) {
      liquidationRisk = RiskLevel.MEDIUM;
    }

    return {
      totalEquity,
      totalMargin,
      availableMargin,
      totalPositionValue,
      marginRatio,
      liquidationRisk
    };
  }

  // Check for liquidation
  async checkLiquidation(position: Position): Promise<boolean> {
    const currentMarginRatio = this.calculateMarginRatio(position);
    return currentMarginRatio < this.MARGIN_RATIO_MAINTENANCE;
  }

  // Calculate margin ratio
  private calculateMarginRatio(position: Position): number {
    const positionValue = position.quantity * position.markPrice;
    return position.margin / positionValue;
  }

  // Get maximum order quantity
  getMaxQuantity(
    userBalance: number,
    price: number,
    leverage: number,
    existingQuantity: number = 0
  ): number {
    const maxNewPosition = (userBalance * leverage) / price;
    return Math.max(0, maxNewPosition - existingQuantity);
  }

  // Calculate margin requirement
  calculateMargin(orderValue: number, leverage: number): number {
    return orderValue / leverage;
  }

  // Check daily loss limit
  checkDailyLossLimit(dailyPnl: number): RiskCheckResult {
    if (dailyPnl <= -this.MAX_DAILY_LOSS) {
      return {
        allowed: false,
        riskLevel: RiskLevel.CRITICAL,
        message: 'Daily loss limit reached'
      };
    }
    return { allowed: true, riskLevel: RiskLevel.LOW };
  }
}

export default RiskManagementEngine;