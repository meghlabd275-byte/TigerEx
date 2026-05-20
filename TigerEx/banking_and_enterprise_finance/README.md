# Banking and Enterprise Finance

> **Domain**: Regulated financial systems requiring audit trails and compliance.

## Language: Java + Kotlin

Java dominates regulated enterprise finance:
- Mature ecosystem (decades of battle-testing)
- Strong typing and tooling
- Transactional integrity
- Banking library support
- Regulatory reporting systems
- Hiring pool availability

## Submodules

### fiat_banking_core/
- Fiat deposit/withdrawal processing
- SWIFT/SEPA/ACH integrations
- Wire transfer handling
- Payment rails

### kyc_aml_systems/
- Know Your Customer workflows
- AML transaction monitoring
- Sanctions screening
- Suspicious activity reporting

### compliance_reporting/
- Regulatory filings
- Audit trail generation
- Financial statements
- Tax document preparation

### internal_ledger/
- Double-entry accounting
- Balance tracking
- Reconciliation engine
- Settlement finality

### treasury_operations/
- Cash flow management
- Liquidity reporting
- Interest calculation

## Regulatory Compliance

Systems must comply with:
- Bank Secrecy Act (BSA)
- USA PATRIOT Act
- GDPR (EU data)
- SOX (financial reporting)
- Local banking regulations

## Deployment

- On-premise or private cloud
- Strict access controls
- Audit logging everywhere
- Disaster recovery requirements

## Database

Primary: PostgreSQL, CockroachDB
Analytical: ClickHouse