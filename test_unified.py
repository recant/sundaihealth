import json
from pathlib import Path

from unified import Evidence, LabPrediction, evidence_from_scores, fuse_evidence, personalized_anomaly_score


def test_anomaly_ordering():
    base = {
        "resting_hr": (60, 3),
        "hrv_rmssd": (60, 8),
        "sleep_duration": (7.4, 0.6),
    }
    normal, _ = personalized_anomaly_score(
        {"resting_hr": 60, "hrv_rmssd": 61, "sleep_duration": 7.3}, base
    )
    abnormal, _ = personalized_anomaly_score(
        {"resting_hr": 72, "hrv_rmssd": 38, "sleep_duration": 5.8}, base
    )
    assert abnormal > normal
    assert abnormal > 0.6


def test_fusion_ordering():
    low = fuse_evidence(evidence_from_scores(anomaly=.1, metabolic=.2, lab_change=.15, population_prior=.2))
    high = fuse_evidence(
        evidence_from_scores(anomaly=.92, metabolic=.8, lab_change=.83, population_prior=.55, hormone_context=.7),
        [LabPrediction("GLU", .82, domain="metabolic")],
        days_since_last_draw=60,
    )
    assert high.priority > low.priority
    assert high.status == "TEST NOW"
    assert low.status == "NO TEST"
    assert "Metabolic / glucose" in high.recommended_panel


def test_recent_draw_suppression():
    ev = [Evidence("x", .95, .9, "anomaly", "persistent change")]
    old = fuse_evidence(ev, days_since_last_draw=60)
    recent = fuse_evidence(ev, days_since_last_draw=1)
    assert recent.priority < old.priority


def test_demo_json_exists():
    p = Path(__file__).parent / "frontend" / "demo_data.json"
    data = json.loads(p.read_text())
    assert len(data["scenarios"]) == 3
    assert len(data["sources"]) >= 7


if __name__ == "__main__":
    for f in [test_anomaly_ordering, test_fusion_ordering, test_recent_draw_suppression, test_demo_json_exists]:
        f(); print("PASS", f.__name__)
