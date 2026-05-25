/**
 * OBSERVABILITY STACK MODULE
 * Complete Prometheus + Grafana monitoring infrastructure
 * 
 * Feature: Already partially implemented
 * Enhanced for: Complete operational observability
 * Latest Update: 2024-2026
 */

'use strict';

/**
 * Prometheus MetricsExporter
 * Exports metrics inPrometheus format
 */
class PrometheusMetricsExporter {
  constructor(config = {}) {
    this.port = config.port || 9090;
    this.metricsPath = config.metricsPath || '/metrics';
    this.registry = new Map();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.summaries = new Map();
  }

  /**
   * Counter metric for monotonically increasing values
   * @param {string} name - Metric name
   * @param {string} help - Help text
   * @param {Array} labels - Label names
   */
  counter(name, help, labels = []) {
    const key = `counter_${name}`;
    if (!this.counters.has(key)) {
      this.counters.set(key, {
        name,
        help,
        type: 'counter',
        labels,
        values: new Map(),
      });
    }
    return {
      inc: (value = 1, labelValues = {}) => {
        const counter = this.counters.get(key);
        const labelKey = JSON.stringify(labelValues);
        const current = counter.values.get(labelKey) || 0;
        counter.values.set(labelKey, current + value);
      },
      getValue: (labelValues = {}) => {
        const counter = this.counters.get(key);
        const labelKey = JSON.stringify(labelValues);
        return counter?.values?.get(labelKey) || 0;
      },
    };
  }

  /**
   * Gauge metric for fluctuating values
   * @param {string} name - Metric name
   * @param {string} help - Help text  
   * @param {Array} labels - Label names
   */
  gauge(name, help, labels = []) {
    const key = `gauge_${name}`;
    if (!this.gauges.has(key)) {
      this.gauges.set(key, {
        name,
        help,
        type: 'gauge',
        labels,
        values: new Map(),
      });
    }
    return {
      inc: (value = 1, labelValues = {}) => {
        const gauge = this.gauges.get(key);
        const labelKey = JSON.stringify(labelValues);
        const current = gauge.values.get(labelKey) || 0;
        gauge.values.set(labelKey, current + value);
      },
      dec: (value = 1, labelValues = {}) => {
        const gauge = this.gauges.get(key);
        const labelKey = JSON.stringify(labelValues);
        const current = gauge.values.get(labelKey) || 0;
        gauge.values.set(labelKey, current - value);
      },
      set: (value, labelValues = {}) => {
        const gauge = this.gauges.get(key);
        const labelKey = JSON.stringify(labelValues);
        gauge.values.set(labelKey, value);
      },
      getValue: (labelValues = {}) => {
        const gauge = this.gauges.get(key);
        const labelKey = JSON.stringify(labelValues);
        return gauge?.values?.get(labelKey) || 0;
      },
    };
  }

  /**
   * Histogram metric for distribution tracking
   * @param {string} name - Metric name
   * @param {string} help - Help text
   * @param {Array} buckets - Bucket boundaries
   * @param {Array} labels - Label names
   */
  histogram(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], labels = []) {
    const key = `histogram_${name}`;
    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        name,
        help,
        type: 'histogram',
        buckets,
        labels,
        values: new Map(),
        sum: 0,
        count: 0,
      });
    }
    return {
      observe: (value, labelValues = {}) => {
        const histogram = this.histograms.get(key);
        const labelKey = JSON.stringify(labelValues);
        
        if (!histogram.values.has(labelKey)) {
          histogram.values.set(labelKey, {
            buckets: {},
            sum: 0,
            count: 0,
          });
          histogram.buckets.forEach(b => {
            histogram.values.get(labelKey).buckets[b] = 0;
          });
        }
        
        const entry = histogram.values.get(labelKey);
        entry.sum += value;
        entry.count += 1;
        
        histogram.buckets.forEach(bucket => {
          if (value <= bucket) {
            entry.buckets[bucket]++;
          }
        });
      },
      getValue: (labelValues = {}) => {
        const histogram = this.histograms.get(key);
        const labelKey = JSON.stringify(labelValues);
        return histogram?.values?.get(labelKey) || null;
      },
    };
  }

  /**
   * Summary metric for percentile tracking
   * @param {string} name - Metric name
   * @param {string} help - Help text
   * @param {Array} percentiles - Percentile boundaries
   * @param {Array} labels - Label names
   */
  summary(name, help, percentiles = [0.5, 0.9, 0.95, 0.99], labels = []) {
    const key = `summary_${name}`;
    if (!this.summaries.has(key)) {
      this.summaries.set(key, {
        name,
        help,
        type: 'summary',
        percentiles,
        labels,
        values: new Map(),
      });
    }
    return {
      observe: (value, labelValues = {}) => {
        const summary = this.summaries.get(key);
        const labelKey = JSON.stringify(labelValues);
        
        if (!summary.values.has(labelKey)) {
          summary.values.set(labelKey, []);
        }
        
        const arr = summary.values.get(labelKey);
        arr.push(value);
        arr.sort((a, b) => a - b);
      },
      getValue: (labelValues = {}) => {
        const summary = this.summaries.get(key);
        const labelKey = JSON.stringify(labelValues);
        const arr = summary?.values?.get(labelKey) || [];
        
        const result = {};
        summary.percentiles.forEach(p => {
          const idx = Math.ceil(arr.length * p) - 1;
          result[`${p * 100}%`] = arr[idx] || 0;
        });
        
        return result;
      },
    };
  }

  /**
   * Generate Prometheus exposition format output
   */
  render() {
    let output = '';

    // Render counters
    for (const [, counter] of this.counters) {
      output += `# HELP ${counter.name} ${counter.help}\n`;
      output += `# TYPE ${counter.name} counter\n`;
      
      for (const [labelKey, value] of counter.values) {
        const labels = labelKey === '{}' ? '' : ` {${labelKey.slice(1, -1).replace(/:/g, '=')}}`;
        output += `${counter.name}${labels} ${value}\n`;
      }
    }

    // Render gauges
    for (const [, gauge] of this.gauges) {
      output += `# HELP ${gauge.name} ${gauge.help}\n`;
      output += `# TYPE ${gauge.name} gauge\n`;
      
      for (const [labelKey, value] of gauge.values) {
        const labels = labelKey === '{}' ? '' : ` {${labelKey.slice(1, -1).replace(/:/g, '=')}}`;
        output += `${gauge.name}${labels} ${value}\n`;
      }
    }

    // Render histograms
    for (const [, histogram] of this.histograms) {
      output += `# HELP ${histogram.name} ${histogram.help}\n`;
      output += `# TYPE ${histogram.name} histogram\n`;
      
      for (const [labelKey, data] of histogram.values) {
        const labels = labelKey === '{}' ? '' : ` {${labelKey.slice(1, -1).replace(/:/g, '=')}}`;
        
        output += `${histogram.name}_bucket{${labels},le="+Inf"} ${data.count}\n`;
        
        for (const bucket of histogram.buckets.reverse()) {
          output += `${histogram.name}_bucket{${labels},le="${bucket}"} ${data.buckets[bucket]}\n`;
        }
        
        output += `${histogram.name}_sum${labels} ${data.sum}\n`;
        output += `${histogram.name}_count${labels} ${data.count}\n`;
      }
    }

    // Render summaries
    for (const [, summary] of this.summaries) {
      output += `# HELP ${summary.name} ${summary.help}\n`;
      output += `# TYPE ${summary.name} summary\n`;
      
      for (const [labelKey, arr] of summary.values) {
        const labels = labelKey === '{}' ? '' : ` {${labelKey.slice(1, -1).replace(/:/g, '=')}}`;
        
        summary.percentiles.forEach(p => {
          const idx = Math.ceil(arr.length * p) - 1;
          output += `${summary.name}${labels} {quantile="${p}"} ${arr[idx] || 0}\n`;
        });
        
        output += `${summary.name}_sum${labels} ${arr.reduce((a, b) => a + b, 0)}\n`;
        output += `${summary.name}_count${labels} ${arr.length}\n`;
      }
    }

    return output;
  }

  /**
   * Express.js middleware compatible handler
   */
  expressMiddleware() {
    return (req, res) => {
      if (req.path === this.metricsPath) {
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(this.render());
      } else {
        res.status(404).send('Not Found');
      }
    };
  }
}

/**
 * Predefined Exchange Metrics
 */
class ExchangeMetrics {
  constructor(exporter) {
    this.exporter = exporter;
    
    // Trading metrics
    this.tradesTotal = exporter.counter(
      'exchange_trades_total',
      'Total number of trades executed',
      ['pair', 'side', 'status']
    );
    
    this.tradeVolume = exporter.histogram(
      'exchange_trade_volume_usd',
      'Trade volume in USD',
      [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000, 100000],
      ['pair', 'side']
    );
    
    this.orderLatency = exporter.histogram(
      'exchange_order_latency_seconds',
      'Order processing latency in seconds'
    );
    
    this.orderQueueDepth = exporter.gauge(
      'exchange_order_queue_depth',
      'Number of orders pending execution',
      ['pair', 'type']
    );
    
    this.matchRate = exporter.gauge(
      'exchange_match_rate',
      'Orders matched per second'
    );
    
    // Wallet metrics
    this.walletBalance = exporter.gauge(
      'exchange_wallet_balance',
      'Wallet balance by currency',
      ['currency', 'wallet_type']
    );
    
    this.withdrawalsPending = exporter.gauge(
      'exchange_withdrawals_pending',
      'Pending withdrawal count'
    );
    
    // System metrics
    this.connectionCount = exporter.gauge(
      'exchange_connections',
      'Active WebSocket connections'
    );
    
    this.memoryUsage = exporter.gauge(
      'exchange_memory_usage_bytes',
      'Memory usage in bytes',
      ['type']
    );
    
    this.cpuLoad = exporter.gauge(
      'exchange_cpu_load',
      'CPU load average'
    );
    
    this.healthCheckStatus = exporter.gauge(
      'exchange_health_check_status',
      'Health check status (1=healthy, 0=unhealthy)',
      ['component']
    );
    
    // API metrics
    this.apiRequestDuration = exporter.histogram(
      'exchange_api_request_duration_seconds',
      'API request duration in seconds',
      [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
      ['method', 'endpoint', 'status']
    );
    
    this.apiRequestTotal = exporter.counter(
      'exchange_api_requests_total',
      'Total API requests',
      ['method', 'endpoint', 'status']
    );
    
    this.rateLimitRemaining = exporter.gauge(
      'exchange_rate_limit_remaining',
      'Remaining rate limit quota',
      ['user', 'endpoint']
    );
  }

  /**
   * Record trade execution
   * @param {Object} params - Trade parameters
   */
  recordTrade(params) {
    const { pair, side, status, volumeUsd, latency } = params;
    
    this.tradesTotal.inc(1, { pair, side, status });
    this.tradeVolume.observe(volumeUsd, { pair, side });
    this.orderLatency.observe(latency);
  }

  /**
   * Record API request
   * @param {Object} params - Request parameters
   */
  recordApiRequest(params) {
    const { method, endpoint, statusCode, duration } = params;
    
    this.apiRequestDuration.observe(duration, { method, endpoint, status: statusCode.toString() });
    this.apiRequestTotal.inc(1, { method, endpoint, status: statusCode.toString() });
  }

  /**
   * Record component health
   * @param {string} component - Component name
   * @param {boolean} isHealthy - Health status
   */
  recordHealth(component, isHealthy) {
    this.healthCheckStatus.set(isHealthy ? 1 : 0, { component });
  }
}

/**
 * Grafana Dashboard Configuration Generator
 */
class GrafanaDashboardGenerator {
  /**
   * Generate dashboard JSON
   * @param {Object} config - Dashboard config
   * @returns {Object} Grafana dashboard
   */
  static generateDashboard(config = {}) {
    return {
      dashboard: {
        title: config.title || 'TigerEx Exchange Dashboard',
        uid: config.uid || 'tigerex-exchange',
        tags: ['tigerex', 'exchange'],
        timezone: 'browser',
        schemaVersion: 16,
        version: config.version || 1,
        refresh: config.refresh || '5s',
        panels: [
          this.generateTradeVolumePanel(),
          this.generateOrderLatencyPanel(),
          this.generateConnectionPanel(),
          this.generateWalletBalancePanel(),
          this.generateApiLatencyPanel(),
          this.generateHealthPanel(),
        ],
      },
    };
  }

  static generateTradeVolumePanel() {
    return {
      id: 1,
      title: 'Trade Volume (USD)',
      type: 'graph',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      targets: [
        {
          expr: 'rate(exchange_trade_volume_usd_sum[5m]) / rate(exchange_trade_volume_usd_count[5m])',
          legendFormat: '{{pair}} - {{side}}',
        },
      ],
    };
  }

  static generateOrderLatencyPanel() {
    return {
      id: 2,
      title: 'Order Processing Latency',
      type: 'graph',
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      targets: [
        {
          expr: 'histogram_quantile(0.95, rate(exchange_order_latency_seconds_bucket[5m]))',
          legendFormat: 'P95',
        },
        {
          expr: 'histogram_quantile(0.99, rate(exchange_order_latency_seconds_bucket[5m]))',
          legendFormat: 'P99',
        },
      ],
    };
  }

  static generateConnectionPanel() {
    return {
      id: 3,
      title: 'Active Connections',
      type: 'stat',
      gridPos: { x: 0, y: 8, w: 6, h: 4 },
      targets: [
        {
          expr: 'exchange_connections',
        },
      ],
    };
  }

  static generateWalletBalancePanel() {
    return {
      id: 4,
      title: 'Wallet Balances',
      type: 'table',
      gridPos: { x: 6, y: 8, w: 12, h: 4 },
      targets: [
        {
          expr: 'exchange_wallet_balance',
        },
      ],
    };
  }

  static generateApiLatencyPanel() {
    return {
      id: 5,
      title: 'API Response Time',
      type: 'graph',
      gridPos: { x: 0, y: 12, w: 12, h: 8 },
      targets: [
        {
          expr: 'histogram_quantile(0.50, rate(exchange_api_request_duration_seconds_bucket[5m]))',
          legendFormat: 'P50 - {{method}} {{endpoint}}',
        },
        {
          expr: 'histogram_quantile(0.95, rate(exchange_api_request_duration_seconds_bucket[5m]))',
          legendFormat: 'P95 - {{method}} {{endpoint}}',
        },
      ],
    };
  }

  static generateHealthPanel() {
    return {
      id: 6,
      title: 'Component Health',
      type: 'stat',
      gridPos: { x: 12, y: 12, w: 12, h: 8 },
      targets: [
        {
          expr: 'exchange_health_check_status',
          legendFormat: '{{component}}',
        },
      ],
    };
  }
}

/**
 * Alert Rule Generator
 */
class AlertRuleGenerator {
  /**
   * Generate alert rules
   * @param {Object} config - Alert configuration
   * @returns {Object} Prometheus alert rules
   */
  static generateAlertRules(config = {}) {
    return {
      groups: [{
        name: 'tigerex-exchange-alerts',
        rules: [
          this.generateHighLatencyAlert(config.highLatencyThreshold || 1),
          this.generateHighErrorRateAlert(config.errorRateThreshold || 0.01),
          this.generateLowConnectionsAlert(config.minConnections || 100),
          this.generateHighMemoryAlert(config.memoryThreshold || 90),
          this.generateUnhealthyComponentAlert(),
          this.generateRateLimitAlert(),
        ],
      }],
    };
  }

  static generateHighLatencyAlert(threshold) {
    return {
      alert: 'HighOrderLatency',
      expr: `histogram_quantile(0.95, rate(exchange_order_latency_seconds_bucket[5m])) > ${threshold}`,
      for: '2m',
      labels: {
        severity: 'critical',
      },
      annotations: {
        summary: 'High order processing latency',
        description: 'Order processing P95 latency is above {{ $value }}s for 2 minutes',
      },
    };
  }

  static generateHighErrorRateAlert(threshold) {
    return {
      alert: 'HighErrorRate',
      expr: `rate(exchange_trades_total{satus="failed"}[5m]) / rate(exchange_trades_total[5m]) > ${threshold}`,
      for: '1m',
      labels: {
        severity: 'critical',
      },
      annotations: {
        summary: 'High trade failure rate',
        description: 'Trade failure rate is above {{ $value | percent }}',
      },
    };
  }

  static generateLowConnectionsAlert(minConnections) {
    return {
      alert: 'LowConnections',
      expr: `exchange_connections < ${minConnections}`,
      for: '5m',
      labels: {
        severity: 'warning',
      },
      annotations: {
        summary: 'Low connection count',
        description: 'Active connections dropped below {{ $value }}',
      },
    };
  }

  static generateHighMemoryAlert(thresholdPercent) {
    return {
      alert: 'HighMemoryUsage',
      expr: `(exchange_memory_usage_bytes{type="heap"} / exchange_memory_usage_bytes{type="rss"}) * 100 > ${thresholdPercent}`,
      for: '5m',
      labels: {
        severity: 'warning',
      },
      annotations: {
        summary: 'High memory usage',
        description: 'Heap memory usage is above {{ $value }}%',
      },
    };
  }

  static generateUnhealthyComponentAlert() {
    return {
      alert: 'UnhealthyComponent',
      expr: 'exchange_health_check_status == 0',
      for: '1m',
      labels: {
        severity: 'critical',
      },
      annotations: {
        summary: 'Component unhealthy',
        description: '{{ $labels.component }} is unhealthy',
      },
    };
  }

  static generateRateLimitAlert() {
    return {
      alert: 'ApproachingRateLimit',
      expr: 'exchange_rate_limit_remaining < 100',
      for: '2m',
      labels: {
        severity: 'warning',
      },
      annotations: {
        summary: 'Approaching rate limit',
        description: '{{ $labels.user }} approaching rate limit on {{ $labels.endpoint }}',
      },
    };
  }
}

/**
 * Service Monitor Setup
 */
class ObservabilityService {
  constructor(config = {}) {
    this.config = config;
    this.exporter = new PrometheusMetricsExporter(config);
    this.metrics = new ExchangeMetrics(this.exporter);
  }

  /**
   * Start metrics server
   */
  async start() {
    console.log(`📊 Observability server starting on port ${this.exporter.port}`);
    console.log(`📈 Metrics available at ${this.exporter.metricsPath}`);
    console.log(`📓 Dashboard: Import Grafana dashboard from observability_stack`);
  }

  /**
   * Get middleware
   */
  getMiddleware() {
    return this.exporter.expressMiddleware();
  }

  /**
   * Get exportable functions
   */
  getFunctions() {
    return {
      counter: (...args) => this.exporter.counter(...args),
      gauge: (...args) => this.exporter.gauge(...args),
      histogram: (...args) => this.exporter.histogram(...args),
    };
  }
}

// Export module
module.exports = {
  PrometheusMetricsExporter,
  ExchangeMetrics,
  GrafanaDashboardGenerator,
  AlertRuleGenerator,
  ObservabilityService,
};