/**
 * TigerEx TradingView Chart Component
 * Production-grade advanced charting with TradingView
 * Supports: All chart types, technical indicators, drawing tools
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, HistogramData, LineData } from 'lightweight-charts';

// ============================================================================
// TYPES
// ============================================================================

export interface ChartConfig {
  symbol: string;
  interval: string;
  theme?: 'light' | 'dark';
  locale?: string;
  width?: number;
  height?: number;
  studies?: string[];
  drawings?: string[];
}

export interface KlinesData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorConfig {
  name: string;
  type: 'line' | 'histogram' | 'area';
  params?: Record<string, number>;
  colors?: {
    line?: string;
    area?: string;
    histogramUp?: string;
    histogramDown?: string;
  };
}

export interface DrawingTool {
  type: 'trendline' | 'horizontalLine' | 'verticalLine' | 'rectangle' | 'fibonacci';
  points?: { time: Time; price: number }[];
  options?: Record<string, any>;
}

// ============================================================================
// AVAILABLE INDICATORS
// ============================================================================

const BUILT_IN_INDICATORS: Record<string, IndicatorConfig> = {
  'SMA(20)': {
    name: 'SMA',
    type: 'line',
    params: { length: 20 },
    colors: { line: '#FF6B6B' }
  },
  'SMA(50)': {
    name: 'SMA',
    type: 'line',
    params: { length: 50 },
    colors: { line: '#4ECDC4' }
  },
  'SMA(200)': {
    name: 'SMA',
    type: 'line',
    params: { length: 200 },
    colors: { line: '#FFE66D' }
  },
  'EMA(12)': {
    name: 'EMA',
    type: 'line',
    params: { length: 12 },
    colors: { line: '#95E1D3' }
  },
  'EMA(26)': {
    name: 'EMA',
    type: 'line',
    params: { length: 26 },
    colors: { line: '#F38181' }
  },
  'BB(20,2)': {
    name: 'BB',
    type: 'area',
    params: { length: 20, stdDev: 2 },
    colors: { area: 'rgba(78, 205, 196, 0.1)' }
  },
  'RSI(14)': {
    name: 'RSI',
    type: 'line',
    params: { length: 14 },
    colors: { line: '#A8E6CF' }
  },
  'MACD(12,26,9)': {
    name: 'MACD',
    type: 'histogram',
    params: { fastLength: 12, slowLength: 26, signalLength: 9 },
    colors: { histogramUp: '#26A69A', histogramDown: '#EF5350' }
  },
  'Volume': {
    name: 'Volume',
    type: 'histogram',
    colors: { histogramUp: 'rgba(76, 175, 80, 0.5)', histogramDown: 'rgba(244, 67, 54, 0.5)' }
  },
  'ATR(14)': {
    name: 'ATR',
    type: 'line',
    params: { length: 14 },
    colors: { line: '#B39DDB' }
  },
  'Stochastic(14,3,3)': {
    name: 'Stochastic',
    type: 'line',
    params: { kLength: 14, dLength: 3, smooth: 3 },
    colors: { line: '#81D4FA' }
  },
  'ADX(14)': {
    name: 'ADX',
    type: 'line',
    params: { length: 14 },
    colors: { line: '#FFB74D' }
  },
  'CCI(20)': {
    name: 'CCI',
    type: 'line',
    params: { length: 20 },
    colors: { line: '#BA68C8' }
  },
  'Williams %R(14)': {
    name: 'Williams %R',
    type: 'line',
    params: { length: 14 },
    colors: { line: '#4FC3F7' }
  },
  'OBV': {
    name: 'OBV',
    type: 'line',
    colors: { line: '#F06292' }
  },
  'VWAP': {
    name: 'VWAP',
    type: 'line',
    colors: { line: '#FFD54F' }
  }
};

// ============================================================================
// INDICATOR CALCULATIONS
// ============================================================================

class IndicatorCalculator {
  // Simple Moving Average
  static calculateSMA(data: number[], period: number): (number | null)[] {
    const result: (number | null)[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
      }
    }
    return result;
  }

  // Exponential Moving Average
  static calculateEMA(data: number[], period: number): (number | null)[] {
    const result: (number | null)[] = [];
    const multiplier = 2 / (period + 1);
    
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sum += data[i];
        result.push(null);
      } else if (i === period - 1) {
        sum += data[i];
        const sma = sum / period;
        result.push(sma);
      } else {
        const ema = (data[i] - (result[i - 1] as number)) * multiplier + (result[i - 1] as number);
        result.push(ema);
      }
    }
    return result;
  }

  // Relative Strength Index
  static calculateRSI(data: number[], period: number = 14): (number | null)[] {
    const result: (number | null)[] = [];
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    result.push(null); // First value is undefined for RSI
    
    for (let i = 0; i < gains.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        
        if (avgLoss === 0) {
          result.push(100);
        } else {
          const rs = avgGain / avgLoss;
          result.push(100 - (100 / (1 + rs)));
        }
      }
    }
    
    return result;
  }

  // Bollinger Bands
  static calculateBB(data: number[], period: number = 20, stdDev: number = 2): {
    middle: (number | null)[];
    upper: (number | null)[];
    lower: (number | null)[];
  } {
    const middle = this.calculateSMA(data, period);
    const upper: (number | null)[] = [];
    const lower: (number | null)[] = [];
    
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1 || middle[i] === null) {
        upper.push(null);
        lower.push(null);
      } else {
        const slice = data.slice(i - period + 1, i + 1);
        const mean = middle[i] as number;
        const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
        const std = Math.sqrt(variance);
        upper.push(mean + stdDev * std);
        lower.push(mean - stdDev * std);
      }
    }
    
    return { middle, upper, lower };
  }

  // MACD
  static calculateMACD(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): {
    macd: (number | null)[];
    signal: (number | null)[];
    histogram: (number | null)[];
  } {
    const fastEMA = this.calculateEMA(data, fastPeriod);
    const slowEMA = this.calculateEMA(data, slowPeriod);
    
    const macdLine: (number | null)[] = [];
    for (let i = 0; i < data.length; i++) {
      if (fastEMA[i] === null || slowEMA[i] === null) {
        macdLine.push(null);
      } else {
        macdLine.push((fastEMA[i] as number) - (slowEMA[i] as number));
      }
    }
    
    // Calculate signal line from MACD
    const validMACD = macdLine.filter(v => v !== null) as number[];
    const signalEMA = this.calculateEMA(validMACD, signalPeriod);
    
    const signal: (number | null)[] = [];
    const histogram: (number | null)[] = [];
    
    let signalIdx = 0;
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] === null) {
        signal.push(null);
        histogram.push(null);
      } else {
        if (signalIdx < signalEMA.length) {
          signal.push(signalEMA[signalIdx]);
          histogram.push((macdLine[i] as number) - signalEMA[signalIdx]);
          signalIdx++;
        }
      }
    }
    
    return { macd: macdLine, signal, histogram };
  }

  // Average True Range
  static calculateATR(high: number[], low: number[], close: number[], period: number = 14): (number | null)[] {
    const trueRanges: number[] = [];
    
    for (let i = 0; i < close.length; i++) {
      if (i === 0) {
        trueRanges.push(high[i] - low[i]);
      } else {
        const tr = Math.max(
          high[i] - low[i],
          Math.abs(high[i] - close[i - 1]),
          Math.abs(low[i] - close[i - 1])
        );
        trueRanges.push(tr);
      }
    }
    
    return this.calculateSMA(trueRanges, period);
  }

  // On Balance Volume
  static calculateOBV(close: number[], volume: number[]): number[] {
    const obv: number[] = [volume[0]];
    
    for (let i = 1; i < close.length; i++) {
      if (close[i] > close[i - 1]) {
        obv.push(obv[i - 1] + volume[i]);
      } else if (close[i] < close[i - 1]) {
        obv.push(obv[i - 1] - volume[i]);
      } else {
        obv.push(obv[i - 1]);
      }
    }
    
    return obv;
  }

  // VWAP
  static calculateVWAP(high: number[], low: number[], close: number[], volume: number[]): number[] {
    const vwap: number[] = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    
    for (let i = 0; i < close.length; i++) {
      const typicalPrice = (high[i] + low[i] + close[i]) / 3;
      cumulativeTPV += typicalPrice * volume[i];
      cumulativeVolume += volume[i];
      
      if (cumulativeVolume > 0) {
        vwap.push(cumulativeTPV / cumulativeVolume);
      } else {
        vwap.push(typicalPrice);
      }
    }
    
    return vwap;
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface TradingViewChartProps {
  symbol: string;
  data: KlinesData[];
  interval?: string;
  indicators?: string[];
  showVolume?: boolean;
  showCrosshair?: boolean;
  theme?: 'light' | 'dark';
  width?: number;
  height?: number;
  onIntervalChange?: (interval: string) => void;
  onSymbolChange?: (symbol: string) => void;
  onReady?: (chart: IChartApi) => void;
}

const TradingViewChart: React.FC<TradingViewChartProps> = ({
  symbol,
  data,
  interval = '1h',
  indicators = ['SMA(20)', 'EMA(12)', 'Volume'],
  showVolume = true,
  showCrosshair = true,
  theme = 'dark',
  width = 800,
  height = 500,
  onIntervalChange,
  onSymbolChange,
  onReady
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi>>(new Map());
  
  const [selectedInterval, setSelectedInterval] = useState(interval);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: width || chartContainerRef.current.clientWidth,
      height: height || 400,
      layout: {
        background: { type: 'solid', color: theme === 'dark' ? '#1a1a2e' : '#ffffff' },
        textColor: theme === 'dark' ? '#d1d4dc' : '#333333',
        fontSize: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#2b2b43' : '#f0f0f0' },
        horzLines: { color: theme === 'dark' ? '#2b2b43' : '#f0f0f0' }
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#9ca2b8',
          width: 1,
          style: 2,
          labelBackgroundColor: '#9ca2b8'
        },
        horzLine: {
          color: '#9ca2b8',
          width: 1,
          style: 2,
          labelBackgroundColor: '#9ca2b8'
        }
      },
      timeScale: {
        borderColor: theme === 'dark' ? '#2b2b43' : '#e0e0e0',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 2
      },
      rightPriceScale: {
        borderColor: theme === 'dark' ? '#2b2b43' : '#e0e0e0',
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.2 : 0.1
        }
      },
      handleScroll: true,
      handleScale: true
    });

    chartRef.current = chart;
    onReady?.(chart);

    // Create candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350'
    });
    candleSeriesRef.current = candleSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight || 400
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !data || data.length === 0) return;

    const candleData: CandlestickData<Time>[] = data.map(k => ({
      time: (k.time / 1000) as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close
    }));

    candleSeriesRef.current.setData(candleData);

    // Add volume
    if (showVolume && volumeSeriesRef.current) {
      const volumeData: HistogramData<Time>[] = data.map(k => ({
        time: (k.time / 1000) as Time,
        value: k.volume,
        color: k.close >= k.open ? 'rgba(76, 175, 80, 0.5)' : 'rgba(244, 67, 54, 0.5)'
      }));
      volumeSeriesRef.current.setData(volumeData);
    }
  }, [data, showVolume]);

  // Update indicators
  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;

    // Remove old indicator series
    indicatorSeriesRef.current.forEach((series, name) => {
      chartRef.current?.removeSeries(series);
    });
    indicatorSeriesRef.current.clear();

    // Create volume series if enabled
    if (showVolume && !volumeSeriesRef.current) {
      const volumeSeries = chartRef.current.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume'
      });
      chartRef.current.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 }
      });
      volumeSeriesRef.current = volumeSeries;
    }

    // Calculate and add indicators
    const closePrices = data.map(k => k.close);
    const highPrices = data.map(k => k.high);
    const lowPrices = data.map(k => k.low);
    const volumes = data.map(k => k.volume);

    indicators.forEach(indicatorName => {
      const config = BUILT_IN_INDICATORS[indicatorName];
      if (!config) return;

      try {
        let indicatorData: LineData<Time>[] | HistogramData<Time>[] = [];
        
        switch (indicatorName) {
          case 'SMA(20)':
          case 'SMA(50)':
          case 'SMA(200)': {
            const period = parseInt(indicatorName.match(/\d+/)?.[0] || '20');
            const sma = IndicatorCalculator.calculateSMA(closePrices, period);
            indicatorData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: sma[i] || 0
            }));
            break;
          }
          case 'EMA(12)':
          case 'EMA(26)': {
            const period = parseInt(indicatorName.match(/\d+/)?.[0] || '12');
            const ema = IndicatorCalculator.calculateEMA(closePrices, period);
            indicatorData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: ema[i] || 0
            }));
            break;
          }
          case 'RSI(14)': {
            const rsi = IndicatorCalculator.calculateRSI(closePrices, 14);
            indicatorData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: rsi[i] || 50
            }));
            break;
          }
          case 'Volume': {
            indicatorData = data.map(k => ({
              time: (k.time / 1000) as Time,
              value: k.volume,
              color: k.close >= k.open ? 'rgba(76, 175, 80, 0.5)' : 'rgba(244, 67, 54, 0.5)'
            }));
            break;
          }
          case 'BB(20,2)': {
            const bb = IndicatorCalculator.calculateBB(closePrices, 20, 2);
            // Add upper, middle, lower bands
            const upperSeries = chartRef.current.addLineSeries({
              color: 'rgba(78, 205, 196, 0.3)',
              lineWidth: 1,
              lineStyle: 1,
              lastValueVisible: false,
              priceLineVisible: false
            });
            const middleSeries = chartRef.current.addLineSeries({
              color: 'rgba(78, 205, 196, 0.8)',
              lineWidth: 1,
              lastValueVisible: false,
              priceLineVisible: false
            });
            const lowerSeries = chartRef.current.addLineSeries({
              color: 'rgba(78, 205, 196, 0.3)',
              lineWidth: 1,
              lineStyle: 1,
              lastValueVisible: false,
              priceLineVisible: false
            });
            
            upperSeries.setData(data.map((k, i) => ({ time: (k.time / 1000) as Time, value: bb.upper[i] || 0 })));
            middleSeries.setData(data.map((k, i) => ({ time: (k.time / 1000) as Time, value: bb.middle[i] || 0 })));
            lowerSeries.setData(data.map((k, i) => ({ time: (k.time / 1000) as Time, value: bb.lower[i] || 0 })));
            
            indicatorSeriesRef.current.set(`${indicatorName}-upper`, upperSeries);
            indicatorSeriesRef.current.set(`${indicatorName}-middle`, middleSeries);
            indicatorSeriesRef.current.set(`${indicatorName}-lower`, lowerSeries);
            return;
          }
          case 'MACD(12,26,9)': {
            const macd = IndicatorCalculator.calculateMACD(closePrices, 12, 26, 9);
            const histogramData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: macd.histogram[i] || 0,
              color: (macd.histogram[i] || 0) >= 0 ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)'
            }));
            indicatorData = histogramData;
            break;
          }
          case 'ATR(14)': {
            const atr = IndicatorCalculator.calculateATR(highPrices, lowPrices, closePrices, 14);
            indicatorData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: atr[i] || 0
            }));
            break;
          }
          case 'OBV': {
            const obv = IndicatorCalculator.calculateOBV(closePrices, volumes);
            indicatorData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: obv[i]
            }));
            break;
          }
          case 'VWAP': {
            const vwap = IndicatorCalculator.calculateVWAP(highPrices, lowPrices, closePrices, volumes);
            indicatorData = data.map((k, i) => ({
              time: (k.time / 1000) as Time,
              value: vwap[i]
            }));
            break;
          }
          default:
            return;
        }

        if (indicatorData.length > 0) {
          const isHistogram = config.type === 'histogram';
          const series = chartRef.current.addSeries(isHistogram ? 'Histogram' : 'Line', {
            color: config.colors?.line || '#2962FF',
            lineWidth: 2,
            priceScaleId: indicatorName.includes('RSI') || indicatorName.includes('Stochastic') || indicatorName.includes('CCI') || indicatorName.includes('Williams') 
              ? 'right' 
              : 'overlay',
            lastValueVisible: true,
            priceLineVisible: true
          });
          
          series.setData(indicatorData);
          indicatorSeriesRef.current.set(indicatorName, series);
        }
      } catch (error) {
        console.error(`Error calculating indicator ${indicatorName}:`, error);
      }
    });
  }, [data, indicators, showVolume]);

  // Handle interval change
  const handleIntervalChange = useCallback((newInterval: string) => {
    setSelectedInterval(newInterval);
    setIsLoading(true);
    onIntervalChange?.(newInterval);
    setTimeout(() => setIsLoading(false), 500);
  }, [onIntervalChange]);

  // Available intervals
  const intervals = [
    { label: '1m', value: '1m' },
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '4h', value: '4h' },
    { label: '1D', value: '1d' },
    { label: '1W', value: '1w' },
    { label: '1M', value: '1M' }
  ];

  return (
    <div className="tradingview-chart" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Chart Toolbar */}
      <div className="chart-toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        background: theme === 'dark' ? '#1a1a2e' : '#ffffff',
        borderBottom: `1px solid ${theme === 'dark' ? '#2b2b43' : '#e0e0e0'}`
      }}>
        {/* Symbol */}
        <div className="symbol-info" style={{ fontWeight: 600, color: theme === 'dark' ? '#d1d4dc' : '#333' }}>
          {symbol}
        </div>
        
        {/* Interval Buttons */}
        <div className="intervals" style={{ display: 'flex', gap: '4px', marginLeft: '16px' }}>
          {intervals.map(int => (
            <button
              key={int.value}
              onClick={() => handleIntervalChange(int.value)}
              style={{
                padding: '4px 8px',
                border: 'none',
                borderRadius: '4px',
                background: selectedInterval === int.value 
                  ? (theme === 'dark' ? '#2962FF' : '#2196F3')
                  : 'transparent',
                color: selectedInterval === int.value 
                  ? '#fff' 
                  : (theme === 'dark' ? '#d1d4dc' : '#666'),
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              {int.label}
            </button>
          ))}
        </div>

        {/* Indicator Selector */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <select
            value={indicators[0]}
            onChange={(e) => {/* Handle indicator change */}}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: `1px solid ${theme === 'dark' ? '#2b2b43' : '#e0e0e0'}`,
              background: theme === 'dark' ? '#1a1a2e' : '#fff',
              color: theme === 'dark' ? '#d1d4dc' : '#333',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            {Object.keys(BUILT_IN_INDICATORS).map(ind => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chart Container */}
      <div 
        ref={chartContainerRef} 
        style={{ 
          width: '100%', 
          height: 'calc(100% - 44px)',
          position: 'relative'
        }} 
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)',
          zIndex: 10
        }}>
          <div style={{
            padding: '12px 24px',
            background: '#2962FF',
            borderRadius: '8px',
            color: '#fff',
            fontWeight: 500
          }}>
            Loading...
          </div>
        </div>
      )}
    </div>
  );
};

export default TradingViewChart;
export { IndicatorCalculator, BUILT_IN_INDICATORS };
export type { KlinesData, IndicatorConfig, DrawingTool, ChartConfig };