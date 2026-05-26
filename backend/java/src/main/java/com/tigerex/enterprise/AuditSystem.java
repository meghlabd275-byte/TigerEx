package com.tigerex.enterprise;

import java.util.*;
import java.time.Instant;

/**
 * TigerEx Audit System - Java Enterprise Implementation
 * Comprehensive audit logging for compliance and security
 */
public class AuditSystem {
    
    // ========================================================================
    // DATA STRUCTURES
    // ========================================================================
    
    public static class AuditLog {
        private String id;
        private String userId;
        private String action;
        private String resource;
        private Map<String, Object> details;
        private String ip;
        private String userAgent;
        private long timestamp;
        private String result;
        
        public AuditLog(String action, String resource, String result) {
            this.id = "AUDIT_" + System.currentTimeMillis();
            this.action = action;
            this.resource = resource;
            this.result = result;
            this.timestamp = Instant.now().toEpochMilli();
            this.details = new HashMap<>();
        }
        
        // Getters and setters
        public String getId() { return id; }
        public void setUserId(String userId) { this.userId = userId; }
        public String getAction() { return action; }
        public void setAction(String action) { this.action = action; }
        public String getResource() { return resource; }
        public void setResource(String resource) { this.resource = resource; }
        public Map<String, Object> getDetails() { return details; }
        public void setDetails(Map<String, Object> details) { this.details = details; }
        public String getIp() { return ip; }
        public void setIp(String ip) { this.ip = ip; }
        public String getUserAgent() { return userAgent; }
        public void setUserAgent(String userAgent) { this.userAgent = userAgent; }
        public long getTimestamp() { return timestamp; }
        public void setTimestamp(long timestamp) { this.timestamp = timestamp; }
        public String getResult() { return result; }
        public void setResult(String result) { this.result = result; }
    }
    
    public static class AuditFilters {
        private String userId;
        private String action;
        private String resource;
        private Long start;
        private Long end;
        private String result;
        
        public AuditFilters() {}
        
        public AuditFilters setUserId(String userId) {
            this.userId = userId;
            return this;
        }
        
        public AuditFilters setAction(String action) {
            this.action = action;
            return this;
        }
        
        public AuditFilters setResource(String resource) {
            this.resource = resource;
            return this;
        }
        
        public AuditFilters setStart(Long start) {
            this.start = start;
            return this;
        }
        
        public AuditFilters setEnd(Long end) {
            this.end = end;
            return this;
        }
        
        public AuditFilters setResult(String result) {
            this.result = result;
            return this;
        }
    }
    
    // ========================================================================
    // PRIVATE FIELDS
    // ========================================================================
    
    private List<AuditLog> logs = new ArrayList<>();
    private long counter = 0;
    private static final int MAX_LOGS = 100000;
    
    // ========================================================================
    // METHODS
    // ========================================================================
    
    /**
     * Log an audit event
     */
    public AuditLog log(AuditLog event) {
        event.id = "AUDIT_" + (++counter);
        event.timestamp = Instant.now().toEpochMilli();
        
        logs.add(event);
        
        // Trim logs if exceeding max
        if (logs.size() > MAX_LOGS) {
            logs = logs.subList(logs.size() - MAX_LOGS/2, logs.size());
        }
        
        return event;
    }
    
    /**
     * Log simple action
     */
    public AuditLog log(String action, String resource, String result) {
        AuditLog log = new AuditLog(action, resource, result);
        return log(log);
    }
    
    /**
     * Query audit logs with filters
     */
    public List<AuditLog> query(AuditFilters filters) {
        List<AuditLog> results = new ArrayList<>();
        
        for (AuditLog log : logs) {
            boolean match = true;
            
            if (filters.userId != null && !filters.userId.equals(log.userId)) {
                match = false;
            }
            if (match && filters.action != null && !filters.action.equals(log.action)) {
                match = false;
            }
            if (match && filters.resource != null && !filters.resource.equals(log.resource)) {
                match = false;
            }
            if (match && filters.start != null && log.timestamp < filters.start) {
                match = false;
            }
            if (match && filters.end != null && log.timestamp > filters.end) {
                match = false;
            }
            if (match && filters.result != null && !filters.result.equals(log.result)) {
                match = false;
            }
            
            if (match) {
                results.add(log);
            }
        }
        
        return results;
    }
    
    /**
     * Get recent audit logs
     */
    public List<AuditLog> getRecent(int limit) {
        int from = Math.max(0, logs.size() - limit);
        return new ArrayList<>(logs.subList(from, logs.size()));
    }
    
    /**
     * Get all logs for a user
     */
    public List<AuditLog> getUserLogs(String userId) {
        List<AuditLog> results = new ArrayList<>();
        for (AuditLog log : logs) {
            if (userId.equals(log.userId)) {
                results.add(log);
            }
        }
        return results;
    }
    
    /**
     * Get all logs for an action
     */
    public List<AuditLog> getActionLogs(String action) {
        List<AuditLog> results = new ArrayList<>();
        for (AuditLog log : logs) {
            if (action.equals(log.action)) {
                results.add(log);
            }
        }
        return results;
    }
    
    /**
     * Get failed actions
     */
    public List<AuditLog> getFailedActions() {
        List<AuditLog> results = new ArrayList<>();
        for (AuditLog log : logs) {
            if ("failure".equals(log.result)) {
                results.add(log);
            }
        }
        return results;
    }
    
    /**
     * Get statistics
     */
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalLogs", logs.size());
        
        // Count by action
        Map<String, Integer> actionCounts = new HashMap<>();
        for (AuditLog log : logs) {
            actionCounts.put(log.action, actionCounts.getOrDefault(log.action, 0) + 1);
        }
        stats.put("byAction", actionCounts);
        
        // Count by result
        Map<String, Integer> resultCounts = new HashMap<>();
        for (AuditLog log : logs) {
            resultCounts.put(log.result, resultCounts.getOrDefault(log.result, 0) + 1);
        }
        stats.put("byResult", resultCounts);
        
        return stats;
    }
    
    /**
     * Clear old logs
     */
    public void cleanup(long beforeTimestamp) {
        logs.removeIf(log -> log.timestamp < beforeTimestamp);
    }
}