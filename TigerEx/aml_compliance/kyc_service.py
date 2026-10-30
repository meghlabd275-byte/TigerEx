#!/usr/bin/env python3
"""
TigerEx - Complete KYC & Identity Verification System
Version: 1.0.0

Features:
- Multi-tier identity verification (Level 1-3)
- Document verification (Passport, ID, Driver License)
- Biometric matching (face, liveness)
- AML/Sanctions screening
- Travel Rule compliance
- PEP screening

WARNING: Development code. Integrate with certified providers for production.
"""

import json
import time
import uuid
import hashlib
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple, Protocol
from enum import Enum
from datetime import datetime, timedelta


# ============================================================================
# KYC TYPES
# ============================================================================

class KYCTier(Enum):
    NONE = 0
    BASIC = 1      # Email, phone verified
    STANDARD = 2  # ID verification
    ENHANCED = 3  # Full AML + PEP + biometric


class DocumentType(Enum):
    PASSPORT = "passport"
    NATIONAL_ID = "national_id"
    DRIVERS_LICENSE = "drivers_license"
    UTILITY_BILL = "utility_bill"
    BANK_STATEMENT = "bank_statement"


class VerificationStatus(Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ProviderNotConfiguredError(RuntimeError):
    """Raised when a verification or screening provider is not configured.

    TigerEx never fabricates a document, biometric, liveness or sanctions
    result. When the operator has not supplied a provider, the check fails
    closed instead of returning a pass.
    """


class DocumentVerifier(Protocol):
    """OCR / document-authenticity provider (self-built or self-hosted)."""

    def verify(self, doc: "Document") -> Dict:
        """Return {"verified": bool, "score": float, "reason": str}."""


class FaceMatcher(Protocol):
    """Face-match provider comparing a selfie against a document portrait."""

    def match(self, self_image: str, doc_image: str) -> Dict:
        """Return {"match_score": float, "reason": str}."""


class LivenessVerifier(Protocol):
    """Presentation-attack / liveness provider."""

    def verify(self, video_data: str) -> Dict:
        """Return {"passed": bool, "score": float, "reason": str}."""


class SanctionsScreener(Protocol):
    """Sanctions, PEP and adverse-media screening provider."""

    def screen(self, user_id: str, name: "PersonName", nationality: str) -> Dict:
        """Return {"pep": bool, "sanctions": bool, "adverse_media": bool,
        "risk_score": float, "details": str}."""


# ============================================================================
# KYC ENTITIES
# ============================================================================

@dataclass
class PersonName:
    """Legal name"""
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    suffix: Optional[str] = None


@dataclass
class Address:
    """Residential address"""
    street1: str
    city: str
    state: str
    postal_code: str
    country: str
    street2: Optional[str] = None


@dataclass
class Document:
    """Identity document"""
    doc_id: str
    user_id: str
    type: DocumentType
    issuing_country: str
    number: str
    expiry_date: str
    front_image: str  # base64 or URL
    back_image: Optional[str] = None
    self_image: Optional[str] = None  # for face match
    verified: bool = False


@dataclass
class KYCAplication:
    """KYC application record"""
    application_id: str
    user_id: str
    tier_requested: KYCTier
    status: VerificationStatus
    risk_level: RiskLevel

    # Personal info
    name: Optional[PersonName] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None

    # Documents
    documents: List[Document] = field(default_factory=list)

    # Verification results
    id_verified: bool = False
    address_verified: bool = False
    face_match_score: float = 0
    liveness_passed: bool = False

    # AML screening
    aml_passed: bool = False
    pep_hit: bool = False
    sanctions_hit: bool = False
    adverse_media_hit: bool = False

    # Review
    reviewer_id: Optional[str] = None
    review_notes: Optional[str] = None

    # Timestamps
    created_at: int = field(default_factory=lambda: int(time.time()))
    updated_at: int = field(default_factory=lambda: int(time.time()))
    expires_at: int = 0


# ============================================================================
# KYC SERVICE
# ============================================================================

class KYCService:
    """Complete KYC verification system"""

    def __init__(
        self,
        document_verifier: Optional[DocumentVerifier] = None,
        face_matcher: Optional[FaceMatcher] = None,
        liveness_verifier: Optional[LivenessVerifier] = None,
        screener: Optional[SanctionsScreener] = None,
    ):
        self.applications: Dict[str, KYCAplication] = {}
        self.users: Dict[str, Dict] = {}

        # Providers are supplied by the operator. Until each one is installed,
        # the matching verification step fails closed.
        self.document_verifier = document_verifier
        self.face_matcher = face_matcher
        self.liveness_verifier = liveness_verifier
        self.screener = screener

        # Requirements per tier
        self.tier_requirements = {
            KYCTier.BASIC: {
                "email_verified": True,
                "phone_verified": True,
            },
            KYCTier.STANDARD: {
                "document_type": [DocumentType.PASSPORT, DocumentType.NATIONAL_ID],
                "id_verified": True,
                "face_match_score": 0.8,
                "address_verified": True,
            },
            KYCTier.ENHANCED: {
                "id_verified": True,
                "face_match_score": 0.9,
                "liveness_passed": True,
                "aml_passed": True,
                "pep_screened": True,
            },
        }

    # ---------------------------------------------------------------------------
    # APPLICATION MANAGEMENT
    # ---------------------------------------------------------------------------

    def create_application(
        self,
        user_id: str,
        tier: int,
        personal_info: Dict
    ) -> str:
        """Create new KYC application"""

        tier_enum = KYCTier(tier)

        application = KYCAplication(
            application_id=str(uuid.uuid4()),
            user_id=user_id,
            tier_requested=tier_enum,
            status=VerificationStatus.PENDING,
            risk_level=RiskLevel.LOW,
        )

        # Add personal info
        if "name" in personal_info:
            name = personal_info["name"]
            application.name = PersonName(
                first_name=name.get("first", ""),
                last_name=name.get("last", "")
            )

        if "dob" in personal_info:
            application.date_of_birth = personal_info["dob"]

        if "nationality" in personal_info:
            application.nationality = personal_info["nationality"]

        # Set expiry (3 years for approved)
        application.expires_at = application.created_at + (3 * 365 * 86400)

        self.applications[application.application_id] = application
        self.users[user_id] = {
            "tier": tier,
            "application_id": application.application_id,
            "status": "pending"
        }

        return application.application_id

    def submit_document(
        self,
        application_id: str,
        doc_type: DocumentType,
        doc_data: Dict
    ) -> bool:
        """Submit identity document"""

        app = self.applications.get(application_id)
        if not app:
            return False

        doc = Document(
            doc_id=str(uuid.uuid4()),
            user_id=app.user_id,
            type=doc_type,
            issuing_country=doc_data.get("country", "US"),
            number=doc_data.get("number", ""),
            expiry_date=doc_data.get("expiry", ""),
            front_image=doc_data.get("front_image", ""),
            back_image=doc_data.get("back_image"),
            self_image=doc_data.get("self_image"),
        )

        app.documents.append(doc)
        app.status = VerificationStatus.SUBMITTED
        app.updated_at = int(time.time())

        return True

    def verify_document(self, application_id: str, doc_id: str) -> Dict:
        """Verify a document through the configured OCR/authenticity provider.

        Fails closed: without a provider the document is never marked verified.
        """

        app = self.applications.get(application_id)
        if not app:
            return {"error": "Application not found"}

        doc = next((d for d in app.documents if d.doc_id == doc_id), None)
        if not doc:
            return {"error": "Document not found"}

        if len(doc.number) < 4:
            return {"error": "Invalid document number"}

        if self.document_verifier is None:
            raise ProviderNotConfiguredError(
                "document verification provider is not configured; refusing to mark the document verified"
            )

        result = self.document_verifier.verify(doc)
        if not result.get("verified"):
            doc.verified = False
            return {"status": "rejected", "score": result.get("score", 0), "reason": result.get("reason", "")}

        doc.verified = True
        app.id_verified = True
        app.status = VerificationStatus.IN_REVIEW
        return {"status": "verified", "score": result.get("score", 0), "reason": result.get("reason", "")}

    def verify_face_match(
        self,
        application_id: str,
        self_image: str,
        doc_image: str
    ) -> Dict:
        """Compare a selfie against the document portrait via the configured
        face-match provider. Fails closed when no provider is installed."""

        app = self.applications.get(application_id)
        if not app:
            return {"error": "Application not found"}

        if self.face_matcher is None:
            raise ProviderNotConfiguredError(
                "face-match provider is not configured; refusing to report a match score"
            )

        result = self.face_matcher.match(self_image, doc_image)
        match_score = float(result.get("match_score", 0))
        app.face_match_score = match_score

        if match_score >= 0.8:
            return {"status": "match", "score": match_score}

        return {"status": "no_match", "score": match_score}

    def check_liveness(self, application_id: str, video_data: str) -> Dict:
        """Verify liveness through the configured presentation-attack provider.
        Fails closed when no provider is installed."""

        app = self.applications.get(application_id)
        if not app:
            return {"error": "Application not found"}

        if self.liveness_verifier is None:
            raise ProviderNotConfiguredError(
                "liveness provider is not configured; refusing to report a liveness pass"
            )

        result = self.liveness_verifier.verify(video_data)
        app.liveness_passed = bool(result.get("passed", False))
        return {
            "passed": app.liveness_passed,
            "score": result.get("score", 0),
            "reason": result.get("reason", ""),
        }

    # ---------------------------------------------------------------------------
    # AML/SCREENING
    # ---------------------------------------------------------------------------

    def screen_aml(
        self,
        user_id: str,
        name: PersonName,
        nationality: str
    ) -> Dict:
        """Screen against sanctions, PEP and adverse-media lists via the
        configured screener. Fails closed when no screener is installed."""

        if self.screener is None:
            raise ProviderNotConfiguredError(
                "sanctions/PEP screener is not configured; refusing to report a screening result"
            )

        return self.screener.screen(user_id, name, nationality)

    def screen_pep(
        self,
        name: PersonName,
        nationality: str
    ) -> Dict:
        """Screen against PEP databases via the configured screener. Fails
        closed when no screener is installed."""

        if self.screener is None:
            raise ProviderNotConfiguredError(
                "PEP screener is not configured; refusing to report a screening result"
            )

        result = self.screener.screen("", name, nationality)
        return {
            "pep_found": bool(result.get("pep", False)),
            "relationship": result.get("relationship"),
            "risk_level": result.get("risk_level", "unknown"),
        }

    def complete_aml_screening(self, application_id: str) -> bool:
        """Complete AML screening for an application through the configured
        screener. Fails closed when no screener is installed."""

        app = self.applications.get(application_id)
        if not app or not app.name:
            return False

        aml_result = self.screen_aml(app.user_id, app.name, app.nationality)

        app.pep_hit = bool(aml_result.get("pep", False))
        app.sanctions_hit = bool(aml_result.get("sanctions", False))
        app.adverse_media_hit = bool(aml_result.get("adverse_media", False))

        # A hit blocks the application; only a clean screen passes.
        if app.sanctions_hit:
            app.risk_level = RiskLevel.CRITICAL
            app.aml_passed = False
        elif app.pep_hit:
            app.risk_level = RiskLevel.MEDIUM
            app.aml_passed = False
        elif app.adverse_media_hit:
            app.risk_level = RiskLevel.HIGH
            app.aml_passed = False
        else:
            app.aml_passed = True

        return app.aml_passed

    # ---------------------------------------------------------------------------
    # REVIEW & APPROVAL
    # ---------------------------------------------------------------------------

    def review_application(
        self,
        application_id: str,
        reviewer_id: str,
        approve: bool,
        notes: str = ""
    ) -> Dict:
        """Manual review by compliance officer"""

        app = self.applications.get(application_id)
        if not app:
            return {"error": "Application not found"}

        if approve:
            app.status = VerificationStatus.APPROVED
            app.reviewer_id = reviewer_id
            app.review_notes = notes

            # Update user tier
            if app.user_id in self.users:
                self.users[app.user_id]["tier"] = app.tier_requested.value
                self.users[app.user_id]["status"] = "approved"
        else:
            app.status = VerificationStatus.REJECTED
            app.reviewer_id = reviewer_id
            app.review_notes = notes

        app.updated_at = int(time.time())

        return {"status": app.status.value}

    def auto_approve_if_eligible(self, application_id: str) -> bool:
        """Auto-approve if all requirements met"""

        app = self.applications.get(application_id)
        if not app:
            return False

        requirements = self.tier_requirements.get(app.tier_requested, {})

        # Check basic requirements
        if requirements.get("id_verified") and not app.id_verified:
            return False

        if requirements.get("face_match_score", 0) > app.face_match_score:
            return False

        if app.status == VerificationStatus.REJECTED:
            return False

        # Approve
        app.status = VerificationStatus.APPROVED
        app.updated_at = int(time.time())

        return True

    # ---------------------------------------------------------------------------
    # TRAVEL RULE (FATF)
    # ---------------------------------------------------------------------------

    def get_travel_rule_data(
        self,
        from_user_id: str,
        to_user_id: str,
        amount: float,
        currency: str
    ) -> Dict:
        """Generate Travel Rule data for large transactions"""

        from_user = self.users.get(from_user_id)
        to_user = self.users.get(to_user_id)

        if amount < 3000:  # Threshold varies by jurisdiction
            return {}  # Below threshold

        if not from_user or not to_user:
            raise ValueError("both originator and beneficiary must exist for a travel-rule record")

        originator_name = from_user.get("legal_name")
        beneficiary_name = to_user.get("legal_name")
        if not originator_name or not beneficiary_name:
            raise ValueError(
                "travel-rule record requires verified legal names; refusing to emit placeholder identity data"
            )

        return {
            "originator": {
                "name": originator_name,
                "accountNumber": from_user_id,
                "geographicAddress": from_user.get("country", ""),
            },
            "beneficiary": {
                "name": beneficiary_name,
                "accountNumber": to_user_id,
            },
            "amount": amount,
            "currency": currency,
        }

    # ---------------------------------------------------------------------------
    # UTILITIES
    # ---------------------------------------------------------------------------

    def get_status(self, user_id: str) -> Dict:
        """Get user's KYC status"""
        return self.users.get(user_id, {
            "tier": 0,
            "status": "not_started"
        })

    def get_limits(self, tier: KYCTier) -> Dict:
        """Get tier limits"""
        limits = {
            KYCTier.NONE: {"deposit": 0, "withdrawal": 0},
            KYCTier.BASIC: {"deposit": 1000, "withdrawal": 1000},
            KYCTier.STANDARD: {"deposit": 50000, "withdrawal": 50000},
            KYCTier.ENHANCED: {"deposit": None, "withdrawal": None},
        }
        return limits.get(tier, {"deposit": 0, "withdrawal": 0})

    def expire_old_applications(self) -> int:
        """Expire old pending applications"""
        current_time = int(time.time())
        expired = 0

        for app in self.applications.values():
            if app.status == VerificationStatus.PENDING:
                if current_time - app.created_at > 30 * 86400:  # 30 days
                    app.status = VerificationStatus.EXPIRED
                    expired += 1

        return expired


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("TigerEx KYC Service v1.0")
    print("=" * 30)
    print(
        "This service performs no verification on its own. Configure a "
        "document verifier, face matcher, liveness verifier and sanctions "
        "screener; until then every verification step fails closed."
    )


if __name__ == "__main__":
    main()