package com.tigerex.compliance;

import java.util.*;

public class ComplianceChecker {
    private Map<String, Activity> activities = new HashMap<>();
    private Map<String, Report> reports = new HashMap<>();

    public void recordActivity(String userId, String type, double amount) {
        activities.put(userId, new Activity(userId, type, amount));
    }

    public boolean checkLargeTransaction(double amount) {
        return amount > 10000;
    }

    public Report generateSAR(String userId, String reason) {
        Report sar = new Report("SAR", userId, reason);
        reports.put(sar.id, sar);
        return sar;
    }

    public static class Activity {
        public String userId, type;
        public double amount;
        public Date timestamp;

        public Activity(String u, String t, double a) {
            userId = u; type = t; amount = a; timestamp = new Date();
        }
    }

    public static class Report {
        public String id, userId, reason;
        public Date generated;

        public Report(String t, String u, String r) {
            id = UUID.randomUUID().toString();
            userId = u; reason = r; generated = new Date();
        }
    }

    public static void main(String[] args) {
        ComplianceChecker cc = new ComplianceChecker();
        cc.recordActivity("user1", "deposit", 15000);
        System.out.println("SAR: " + cc.generateSAR("user1", "large"));
    }
}