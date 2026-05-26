package com.tigerex.compliance;

/**
 * Travel Rule Compliance System
 * Required for international crypto transfers (FATF Travel Rule)
 * Compliant with US, EU, UK regulations
 * 
 * Migration from TypeScript to Java
 */

import java.util.*;
import java.time.Instant;

// Transfer type
enum TransferType {
    WALLET_TRANSFER("wallet_transfer"),
    EXCHANGE_TRANSFER("exchange_transfer"),
    CUSTODIAL("custodial");
    
    private final String value;
    TransferType(String v) { this.value = v; }
    public String getValue() { return value; }
}

// Travel rule data
class TravelRuleData {
    // Sender
    private String senderName;
    private String senderAccountNumber;
    private String senderGeographicAddress;
    private String senderLegalName;
    private String senderCountry;
    private String senderTIN;
    
    // Recipient
    private String recipientName;
    private String recipientAccountNumber;
    private String recipientGeographicAddress;
    private String recipientCountry;
    private String recipientTIN;
    
    // Transaction
    private double amount;
    private String currency;
    private long timestamp;
    private String cryptoChain;
    private String txHash;
    
    // Transfer type
    private TransferType transferType;
    
    // Getters and setters
    public String getSenderName() { return senderName; }
    public void setSenderName(String n) { this.senderName = n; }
    public String getSenderAccountNumber() { return senderAccountNumber; }
    public void setSenderAccountNumber(String n) { this.senderAccountNumber = n; }
    public String getSenderCountry() { return senderCountry; }
    public void setSenderCountry(String c) { this.senderCountry = c; }
    public String getRecipientName() { return recipientName; }
    public void setRecipientName(String n) { this.recipientName = n; }
    public String getRecipientCountry() { return recipientCountry; }
    public void setRecipientCountry(String c) { this.recipientCountry = c; }
    public double getAmount() { return amount; }
    public void setAmount(double a) { this.amount = a; }
    public String getCurrency() { return currency; }
    public void setCurrency(String c) { this.currency = c; }
    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long t) { this.timestamp = t; }
    public TransferType getTransferType() { return transferType; }
    public void setTransferType(TransferType t) { this.transferType = t; }
    public String getCryptoChain() { return cryptoChain; }
    public void setCryptoChain(String c) { this.cryptoChain = c; }
}

// Travel rule compliance config
class TravelRuleCompliance {
    private double threshold;
    private List<String> countries;
    private List<String> blockedCountries;
    private List<String> requiredFields;
    
    public TravelRuleCompliance() {
        this.countries = Arrays.asList("US", "EU", "UK", "JP", "SG");
        this.blockedCountries = Arrays.asList("KP", "IR", "SY");
        this.requiredFields = Arrays.asList("senderName", "senderCountry", "recipientName", "recipientCountry");
        this.threshold = 1000.0;
    }
    
    public double getThreshold() { return threshold; }
    public void setThreshold(double t) { this.threshold = t; }
    public List<String> getCountries() { return countries; }
    public List<String> getBlockedCountries() { return blockedCountries; }
    public boolean isBlockedCountry(String country) {
        return blockedCountries.contains(country);
    }
}

// Travel rule status
enum TravelRuleStatus {
    PENDING("pending"),
    VERIFIED("verified"),
    FLAGGED("flagged"),
    BLOCKED("blocked");
    
    private final String value;
    TravelRuleStatus(String v) { this.value = v; }
}

// Travel rule record
class TravelRuleRecord {
    private String id;
    private String transferId;
    private TravelRuleData data;
    private TravelRuleStatus status;
    private long verifiedAt;
    private String verifiedBy;
    private String notes;
    
    public TravelRuleRecord(String transferId, TravelRuleData data) {
        this.id = "TR_" + System.currentTimeMillis();
        this.transferId = transferId;
        this.data = data;
        this.status = TravelRuleStatus.PENDING;
    }
    
    // Getters
    public String getId() { return id; }
    public String getTransferId() { return transferId; }
    public TravelRuleData getData() { return data; }
    public TravelRuleStatus getStatus() { return status; }
    public void setStatus(TravelRuleStatus s) { this.status = s; }
    public long getVerifiedAt() { return verifiedAt; }
    public void setVerifiedAt(long t) { this.verifiedAt = t; }
    public String getVerifiedBy() { return verifiedBy; }
    public void setVerifiedBy(String by) { this.verifiedBy = by; }
    public String getNotes() { return notes; }
    public void setNotes(String n) { this.notes = n; }
}

// Travel Rule Manager
public class TravelRuleManager {
    private Map<String, TravelRuleRecord> records;
    private TravelRuleCompliance compliance;
    
    public TravelRuleManager() {
        this.records = new HashMap<>();
        this.compliance = new TravelRuleCompliance();
    }
    
    /**
     * Check if travel rule applies
     */
    public boolean requiresTravelRule(double amount, String country) {
        // Check threshold
        if (amount < compliance.getThreshold()) {
            return false;
        }
        // Check country
        if (!compliance.getCountries().contains(country)) {
            return false;
        }
        return true;
    }
    
    /**
     * Create travel rule record
     */
    public String createRecord(String transferId, TravelRuleData data) {
        TravelRuleRecord record = new TravelRuleRecord(transferId, data);
        records.put(record.getId(), record);
        return record.getId();
    }
    
    /**
     * Verify travel rule
     */
    public boolean verify(String recordId, String verifierId) {
        TravelRuleRecord record = records.get(recordId);
        if (record == null) return false;
        
        TravelRuleData data = record.getData();
        
        // Check blocked countries
        if (compliance.isBlockedCountry(data.getSenderCountry()) ||
            compliance.isBlockedCountry(data.getRecipientCountry())) {
            record.setStatus(TravelRuleStatus.BLOCKED);
            return false;
        }
        
        // Check required fields
        if (data.getSenderName() == null || data.getRecipientName() == null) {
            record.setStatus(TravelRuleStatus.FLAGGED);
            record.setNotes("Missing required fields");
            return false;
        }
        
        record.setStatus(TravelRuleStatus.VERIFIED);
        record.setVerifiedAt(Instant.now().toEpochMilli());
        record.setVerifiedBy(verifierId);
        
        return true;
    }
    
    /**
     * Block transaction
     */
    public boolean block(String recordId, String reason) {
        TravelRuleRecord record = records.get(recordId);
        if (record == null) return false;
        
        record.setStatus(TravelRuleStatus.BLOCKED);
        record.setNotes(reason);
        return true;
    }
    
    /**
     * Get record
     */
    public TravelRuleRecord getRecord(String recordId) {
        return records.get(recordId);
    }
    
    /**
     * Get pending records
     */
    public List<TravelRuleRecord> getPending() {
        List<TravelRuleRecord> pending = new ArrayList<>();
        for (TravelRuleRecord r : records.values()) {
            if (r.getStatus() == TravelRuleStatus.PENDING) {
                pending.add(r);
            }
        }
        return pending;
    }
    
    public static void main(String[] args) {
        TravelRuleManager manager = new TravelRuleManager();
        
        // Check if travel rule applies
        boolean required = manager.requiresTravelRule(5000.0, "US");
        System.out.println("Travel rule required: " + required);
        
        // Create data
        TravelRuleData data = new TravelRuleData();
        data.setSenderName("John Doe");
        data.setSenderCountry("US");
        data.setRecipientName("Jane Smith");
        data.setRecipientCountry("UK");
        data.setAmount(5000.0);
        data.setCurrency("USD");
        data.setTransferType(TransferType.EXCHANGE_TRANSFER);
        
        // Create record
        String recordId = manager.createRecord("TX123", data);
        System.out.println("Created record: " + recordId);
        
        // Verify
        boolean verified = manager.verify(recordId, "admin");
        System.out.println("Verified: " + verified);
    }
}