package com.tigerex.analytics;

import java.util.*;
import java.time.*;

public class BIEngine {
    private Map<String, Double> metrics = new HashMap<>();
    private Map<String, List<Double>> series = new HashMap<>();
    
    public void record(String metric, double value) {
        metrics.merge(metric, value, Double::sum);
        series.computeIfAbsent(metric, k -> new ArrayList<>()).add(value);
    }
    
    public double get(String metric) {
        return metrics.getOrDefault(metric, 0.0);
    }
    
    public double avg(String metric) {
        List<Double> vals = series.get(metric);
        if (vals == null || vals.isEmpty()) return 0;
        return vals.stream().mapToDouble(v -> v).average().orElse(0);
    }
    
    public double sum(String metric) {
        List<Double> vals = series.get(metric);
        if (vals == null) return 0;
        return vals.stream().mapToDouble(v -> v).sum();
    }
    
    public double percentile(String metric, double p) {
        List<Double> vals = series.get(metric);
        if (vals == null || vals.isEmpty()) return 0;
        
        List<Double> sorted = new ArrayList<>(vals);
        Collections.sort(sorted);
        int idx = (int) Math.ceil(p / 100.0 * sorted.size()) - 1;
        return sorted.get(Math.max(0, idx));
    }
    
    public Map<String, Object> generateReport() {
        Map<String, Object> report = new HashMap<>();
        for (String metric : metrics.keySet()) {
            Map<String, Object> stats = new HashMap<>();
            stats.put("sum", sum(metric));
            stats.put("avg", avg(metric));
            stats.put("p50", percentile(metric, 50));
            stats.put("p95", percentile(metric, 95));
            stats.put("p99", percentile(metric, 99));
            report.put(metric, stats);
        }
        return report;
    }
}