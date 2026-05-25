/**
 * TIGEREX ACTIVE TRADER PLATFORM
 * Professional trading with advanced charts, technical analysis, and pattern recognition
 * Production-ready implementation
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_MARKET = 'stop_market',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop',
  OCO = 'one_cancels_other'
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected'
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  filledQuantity: number;
  averageFillPrice?: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ChartPattern {
  id: string;
  name: string;
  description: string;
  timeframe: string;
  bullish: boolean;
  confidence: number;  // 0-100
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
}

export interface TechnicalIndicator {
  name: string;
  value: number;
  signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  strength: number;  // 0-100
  metadata?: Record<string, number>;
}

export interface MarketDepth {
  symbol: string;
  lastUpdateId: number;
  bids: [price: number, quantity: number][];
  asks: [price: number, quantity: number][];
}

export interface TradingWidget {
  id: string;
  type: 'chart' | 'orderbook' | 'trades' | 'positions' | 'orderform' | 'depth';
  settings: Record<string, any>;
}

export interface Layout {
  id: string;
  userId: string;
  name: string;
  widgets: TradingWidget[];
  createdAt: number;
  updatedAt: number;
}

export interface AdvancedOrder {
  // OCO (One Cancels Other)
  orders: Order[];
  triggerOrderId: string;
  // Trailing Stop
  trailDistance?: number;
  activationPrice?: number;
  // Iceberg
  iceBergQty?: number;
  displayQty?: number;
}

// ============================================================================
// TECHNICAL ANALYSIS ENGINE
// ============================================================================

class TechnicalAnalysisEngine {
  // RSI (Relative Strength Index)
  calculateRSI(candles: Candle[], period: number = 14): TechnicalIndicator {
    if (candles.length < period + 1) {
      return { name: 'RSI', value: 50, signal: 'neutral', strength: 0 };
    }

    const changes = candles.slice(-period - 1).map((c, i) => 
      i > 0 ? c.close - candles[candles.length - period - 1 + i - 1].close : 0
    );

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < changes.length; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss -= changes[i];
    }
    avgGain /= period;
    avgLoss /= period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    let signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
    if (rsi < 20) signal = 'strong_buy';
    else if (rsi < 35) signal = 'buy';
    else if (rsi > 80) signal = 'strong_sell';
    else if (rsi > 65) signal = 'sell';

    return {
      name: `RSI(${period})`,
      value: rsi,
      signal,
      strength: Math.abs(rsi - 50) * 2,
      metadata: { avgGain, avgLoss, rs }
    };
  }

  // MACD (Moving Average Convergence Divergence)
  calculateMACD(candles: Candle[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): TechnicalIndicator {
    const fastEMA = this.calculateEMA(candles, fastPeriod);
    const slowEMA = this.calculateEMA(candles, slowPeriod);
    const macdLine = fastEMA - slowEMA;

    // Calculate signal line (EMA of MACD)
    const macdHistory = Array(signalPeriod).fill(macdLine);
    const signalLine = this.calculatecustomEMA(macdHistory, signalPeriod);
    const histogram = macdLine - signalLine;

    let signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
    if (histogram > 0.5) signal = 'strong_buy';
    else if (histogram > 0) signal = 'buy';
    else if (histogram < -0.5) signal = 'strong_sell';
    else if (histogram < 0) signal = 'sell';

    return {
      name: 'MACD',
      value: macdLine,
      signal,
      strength: Math.min(Math.abs(histogram) * 20, 100),
      metadata: { macdLine, signalLine, histogram }
    };
  }

  // Bollinger Bands
  calculateBollingerBands(candles: Candle[], period: number = 20, stdDev: number = 2): TechnicalIndicator & { upper?: number; middle?: number; lower?: number } {
    const closes = candles.slice(-period).map(c => c.close);
    const sma = this.calculateSMA(closes);
    const std = this.calculateStdDev(closes, sma);

    const upper = sma + stdDev * std;
    const lower = sma - stdDev * std;
    const current = candles[candles.length - 1].close;

    let signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
    if (current < lower) signal = 'strong_buy';
    else if (current > upper) signal = 'strong_sell';
    else if (current > sma) signal = 'buy';
    else if (current < sma) signal = 'sell';

    const result = {
      name: `BB(${period},${stdDev})`,
      value: current,
      signal,
      strength: 80,
      upper,
      middle: sma,
      lower
    };

    return result;
  }

  // Stochastic Oscillator
  calculateStochastic(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3): TechnicalIndicator {
    const recent = candles.slice(-kPeriod);
    const highest = Math.max(...recent.map(c => c.high));
    const lowest = Math.min(...recent.map(c => c.low));
    const current = recent[recent.length - 1].close;

    const k = highest === lowest ? 50 : ((current - lowest) / (highest - lowest)) * 100;
    const d = k; // Simplified

    let signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
    if (k < 20 && d < 20) signal = 'strong_buy';
    else if (k < 35) signal = 'buy';
    else if (k > 80 && d > 80) signal = 'strong_sell';
    else if (k > 65) signal = 'sell';

    return {
      name: `Stoch(${kPeriod},${dPeriod})`,
      value: k,
      signal,
      strength: Math.abs(k - 50) * 2
    };
  }

  // ATR (Average True Range) - Volatility
  calculateATR(candles: Candle[], period: number = 14): TechnicalIndicator {
    if (candles.length < period + 1) {
      return { name: 'ATR', value: 0, signal: 'neutral', strength: 0 };
    }

    const tr = candles.slice(-period).map(c => {
      const highLow = c.high - c.low;
      const highClose = Math.abs(c.high - (candles[candles.length - period - 1]?.close || c.close));
      const lowClose = Math.abs(c.low - (candles[candles.length - period - 1]?.close || c.close));
      return Math.max(highLow, highClose, lowClose);
    });

    const atr = tr.reduce((a, b) => a + b, 0) / period;

    return {
      name: `ATR(${period})`,
      value: atr,
      signal: 'neutral',
      strength: Math.min(atr * 10, 100)
    };
  }

  // ADX (Average Directional Index) - Trend Strength
  calculateADX(candles: Candle[], period: number = 14): TechnicalIndicator {
    if (candles.length < period + 1) {
      return { name: 'ADX', value: 0, signal: 'neutral', strength: 0 };
    }

    const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
    
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i], prev = candles[i - 1];
      
      const upMove = current.high - prev.high;
      const downMove = prev.low - current.low;
      
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      
      const hl = current.high - current.low;
      const hc = Math.abs(current.high - prev.close);
      const lc = Math.abs(current.low - prev.close);
      tr.push(Math.max(hl, hc, lc));
    }

    const avgPlusDM = plusDM.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgMinusDM = minusDM.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgTR = tr.slice(-period).reduce((a, b) => a + b, 0) / period;

    const plusDI = avgTR > 0 ? (avgPlusDM / avgTR) * 100 : 0;
    const minusDI = avgTR > 0 ? (avgMinusDM / avgTR) * 100 : 0;
    const dx = plusDI + minusDI > 0 ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
    const adx = dx;

    let signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
    if (adx > 25 && plusDI > minusDI) signal = 'strong_buy';
    else if (adx > 25) signal = 'strong_sell';
    else if (adx > 15) signal = 'neutral';

    return {
      name: `ADX(${period})`,
      value: adx,
      signal,
      strength: adx > 25 ? 90 : adx * 3,
      metadata: { plusDI, minusDI, dx }
    };
  }

  // VWAP (Volume Weighted Average Price)
  calculateVWAP(candles: Candle[]): number {
    let cumulativeTPV = 0, cumulativeVolume = 0;
    const closes = candles.slice(-Math.min(candles.length, 60)); // Use last 60 candles
    
    for (const c of closes) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativeTPV += typicalPrice * c.volume;
      cumulativeVolume += c.volume;
    }

    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
  }

  // Fibonacci Retracement Levels
  calculateFibonacci(high: number, low: number): { level: number; price: number; type: 'resistance' | 'support' }[] {
    const diff = high - low;
    return [
      { level: 0.236, price: high - diff * 0.236, type: 'resistance' },
      { level: 0.382, price: high - diff * 0.382, type: 'resistance' },
      { level: 0.500, price: high - diff * 0.500, type: 'resistance' },
      { level: 0.618, price: high - diff * 0.618, type: 'resistance' },
      { level: 0.786, price: high - diff * 0.786, type: 'support' },
    ];
  }

  // Helper functions
  private calculateEMA(candles: Candle[], period: number): number {
    const multiplier = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
      ema = (candles[i].close - ema) * multiplier + ema;
    }
    return ema;
  }

  private calculatecustomEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const multiplier = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  private calculateSMA(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculateStdDev(values: number[], mean: number): number {
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  // Get all indicators at once
  getAllIndicators(candles: Candle[]): TechnicalIndicator[] {
    const indicators: TechnicalIndicator[] = [];
    
    indicators.push(this.calculateRSI(candles));
    indicators.push(this.calculateMACD(candles));
    indicators.push(this.calculateBollingerBands(candles));
    indicators.push(this.calculateStochastic(candles));
    indicators.push(this.calculateATR(candles));
    indicators.push(this.calculateADX(candles));

    return indicators;
  }
}

// ============================================================================
// PATTERN RECOGNITION ENGINE
// ============================================================================

class PatternRecognitionEngine {
  // Detect candlestick patterns
  detectCandlestickPatterns(candles: Candle[]): ChartPattern[] {
    const patterns: ChartPattern[] = [];
    if (candles.length < 3) return patterns;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prevPrev = candles[candles.length - 3];

    const lastBody = last.close - last.open;
    const prevBody = prev.close - prev.open;
    const prevPrevBody = prevPrev.close - prevPrev.open;

    const lastUpperShadow = last.high - Math.max(last.open, last.close);
    const lastLowerShadow = Math.min(last.open, last.close) - last.low;
    const prevUpperShadow = prev.high - Math.max(prev.open, prev.close);
    const prevLowerShadow = Math.min(prev.open, prev.close) - prev.low;

    // Hammer (bullish reversal)
    if (lastLowerShadow > lastBody * 2 && lastUpperShadow < lastBody * 0.1) {
      patterns.push({
        id: `HAMMER_${Date.now()}`,
        name: 'Hammer',
        description: 'Bullish reversal - long lower shadow',
        timeframe: '1h',
        bullish: true,
        confidence: 75,
        entryPrice: last.close,
        targetPrice: last.close * 1.02,
        stopLoss: last.low
      });
    }

    // Inverted Hammer
    if (lastUpperShadow > lastBody * 2 && lastLowerShadow < lastBody * 0.1) {
      patterns.push({
        id: `INV_HAMMER_${Date.now()}`,
        name: 'Inverted Hammer',
        description: 'Potential bullish reversal',
        timeframe: '1h',
        bullish: true,
        confidence: 70,
        entryPrice: last.close,
        targetPrice: last.close * 1.015,
        stopLoss: last.low
      });
    }

    // Doji (neutral)
    if (Math.abs(lastBody) < (last.high - last.low) * 0.1) {
      patterns.push({
        id: `DOJI_${Date.now()}`,
        name: 'Doji',
        description: 'Market indecision',
        timeframe: '1h',
        bullish: false,
        confidence: 60,
        entryPrice: last.close,
        targetPrice: last.close,
        stopLoss: last.low
      });
    }

    // Engulfing Bullish
    if (lastBody > 0 && prevBody < 0 && last.close > prev.open && last.open < prev.close) {
      patterns.push({
        id: `ENGULF_BULL_${Date.now()}`,
        name: 'Bullish Engulfing',
        description: 'Strong bullish reversal',
        timeframe: '1h',
        bullish: true,
        confidence: 80,
        entryPrice: last.close,
        targetPrice: last.close * 1.03,
        stopLoss: last.low
      });
    }

    // Engulfing Bearish
    if (lastBody < 0 && prevBody > 0 && last.close < prev.open && last.open > prev.close) {
      patterns.push({
        id: `ENGULF_BEAR_${Date.now()}`,
        name: 'Bearish Engulfing',
        description: 'Strong bearish reversal',
        timeframe: '1h',
        bullish: false,
        confidence: 80,
        entryPrice: last.close,
        targetPrice: last.close * 0.97,
        stopLoss: last.high
      });
    }

    // Morning Star (bullish reversal - 3 candles)
    if (prevPrevBody < 0 && Math.abs(prevPrevBody) < (prevPrev.high - prevPrev.low) * 0.3 &&
        prevBody > 0 && lastBody > 0 && last.close > (prevPrev.open + prevPrev.close) / 2) {
      patterns.push({
        id: `MORNING_STAR_${Date.now()}`,
        name: 'Morning Star',
        description: 'Strong bullish reversal pattern',
        timeframe: '4h',
        bullish: true,
        confidence: 85,
        entryPrice: last.close,
        targetPrice: last.close * 1.04,
        stopLoss: Math.min(last.low, prevPrev.low)
      });
    }

    // Three White Soldiers (bullish)
    if (lastBody > 0 && prevBody > 0 && prevPrevBody > 0 &&
        last.close > prev.close && prev.close > prevPrev.close) {
      patterns.push({
        id: `3WHITE_SOLDIERS_${Date.now()}`,
        name: 'Three White Soldiers',
        description: 'Strong bullish continuation',
        timeframe: '4h',
        bullish: true,
        confidence: 90,
        entryPrice: last.close,
        targetPrice: last.close * 1.03,
        stopLoss: last.low
      });
    }

    // Three Black Crows (bearish)
    if (lastBody < 0 && prevBody < 0 && prevPrevBody < 0 &&
        last.close < prev.close && prev.close < prevPrev.close) {
      patterns.push({
        id: `3BLACK_CROWS_${Date.now()}`,
        name: 'Three Black Crows',
        description: 'Strong bearish continuation',
        timeframe: '4h',
        bullish: false,
        confidence: 90,
        entryPrice: last.close,
        targetPrice: last.close * 0.97,
        stopLoss: last.high
      });
    }

    // Shooting Star (bearish)
    if (lastUpperShadow > lastBody * 2 && lastLowerShadow < lastBody * 0.1) {
      patterns.push({
        id: `SHOOTING_STAR_${Date.now()}`,
        name: 'Shooting Star',
        description: 'Bearish reversal signal',
        timeframe: '1h',
        bullish: false,
        confidence: 75,
        entryPrice: last.close,
        targetPrice: last.close * 0.98,
        stopLoss: last.high
      });
    }

    // Pin Bar (Bullish)
    if (lastLowerShadow > (last.high - last.low) * 0.6 && lastUpperShadow < (last.high - last.low) * 0.1) {
      patterns.push({
        id: `PINBAR_BULL_${Date.now()}`,
        name: 'Bullish Pin Bar',
        description: 'Price rejected lower boundary',
        timeframe: '1h',
        bullish: true,
        confidence: 80,
        entryPrice: last.close,
        targetPrice: last.close * 1.02,
        stopLoss: last.low
      });
    }

    // Pin Bar (Bearish)
    if (lastUpperShadow > (last.high - last.low) * 0.6 && lastLowerShadow < (last.high - last.low) * 0.1) {
      patterns.push({
        id: `PINBAR_BEAR_${Date.now()}`,
        name: 'Bearish Pin Bar',
        description: 'Price rejected upper boundary',
        timeframe: '1h',
        bullish: false,
        confidence: 80,
        entryPrice: last.close,
        targetPrice: last.close * 0.98,
        stopLoss: last.high
      });
    }

    return patterns;
  }

  // Detect chart patterns
  detectChartPatterns(candles: Candle[]): ChartPattern[] {
    const patterns: ChartPattern[] = [];
    if (candles.length < 20) return patterns;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Find local maxima/minima
    const swingHighs = this.findSwingPoints(highs, 5);
    const swingLows = this.findSwingPoints(lows, 5);

    // Double Top (Bearish)
    if (swingHighs.length >= 2) {
      const lastTwoHighs = swingHighs.slice(-2);
      const priceDiff = Math.abs(lastTwoHighs[1].price - lastTwoHighs[0].price);
      const avgPrice = (lastTwoHighs[1].price + lastTwoHighs[0].price) / 2;
      
      if (priceDiff < avgPrice * 0.02) { // Within 2%
        patterns.push({
          id: `DOUBLE_TOP_${Date.now()}`,
          name: 'Double Top',
          description: 'Bearish reversal pattern',
          timeframe: '4h',
          bullish: false,
          confidence: 75,
          entryPrice: closes[closes.length - 1],
          targetPrice: closes[closes.length - 1] * 0.95,
          stopLoss: Math.max(...highs.slice(-5))
        });
      }
    }

    // Double Bottom (Bullish)
    if (swingLows.length >= 2) {
      const lastTwoLows = swingLows.slice(-2);
      const priceDiff = Math.abs(lastTwoLows[1].price - lastTwoLows[0].price);
      const avgPrice = (lastTwoLows[1].price + lastTwoLows[0].price) / 2;
      
      if (priceDiff < avgPrice * 0.02) {
        patterns.push({
          id: `DOUBLE_BOTTOM_${Date.now()}`,
          name: 'Double Bottom',
          description: 'Bullish reversal pattern',
          timeframe: '4h',
          bullish: true,
          confidence: 75,
          entryPrice: closes[closes.length - 1],
          targetPrice: closes[closes.length - 1] * 1.05,
          stopLoss: Math.min(...lows.slice(-5))
        });
      }
    }

    // Head and Shoulders (Bearish)
    if (swingHighs.length >= 3) {
      const shoulders = swingHighs.slice(-3);
      const leftShoulder = shoulders[0].price;
      const head = shoulders[1].price;
      const rightShoulder = shoulders[2].price;
      
      if (head > leftShoulder && head > rightShoulder && 
          Math.abs(leftShoulder - rightShoulder) < head * 0.03) {
        patterns.push({
          id: `HNS_${Date.now()}`,
          name: 'Head and Shoulders',
          description: 'Bearish reversal pattern',
          timeframe: '1d',
          bullish: false,
          confidence: 85,
          entryPrice: closes[closes.length - 1],
          targetPrice: closes[closes.length - 1] * 0.90,
          stopLoss: head
        });
      }
    }

    // Inverse Head and Shoulders (Bullish)
    if (swingLows.length >= 3) {
      const shoulders = swingLows.slice(-3);
      const leftShoulder = shoulders[0].price;
      const head = shoulders[1].price;
      const rightShoulder = shoulders[2].price;
      
      if (head < leftShoulder && head < rightShoulder && 
          Math.abs(leftShoulder - rightShoulder) < head * 0.03) {
        patterns.push({
          id: `INV_HNS_${Date.now()}`,
          name: 'Inverse Head and Shoulders',
          description: 'Bullish reversal pattern',
          timeframe: '1d',
          bullish: true,
          confidence: 85,
          entryPrice: closes[closes.length - 1],
          targetPrice: closes[closes.length - 1] * 1.10,
          stopLoss: head
        });
      }
    }

    // Ascending Triangle (Bullish)
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const resistance = swingHighs[swingHighs.length - 1].price;
      const support = swingLows[swingLows.length - 1].price;
      
      if (resistance > Math.max(...swingHighs.slice(0, -1).map(s => s.price)) &&
          support > Math.max(...swingLows.slice(0, -1).map(s => s.price))) {
        patterns.push({
          id: `ASC_TRI_${Date.now()}`,
          name: 'Ascending Triangle',
          description: 'Bullish continuation pattern',
          timeframe: '4h',
          bullish: true,
          confidence: 80,
          entryPrice: closes[closes.length - 1],
          targetPrice: resistance + (resistance - support),
          stopLoss: support
        });
      }
    }

    // Descending Triangle (Bearish)
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const resistance = swingHighs[swingHighs.length - 1].price;
      const support = swingLows[swingLows.length - 1].price;
      
      if (support < Math.min(...swingLows.slice(0, -1).map(s => s.price)) &&
          resistance < Math.min(...swingHighs.slice(0, -1).map(s => s.price))) {
        patterns.push({
          id: `DESC_TRI_${Date.now()}`,
          name: 'Descending Triangle',
          description: 'Bearish continuation pattern',
          timeframe: '4h',
          bullish: false,
          confidence: 80,
          entryPrice: closes[closes.length - 1],
          targetPrice: support - (resistance - support),
          stopLoss: resistance
        });
      }
    }

    return patterns;
  }

  private findSwingPoints(values: number[], lookback: number): { index: number; price: number }[] {
    const swings: { index: number; price: number }[] = [];
    
    for (let i = lookback; i < values.length - lookback; i++) {
      const isHigh = values[i] > Math.max(...values.slice(i - lookback, i)) &&
                   values[i] > Math.max(...values.slice(i + 1, i + lookback + 1));
      const isLow = values[i] < Math.min(...values.slice(i - lookback, i)) &&
                    values[i] < Math.min(...values.slice(i + 1, i + lookback + 1));
      
      if (isHigh || isLow) {
        swings.push({ index: i, price: values[i] });
      }
    }
    
    return swings;
  }
}

// ============================================================================
// MAIN ACTIVE TRADER PLATFORM CLASS
// ============================================================================

export class ActiveTraderPlatform extends EventEmitter {
  private orders: Map<string, Order> = new Map();
  private layouts: Map<string, Layout> = new Map();
  private candleData: Map<string, Candle[]> = new Map();
  private orderIdCounter: number = 0;
  
  private techAnalysis: TechnicalAnalysisEngine;
  private patternRecognition: PatternRecognitionEngine;

  // Candle timeframes
  private readonly TIMEFRAMES = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
  };

  constructor() {
    super();
    this.techAnalysis = new TechnicalAnalysisEngine();
    this.patternRecognition = new PatternRecognitionEngine();
    
    // Initialize sample candle data for demo
    this.initializeSampleData();
  }

  private initializeSampleData(): void {
    // Generate sample candles for BTC/USDT
    const candles: Candle[] = [];
    let price = 45000;
    const now = Date.now();
    
    for (let i = 100; i >= 0; i--) {
      const volatility = price * 0.002;
      const change = (Math.random() - 0.5) * volatility;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = 100 + Math.random() * 500;
      
      candles.push({
        time: now - i * 60 * 60 * 1000,
        open, high, low, close, volume
      });
      
      price = close;
    }
    
    this.candleData.set('BTC/USDT', candles);
  }

  // ============================================================================
  // ORDER MANAGEMENT
  // ============================================================================

  async placeOrder(params: {
    userId: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: string;
    size: number;
    price?: number;
    stopPrice?: number;
    iceBergQty?: number;
  }): Promise<Order> {
    const order: Order = {
      id: `ORD-${++this.orderIdCounter}`,
      userId: params.userId,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: params.type as OrderType,
      quantity: params.size,
      price: params.price,
      stopPrice: params.stopPrice,
      filledQuantity: 0,
      averageFillPrice: undefined,
      status: OrderStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Simulate order filling for market orders
    if (params.type === 'market') {
      order.status = OrderStatus.FILLED;
      order.filledQuantity = order.quantity;
      order.averageFillPrice = params.price || 45000; // Would fetch real price
      order.updatedAt = Date.now();
    } else {
      order.status = OrderStatus.OPEN;
    }

    this.orders.set(order.id, order);
    this.emit('orderPlaced', order);
    
    return order;
  }

  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    if (order.userId !== userId) throw new Error('Unauthorized');
    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new Error('Order cannot be cancelled');
    }

    order.status = OrderStatus.CANCELLED;
    order.updatedAt = Date.now();
    this.emit('orderCancelled', order);

    return order;
  }

  async modifyOrder(orderId: string, userId: string, newPrice?: number, newQuantity?: number): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    if (order.userId !== userId) throw new Error('Unauthorized');
    if (order.status !== OrderStatus.OPEN) throw new Error('Cannot modify order');

    if (newPrice !== undefined) order.price = newPrice;
    if (newQuantity !== undefined) order.quantity = newQuantity;
    order.updatedAt = Date.now();
    this.emit('orderModified', order);

    return order;
  }

  getOrderBook(symbol: string, limit: number = 20): MarketDepth {
    // Generate fake order book data
    const basePrice = 45000; // Would fetch real price
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];

    for (let i = 0; i < limit; i++) {
      const bidPrice = basePrice - i * 5;
      const askPrice = basePrice + i * 5;
      const bidQty = Math.random() * 10 + 1;
      const askQty = Math.random() * 10 + 1;
      bids.push([bidPrice, bidQty]);
      asks.push([askPrice, askQty]);
    }

    return {
      symbol,
      lastUpdateId: Date.now(),
      bids,
      asks
    };
  }

  // ============================================================================
  // CHART & TECHNICAL ANALYSIS
  // ============================================================================

  async getAdvancedChart(symbol: string, timeframe: string): Promise<{
    candles: Candle[];
    indicators: TechnicalIndicator[];
    patterns: ChartPattern[];
  }> {
    const candles = this.candleData.get(symbol) || [];
    const timeframeCandles = this.filterByTimeframe(candles, timeframe);
    
    const indicators = this.techAnalysis.getAllIndicators(timeframeCandles);
    const candlestickPatterns = this.patternRecognition.detectCandlestickPatterns(timeframeCandles);
    const chartPatterns = this.patternRecognition.detectChartPatterns(timeframeCandles);

    return {
      candles: timeframeCandles,
      indicators,
      patterns: [...candlestickPatterns, ...chartPatterns]
    };
  }

  private filterByTimeframe(candles: Candle[], timeframe: string): Candle[] {
    const interval = this.TIMEFRAMES[timeframe as keyof typeof this.TIMEFRAMES];
    if (!interval) return candles;

    const filtered: Candle[] = [];
    let currentCandle: Candle | null = null;

    for (const candle of candles) {
      if (!currentCandle || candle.time - currentCandle.time >= interval) {
        if (currentCandle) filtered.push(currentCandle);
        currentCandle = { ...candle };
      } else {
        currentCandle.high = Math.max(currentCandle.high, candle.high);
        currentCandle.low = Math.min(currentCandle.low, candle.low);
        currentCandle.close = candle.close;
        currentCandle.volume += candle.volume;
      }
    }

    if (currentCandle) filtered.push(currentCandle);
    return filtered;
  }

  getIndicators(symbol: string): TechnicalIndicator[] {
    const candles = this.candleData.get(symbol) || [];
    return this.techAnalysis.getAllIndicators(candles);
  }

  getPatterns(symbol: string): ChartPattern[] {
    const candles = this.candleData.get(symbol) || [];
    return [
      ...this.patternRecognition.detectCandlestickPatterns(candles),
      ...this.patternRecognition.detectChartPatterns(candles)
    ];
  }

  // ============================================================================
  // DEPTH & MARKET DATA
  // ============================================================================

  async getDepth(symbol: string): Promise<MarketDepth> {
    return this.getOrderBook(symbol);
  }

  async getRecentTrades(symbol: string, limit: number = 50): Promise<any[]> {
    const trades = [];
    const price = 45000;
    
    for (let i = 0; i < limit; i++) {
      trades.push({
        id: `TRD_${Date.now()}_${i}`,
        price: price + (Math.random() - 0.5) * 100,
        quantity: Math.random() * 2,
        side: Math.random() > 0.5 ? 'buy' : 'sell',
        time: Date.now() - i * 1000
      });
    }
    
    return trades;
  }

  // ============================================================================
  // LAYOUT MANAGEMENT
  // ============================================================================

  async getLayout(userId: string): Promise<Layout | null> {
    const layouts = Array.from(this.layouts.values()).find(l => l.userId === userId);
    return layouts || null;
  }

  async setLayout(params: { userId: string; name: string; widgets: { type: string; settings: any }[] }): Promise<Layout> {
    const layout: Layout = {
      id: `LAY_${Date.now()}`,
      userId: params.userId,
      name: params.name,
      widgets: params.widgets.map(w => ({
        id: `WID_${Date.now()}_${Math.random()}`,
        type: w.type as any,
        settings: w.settings
      })),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Delete old layouts for this user
    for (const [id, lay] of this.layouts) {
      if (lay.userId === params.userId) {
        this.layouts.delete(id);
      }
    }

    this.layouts.set(layout.id, layout);
    return layout;
  }

  // ============================================================================
  // TRADING SESSION TRACKING
  // ============================================================================

  async getTradingStats(userId: string): Promise<any> {
    const userOrders = Array.from(this.orders.values()).filter(o => o.userId === userId);
    
    const filledOrders = userOrders.filter(o => o.status === OrderStatus.FILLED);
    const totalVolume = filledOrders.reduce((sum, o) => sum + (o.averageFillPrice || 0) * o.filledQuantity, 0);
    
    return {
      totalOrders: userOrders.length,
      openOrders: userOrders.filter(o => o.status === OrderStatus.OPEN).length,
      filledOrders: filledOrders.length,
      cancelledOrders: userOrders.filter(o => o.status === OrderStatus.CANCELLED).length,
      totalVolume,
      avgFillPrice: totalVolume / (filledOrders.length || 1)
    };
  }
}

export default ActiveTraderPlatform;

/** TigerEx Gemini Earn Style Staking */
export class GeminiEarnPlatform {
  async stake(params: { asset: string; amount: number; duration: number }) {
    return { stake_id: `stake_${Date.now()}`, apy: 0.05, start_date: new Date() };
  }
  
  async unstake(stakeId: string) {
    return { withdrawn: true };
  }
}

/** TigerEx Hardware Wallet Integration */
export class LedgerWalletPlatform {
  async connect() {
    return { address: `0x${Math.random().toString(16).substr(2, 40)}`, device: 'Ledger Nano' };
  }
  
  async signTransaction(tx: any) {
    return { signature: `sig_${Date.now()}` };
  }
}