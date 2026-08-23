"""Generate frontend demo JSON from the unified evidence-fusion layer.

The demo values are synthetic but expose which real dataset expert would supply each
score. Replace these with outputs from source-specific trained models as datasets are
prepared.
"""
from __future__ import annotations

import json
from pathlib import Path

from data_sources import source_summary
from unified import LabPrediction, evidence_from_scores, fuse_evidence

OUT = Path(__file__).parent / "frontend" / "demo_data.json"


def scenario(name, subtitle, anomaly, metabolic, lab_change, prior, hormone, days, labs, timeline):
    ev = evidence_from_scores(
        anomaly=anomaly,
        metabolic=metabolic,
        lab_change=lab_change,
        population_prior=prior,
        hormone_context=hormone,
    )
    decision = fuse_evidence(ev, labs, days_since_last_draw=days)
    return {
        "name": name,
        "subtitle": subtitle,
        "days_since_last_draw": days,
        "decision": decision.as_dict(),
        "timeline": timeline,
    }


def main():
    scenarios = [
        scenario(
            "Baseline", "Wearables remain close to personal baseline",
            0.12, 0.20, 0.18, 0.22, 0.10, 71,
            [
                LabPrediction("GLU", 0.18, 94, 92, "mg/dL", "metabolic"),
                LabPrediction("HGB", 0.12, 14.6, 14.7, "g/dL", "hematology"),
                LabPrediction("HSCRP", 0.16, 0.7, 0.6, "mg/L", "inflammation"),
            ],
            [
                {"day": -6, "rhr": 59, "hrv": 61, "sleep": 7.4},
                {"day": -5, "rhr": 58, "hrv": 63, "sleep": 7.2},
                {"day": -4, "rhr": 60, "hrv": 60, "sleep": 7.5},
                {"day": -3, "rhr": 59, "hrv": 62, "sleep": 7.3},
                {"day": -2, "rhr": 60, "hrv": 59, "sleep": 7.0},
                {"day": -1, "rhr": 59, "hrv": 61, "sleep": 7.4},
                {"day": 0, "rhr": 60, "hrv": 60, "sleep": 7.3},
            ],
        ),
        scenario(
            "Drifting", "Several signals are moving, but evidence is not yet coherent",
            0.45, 0.35, 0.40, 0.30, 0.30, 44,
            [
                LabPrediction("GLU", 0.52, 101, 92, "mg/dL", "metabolic"),
                LabPrediction("HGB", 0.31, 14.2, 14.7, "g/dL", "hematology"),
                LabPrediction("HSCRP", 0.48, 1.4, 0.6, "mg/L", "inflammation"),
            ],
            [
                {"day": -6, "rhr": 59, "hrv": 61, "sleep": 7.4},
                {"day": -5, "rhr": 60, "hrv": 59, "sleep": 7.2},
                {"day": -4, "rhr": 61, "hrv": 58, "sleep": 7.0},
                {"day": -3, "rhr": 62, "hrv": 55, "sleep": 6.8},
                {"day": -2, "rhr": 63, "hrv": 53, "sleep": 6.7},
                {"day": -1, "rhr": 63, "hrv": 54, "sleep": 6.9},
                {"day": 0, "rhr": 64, "hrv": 51, "sleep": 6.6},
            ],
        ),
        scenario(
            "Persistent anomaly", "Independent datasets agree that a blood draw is likely to be informative",
            0.91, 0.76, 0.82, 0.55, 0.70, 83,
            [
                LabPrediction("GLU", 0.79, 109, 92, "mg/dL", "metabolic"),
                LabPrediction("A1C", 0.62, 5.7, 5.3, "%", "metabolic"),
                LabPrediction("HGB", 0.57, 13.6, 14.7, "g/dL", "hematology"),
                LabPrediction("HSCRP", 0.74, 2.8, 0.6, "mg/L", "inflammation"),
                LabPrediction("LDL", 0.43, 124, 108, "mg/dL", "lipids"),
            ],
            [
                {"day": -6, "rhr": 59, "hrv": 61, "sleep": 7.4},
                {"day": -5, "rhr": 61, "hrv": 57, "sleep": 7.0},
                {"day": -4, "rhr": 64, "hrv": 52, "sleep": 6.8},
                {"day": -3, "rhr": 66, "hrv": 47, "sleep": 6.5},
                {"day": -2, "rhr": 68, "hrv": 44, "sleep": 6.1},
                {"day": -1, "rhr": 70, "hrv": 40, "sleep": 6.0},
                {"day": 0, "rhr": 71, "hrv": 38, "sleep": 5.9},
            ],
        ),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"sources": source_summary(), "scenarios": scenarios}, indent=2))
    print(OUT)


if __name__ == "__main__":
    main()
