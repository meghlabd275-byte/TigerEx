-- ============================================================================
-- TigerEx Database Schema - KYC & Compliance
-- Version: 1.0.0
-- Created: 2026-05-26
-- ============================================================================

-- KYC Applications
CREATE TABLE IF NOT EXISTS kyc_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kyc_level SMALLINT NOT NULL CHECK (kyc_level IN (1, 2, 3)),
    provider VARCHAR(50),
    provider_application_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'in_review', 'approved', 'rejected', 'expired', 'suspended')),
    verification_type VARCHAR(30) NOT NULL,
    document_type VARCHAR(30),
    document_id VARCHAR(100),
    document_front IMAGE,
    document_back IMAGE,
    document_selfie IMAGE,
    document_video IMAGE,
    selfie_verified BOOLEAN DEFAULT FALSE,
    liveness_verified BOOLEAN DEFAULT FALSE,
    face_match_score NUMERIC(5, 4),
    address_verified BOOLEAN DEFAULT FALSE,
    id_verified BOOLEAN DEFAULT FALSE,
   aml_check_passed BOOLEAN DEFAULT FALSE,
    risk_score SMALLINT,
    risk_flags TEXT[],
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_applications_user_id ON kyc_applications(user_id);
CREATE INDEX idx_kyc_applications_status ON kyc_applications(status);
CREATE INDEX idx_kyc_applications_level ON kyc_applications(kyc_level);

-- KYC Documents
CREATE TABLE IF NOT EXISTS kyc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type VARCHAR(30) NOT NULL CHECK (document_type IN ('passport', 'national_id', 'driver_license', 'utility_bill', 'bank_statement', 'credit_card')),
    document_number VARCHAR(100),
    issuing_country VARCHAR(3) NOT NULL,
    issuing_authority VARCHAR(255),
    issue_date DATE,
    expiry_date DATE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    nationality VARCHAR(3),
    address_line1 TEXT,
    address_line2 TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(3),
    document_hash VARCHAR(255),
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'expired', 'failed')),
    expiry_notified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_documents_user_id ON kyc_documents(user_id);
CREATE INDEX idx_kyc_documents_document_type ON kyc_documents(document_type);
CREATE INDEX idx_kyc_documents_verification_status ON kyc_documents(verification_status);

-- AML/Sanctions Screening Results
CREATE TABLE IF NOT EXISTS aml_screening (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screening_type VARCHAR(30) NOT NULL CHECK (screening_type IN ('initial', 'periodic', 'transaction', 'batch')),
    screened_entities JSONB NOT NULL,
    hits JSONB,
    risk_score SMALLINT,
    risk_level VARCHAR(20) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    pep_hit BOOLEAN DEFAULT FALSE,
    sanction_hit BOOLEAN DEFAULT FALSE,
    adverse_media_hit BOOLEAN DEFAULT FALSE,
    fraud_hit BOOLEAN DEFAULT FALSE,
    hit_details JSONB,
    resolution_notes TEXT,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_aml_screening_user_id ON aml_screening(user_id);
CREATE INDEX idx_aml_screening_risk_level ON aml_screening(risk_level);
CREATE INDEX idx_aml_screening_created ON aml_screening(created_at DESC);

-- Travel Rule Records (FATF)
CREATE TABLE IF NOT EXISTS travel_rule_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    originator_id UUID REFERENCES users(id),
    originator_name VARCHAR(255) NOT NULL,
    originator_account_number VARCHAR(50),
    originator_legal_region VARCHAR(3),
    originatorGeographicLocation VARCHAR(255),
    beneficiary_id UUID REFERENCES users(id),
    beneficiary_name VARCHAR(255) NOT NULL,
    beneficiary_account_number VARCHAR(50),
    beneficiary_legal_region VARCHAR(3),
    beneficiary_geographic_location VARCHAR(255),
    amount DECIMAL(24, 8) NOT NULL,
    asset_symbol VARCHAR(20) NOT NULL,
    transfer_direction VARCHAR(10) NOT NULL,
   -sender_vasp_id VARCHAR(50),
    sender_vasp_name VARCHAR(255),
    recipient_vasp_id VARCHAR(50),
    recipient_vasp_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'received', 'failed')),
    sent_at TIMESTAMP WITH TIME ZONE,
    received_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_travel_rule_transaction_id ON travel_rule_records(transaction_id);
CREATE INDEX idx_travel_rule_originator_id ON travel_rule_records(originator_id);
CREATE INDEX idx_travel_rule_beneficiary_id ON travel_rule_records(beneficiary_id);

-- Suspicious Activity Reports (SAR)
CREATE TABLE IF NOT EXISTS suspicious_activity_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    alert_id UUID REFERENCES alerts(id),
    report_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'reported', 'cleared', ' Escalated')),
    description TEXT NOT NULL,
    suspicious_activity TEXT,
    flagged_transactions UUID[],
    investigation_notes TEXT,
    filed_with_authorities BOOLEAN DEFAULT FALSE,
    filing_reference VARCHAR(100),
    investigator_id UUID REFERENCES users(id),
    cleared_by UUID REFERENCES users(id),
    cleared_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sar_user_id ON suspicious_activity_reports(user_id);
CREATE INDEX idx_sar_status ON suspicious_activity_reports(status);
CREATE INDEX idx_sar_severity ON suspicious_activity_reports(severity);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id VARCHAR(50) UNIQUE NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    rule_triggered VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    description TEXT,
    metadata JSONB,
    status VARCHAR(20) DEFAULT 'triggered' CHECK (status IN ('triggered', 'acknowledged', 'investigating', 'resolved', 'false_positive')),
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_type ON alerts(alert_type);

-- Audit Logs (Compliance)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    failure_reason VARCHAR(255),
    success BOOLEAN DEFAULT TRUE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Compliance Reports
CREATE TABLE IF NOT EXISTS compliance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id VARCHAR(50) UNIQUE NOT NULL,
    report_type VARCHAR(50) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'generating' CHECK (status IN ('generating', 'generated', 'reviewed', 'submitted', 'accepted')),
    data JSONB,
    generated_by UUID REFERENCES users(id),
    generated_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    submission_reference VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_compliance_reports_type ON compliance_reports(report_type);
CREATE INDEX idx_compliance_reports_status ON compliance_reports(status);
CREATE INDEX idx_compliance_reports_period ON compliance_reports(period_start, period_end);

-- Trigger for KYC timestamps
CREATE TRIGGER update_kyc_applications_updated_at BEFORE UPDATE ON kyc_applications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kyc_documents_updated_at BEFORE UPDATE ON kyc_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();