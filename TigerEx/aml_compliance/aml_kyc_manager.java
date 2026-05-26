package com.tigerex.aml;

/**
 * AML/KYC Compliance System
 * Anti-Money Laundering & Know Your Customer
 * Required for all financial institutions
 * 
 * Migration from TypeScript to Java
 */

import java.util.*;
import java.time.Instant;

// KYC Level enumeration
enum KYCLevel {
    NONE("none", 100, 100, 100),
    BASIC("basic", 1000, 1000, 5000),
    INTERMEDIATE("intermediate", 10000, 10000, 50000),
    FULL("full", 100000, 100000, 500000),
    INSTITUTIONAL("institutional", Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE);
    
    private final String value;
    private final int depositLimit;
    private final int withdrawalLimit;
    private final int tradingLimit;
    
    KYCLevel(String v, int dep, int wd, int trad) {
        this.value = v;
        this.depositLimit = dep;
        this.withdrawalLimit = wd;
        this.tradingLimit = trad;
    }
    
    public String getValue() { return value; }
    public int getDepositLimit() { return depositLimit; }
    public int getWithdrawalLimit() { return withdrawalLimit; }
    public int getTradingLimit() { return tradingLimit; }
}

// KYC Status enumeration
enum KYCStatus {
    PENDING("pending"),
    APPROVED("approved"),
    REJECTED("rejected"),
    NEEDS_MORE_INFO("需要额外信息");
    
    private final String value;
    KYCStatus(String v) { this.value = v; }
    public String getValue() { return value; }
}

// Document type enumeration
enum DocumentType {
    PASSPORT("passport"),
    NATIONAL_ID("national_id"),
    DRIVER_LICENSE("driver_license"),
    UTILITY_BILL("utility_bill"),
    BANK_STATEMENT("bank_statement");
    
    private final String value;
    DocumentType(String v) { this.value = v; }
    public String getValue() { return value; }
}

// Activity status
enum ActivityStatus {
    OPEN("open"),
    INVESTIGATING("investigating"),
    RESOLVED("resolved"),
    REPORTED("reported");
    
    private final String value;
    ActivityStatus(String v) { this.value = v; }
    public String getValue() { return value; }
}

// KYC Document class
class KYCDocument {
    private String id;
    private DocumentType type;
    private String country;
    private String number;
    private Long expiryDate;
    private boolean verified;
    
    public KYCDocument(String id, DocumentType type, String country, String number) {
        this.id = id;
        this.type = type;
        this.country = country;
        this.number = number;
        this.verified = false;
    }
    
    // Getters and setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public DocumentType getType() { return type; }
    public void setType(DocumentType type) { this.type = type; }
    public String getCountry() { return country; }
    public void setCountry(String country) { this.country = country; }
    public String getNumber() { return number; }
    public void setNumber(String number) { this.number = number; }
    public Long getExpiryDate() { return expiryDate; }
    public void setExpiryDate(Long expiryDate) { this.expiryDate = expiryDate; }
    public boolean isVerified() { return verified; }
    public void setVerified(boolean verified) { this.verified = verified; }
}

// KYC Data class
class KYCData {
    private String userId;
    private KYCLevel level;
    private KYCStatus status;
    
    // Personal Info
    private String firstName;
    private String lastName;
    private Long dateOfBirth;
    private String nationality;
    private String country;
    private String address;
    private String city;
    private String postalCode;
    
    // Documents
    private List<KYCDocument> documents;
    
    // Verification
    private Long submittedAt;
    private Long reviewedAt;
    private String reviewedBy;
    private String rejectionReason;
    
    // AML Score
    private int amlScore;
    private boolean amlChecked;
    private boolean pepStatus;
    private boolean sanctionsStatus;
    
    public KYCData(String userId) {
        this.userId = userId;
        this.level = KYCLevel.NONE;
        this.status = KYCStatus.PENDING;
        this.documents = new ArrayList<>();
        this.amlScore = 0;
        this.amlChecked = false;
        this.pepStatus = false;
        this.sanctionsStatus = false;
    }
    
    // Getters and setters
    public String getUserId() { return userId; }
    public KYCLevel getLevel() { return level; }
    public void setLevel(KYCLevel level) { this.level = level; }
    public KYCStatus getStatus() { return status; }
    public void setStatus(KYCStatus status) { this.status = status; }
    public String getFirstName() { return firstName; }
    public void setFirstName(String firstName) { this.firstName = firstName; }
    public String getLastName() { return lastName; }
    public void setLastName(String lastName) { this.lastName = lastName; }
    public Long getDateOfBirth() { return dateOfBirth; }
    public void setDateOfBirth(Long dateOfBirth) { this.dateOfBirth = dateOfBirth; }
    public String getNationality() { return nationality; }
    public void setNationality(String nationality) { this.nationality = nationality; }
    public String getCountry() { return country; }
    public void setCountry(String country) { this.country = country; }
    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }
    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }
    public String getPostalCode() { return postalCode; }
    public void setPostalCode(String postalCode) { this.postalCode = postalCode; }
    public List<KYCDocument> getDocuments() { return documents; }
    public void addDocument(KYCDocument doc) { this.documents.add(doc); }
    public Long getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(Long submittedAt) { this.submittedAt = submittedAt; }
    public Long getReviewedAt() { return reviewedAt; }
    public void setReviewedAt(Long reviewedAt) { this.reviewedAt = reviewedAt; }
    public String getReviewedBy() { return reviewedBy; }
    public void setReviewedBy(String reviewedBy) { this.reviewedBy = reviewedBy; }
    public String getRejectionReason() { return rejectionReason; }
    public void setRejectionReason(String rejectionReason) { this.rejectionReason = rejectionReason; }
    public int getAmlScore() { return amlScore; }
    public void setAmlScore(int amlScore) { this.amlScore = amlScore; }
    public boolean isAmlChecked() { return amlChecked; }
    public void setAmlChecked(boolean amlChecked) { this.amlChecked = amlChecked; }
    public boolean isPepStatus() { return pepStatus; }
    public void setPepStatus(boolean pepStatus) { this.pepStatus = pepStatus; }
    public boolean isSanctionsStatus() { return sanctionsStatus; }
    public void setSanctionsStatus(boolean sanctionsStatus) { this.sanctionsStatus = sanctionsStatus; }
}

// Suspicious Activity class
class SuspiciousActivity {
    private String id;
    private String userId;
    private String type;
    private String description;
    private Long amount;
    private Long timestamp;
    private ActivityStatus status;
    private String notes;
    
    public SuspiciousActivity(String id, String userId, String type, String description) {
        this.id = id;
        this.userId = userId;
        this.type = type;
        this.description = description;
        this.timestamp = Instant.now().toEpochMilli();
        this.status = ActivityStatus.OPEN;
    }
    
    // Getters and setters
    public String getId() { return id; }
    public String getUserId() { return userId; }
    public String getType() { return type; }
    public String getDescription() { return description; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }
    public Long getTimestamp() { return timestamp; }
    public ActivityStatus getStatus() { return status; }
    public void setStatus(ActivityStatus status) { this.status = status; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
}

// AML/KYC Manager main class
public class AMLKYCManager {
    private Map<String, KYCData> kycDataStore;
    private Map<String, List<SuspiciousActivity>> suspiciousActivities;
    private Map<KYCLevel, int[]> limits;
    
    public AMLKYCManager() {
        this.kycDataStore = new HashMap<>();
        this.suspiciousActivities = new HashMap<>();
        initializeLimits();
    }
    
    private void initializeLimits() {
        limits = new HashMap<>();
        limits.put(KYCLevel.NONE, new int[]{100, 100, 100});
        limits.put(KYCLevel.BASIC, new int[]{1000, 1000, 5000});
        limits.put(KYCLevel.INTERMEDIATE, new int[]{10000, 10000, 50000});
        limits.put(KYCLevel.FULL, new int[]{100000, 100000, 500000});
        limits.put(KYCLevel.INSTITUTIONAL, new int[]{Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE});
    }
    
    /**
     * Submit KYC application
     */
    public String submitKYC(KYCData data) {
        data.setSubmittedAt(Instant.now().toEpochMilli());
        kycDataStore.put(data.getUserId(), data);
        return data.getUserId();
    }
    
    /**
     * Approve KYC
     */
    public boolean approveKYC(String userId, KYCLevel level, String reviewerId) {
        KYCData data = kycDataStore.get(userId);
        if (data == null) return false;
        
        data.setLevel(level);
        data.setStatus(KYCStatus.APPROVED);
        data.setReviewedAt(Instant.now().toEpochMilli());
        data.setReviewedBy(reviewerId);
        
        return true;
    }
    
    /**
     * Reject KYC
     */
    public boolean rejectKYC(String userId, String reason, String reviewerId) {
        KYCData data = kycDataStore.get(userId);
        if (data == null) return false;
        
        data.setStatus(KYCStatus.REJECTED);
        data.setReviewedAt(Instant.now().toEpochMilli());
        data.setReviewedBy(reviewerId);
        data.setRejectionReason(reason);
        
        return true;
    }
    
    /**
     * Get KYC data
     */
    public KYCData getKYC(String userId) {
        return kycDataStore.get(userId);
    }
    
    /**
     * Get deposit limit for KYC level
     */
    public int getDepositLimit(KYCLevel level) {
        int[] limitsArray = limits.get(level);
        return limitsArray != null ? limitsArray[0] : 0;
    }
    
    /**
     * Get withdrawal limit for KYC level
     */
    public int getWithdrawalLimit(KYCLevel level) {
        int[] limitsArray = limits.get(level);
        return limitsArray != null ? limitsArray[1] : 0;
    }
    
    /**
     * Get trading limit for KYC level
     */
    public int getTradingLimit(KYCLevel level) {
        int[] limitsArray = limits.get(level);
        return limitsArray != null ? limitsArray[2] : 0;
    }
    
    /**
     * Report suspicious activity
     */
    public String reportSuspiciousActivity(String userId, String type, String description, Long amount) {
        String id = "SA-" + System.currentTimeMillis();
        SuspiciousActivity sa = new SuspiciousActivity(id, userId, type, description);
        sa.setAmount(amount);
        
        List<SuspiciousActivity> activities = suspiciousActivities.getOrDefault(userId, new ArrayList<>());
        activities.add(sa);
        suspiciousActivities.put(userId, activities);
        
        return id;
    }
    
    /**
     * Get suspicious activities for user
     */
    public List<SuspiciousActivity> getSuspiciousActivities(String userId) {
        return suspiciousActivities.getOrDefault(userId, new ArrayList<>());
    }
    
    /**
     * Check transaction limits
     */
    public boolean checkTransactionLimits(String userId, String transactionType, long amount) {
        KYCData data = kycDataStore.get(userId);
        if (data == null) return amount <= limits.get(KYCLevel.NONE)[0];
        
        KYCLevel level = data.getLevel();
        int limit;
        
        switch(transactionType) {
            case "deposit":
                limit = getDepositLimit(level);
                break;
            case "withdrawal":
                limit = getWithdrawalLimit(level);
                break;
            case "trading":
                limit = getTradingLimit(level);
                break;
            default:
                limit = 0;
        }
        
        return amount <= limit;
    }
    
    /**
     * Run AML screening
     */
    public void runAMLScreening(String userId) {
        KYCData data = kycDataStore.get(userId);
        if (data == null) return;
        
        // Simplified AML scoring
        int score = 0;
        
        // Check for PEP status (simplified)
        if (data.isPepStatus()) {
            score += 50;
        }
        
        // Check sanctions
        if (data.isSanctionsStatus()) {
            score += 100;
        }
        
        data.setAmlScore(score);
        data.setAmlChecked(true);
    }
    
    public static void main(String[] args) {
        AMLKYCManager manager = new AMLKYCManager();
        
        // Test KYC submission
        KYCData kyc = new KYCData("user123");
        kyc.setFirstName("John");
        kyc.setLastName("Doe");
        kyc.setCountry("US");
        
        manager.submitKYC(kyc);
        
        // Approve KYC
        manager.approveKYC("user123", KYCLevel.FULL, "admin1");
        
        System.out.println("KYC Approved for user123");
    }
}