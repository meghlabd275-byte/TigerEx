"""Tests for the KYC service: every verification step must fail closed when no
provider is configured, and must never fabricate a pass."""

import unittest

from kyc_service import (
    DocumentType,
    KYCService,
    PersonName,
    ProviderNotConfiguredError,
    RiskLevel,
    VerificationStatus,
)


class StubVerifier:
    def __init__(self, verified=True, score=0.95, reason=""):
        self._verified = verified
        self._score = score
        self._reason = reason
        self.calls = 0

    def verify(self, doc):
        self.calls += 1
        return {"verified": self._verified, "score": self._score, "reason": self._reason}


class StubFaceMatcher:
    def __init__(self, score):
        self._score = score
        self.calls = 0

    def match(self, self_image, doc_image):
        self.calls += 1
        return {"match_score": self._score}


class StubLiveness:
    def __init__(self, passed):
        self._passed = passed
        self.calls = 0

    def verify(self, video_data):
        self.calls += 1
        return {"passed": self._passed, "score": 0.99}


class StubScreener:
    def __init__(self, pep=False, sanctions=False, adverse_media=False):
        self._result = {
            "pep": pep,
            "sanctions": sanctions,
            "adverse_media": adverse_media,
        }
        self.calls = 0

    def screen(self, user_id, name, nationality):
        self.calls += 1
        return dict(self._result)


def _new_application(kyc, tier=2):
    app_id = kyc.create_application(
        user_id="user-1",
        tier=tier,
        personal_info={
            "name": {"first": "Ada", "last": "Lovelace"},
            "dob": "1990-01-01",
            "nationality": "GB",
        },
    )
    doc = {"number": "AB123456", "country": "GB", "expiry": "2030-01-01"}
    kyc.submit_document(app_id, DocumentType.PASSPORT, doc)
    return app_id, kyc.applications[app_id].documents[0].doc_id


class FailClosedTests(unittest.TestCase):
    def test_document_verification_fails_closed(self):
        kyc = KYCService()
        app_id, doc_id = _new_application(kyc)
        with self.assertRaises(ProviderNotConfiguredError):
            kyc.verify_document(app_id, doc_id)
        app = kyc.applications[app_id]
        self.assertFalse(app.id_verified)
        self.assertFalse(app.documents[0].verified)

    def test_face_match_fails_closed(self):
        kyc = KYCService()
        app_id, _ = _new_application(kyc)
        with self.assertRaises(ProviderNotConfiguredError):
            kyc.verify_face_match(app_id, "selfie", "doc")
        self.assertEqual(kyc.applications[app_id].face_match_score, 0)

    def test_liveness_fails_closed(self):
        kyc = KYCService()
        app_id, _ = _new_application(kyc)
        with self.assertRaises(ProviderNotConfiguredError):
            kyc.check_liveness(app_id, "video")
        self.assertFalse(kyc.applications[app_id].liveness_passed)

    def test_aml_screening_fails_closed(self):
        kyc = KYCService()
        app_id, _ = _new_application(kyc)
        with self.assertRaises(ProviderNotConfiguredError):
            kyc.complete_aml_screening(app_id)
        self.assertFalse(kyc.applications[app_id].aml_passed)


class ProviderTests(unittest.TestCase):
    def test_document_verifier_drives_result(self):
        verifier = StubVerifier(verified=True, score=0.9)
        kyc = KYCService(document_verifier=verifier)
        app_id, doc_id = _new_application(kyc)
        result = kyc.verify_document(app_id, doc_id)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(verifier.calls, 1)
        self.assertTrue(kyc.applications[app_id].id_verified)
        self.assertEqual(kyc.applications[app_id].status, VerificationStatus.IN_REVIEW)

    def test_document_verifier_rejection_is_respected(self):
        kyc = KYCService(document_verifier=StubVerifier(verified=False, score=0.2))
        app_id, doc_id = _new_application(kyc)
        result = kyc.verify_document(app_id, doc_id)
        self.assertEqual(result["status"], "rejected")
        self.assertFalse(kyc.applications[app_id].id_verified)

    def test_face_matcher_score_is_used(self):
        kyc = KYCService(face_matcher=StubFaceMatcher(0.55))
        app_id, _ = _new_application(kyc)
        result = kyc.verify_face_match(app_id, "selfie", "doc")
        self.assertEqual(result["status"], "no_match")
        self.assertAlmostEqual(kyc.applications[app_id].face_match_score, 0.55)

    def test_sanctions_hit_blocks_aml(self):
        kyc = KYCService(screener=StubScreener(sanctions=True))
        app_id, _ = _new_application(kyc)
        self.assertFalse(kyc.complete_aml_screening(app_id))
        app = kyc.applications[app_id]
        self.assertTrue(app.sanctions_hit)
        self.assertFalse(app.aml_passed)
        self.assertEqual(app.risk_level, RiskLevel.CRITICAL)

    def test_clean_screen_passes_aml(self):
        kyc = KYCService(screener=StubScreener())
        app_id, _ = _new_application(kyc)
        self.assertTrue(kyc.complete_aml_screening(app_id))
        self.assertTrue(kyc.applications[app_id].aml_passed)


class TravelRuleTests(unittest.TestCase):
    def test_travel_rule_requires_verified_names(self):
        kyc = KYCService()
        with self.assertRaises(ValueError):
            kyc.get_travel_rule_data("from", "to", 10000, "USD")

    def test_travel_rule_below_threshold_is_empty(self):
        kyc = KYCService()
        self.assertEqual(kyc.get_travel_rule_data("from", "to", 100, "USD"), {})

    def test_travel_rule_uses_stored_legal_names(self):
        kyc = KYCService()
        kyc.users["from"] = {"legal_name": "Ada Lovelace", "country": "GB"}
        kyc.users["to"] = {"legal_name": "Grace Hopper", "country": "US"}
        data = kyc.get_travel_rule_data("from", "to", 10000, "USD")
        self.assertEqual(data["originator"]["name"], "Ada Lovelace")
        self.assertEqual(data["beneficiary"]["name"], "Grace Hopper")


if __name__ == "__main__":
    unittest.main()
