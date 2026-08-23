"""Evidence-fusion layer for event-triggered blood testing.

This is deliberately dataset-agnostic at inference time. Each dataset trains/calibrates
one expert, and experts emit comparable Evidence objects. Different cohorts must never
be merged as if they were the same people.

Research/demo use only; not a clinical decision system.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Mapping, Sequence

import numpy as np
import pandas as pd


@dataclass
class Evidence:
    source: str
    score: float                 # 0..1 probability/strength
    reliability: float           # 0..1 validation/sample-quality weight
    domain: str                  # anomaly, metabolic, hematology, inflammation, etc.
    reason: str
    direction: str = "up"

    @property
    def weighted(self) -> float:
        return float(np.clip(self.score, 0, 1) * np.clip(self.reliability, 0, 1))


@dataclass
class LabPrediction:
    lab: str
    probability_changed: float
    predicted_value: float | None = None
    previous_value: float | None = None
    unit: str | None = None
    domain: str = "general"


@dataclass
class Decision:
    priority: float
    status: str
    confidence: float
    anomaly_score: float
    recommended_panel: list[str]
    reasons: list[str]
    evidence: list[dict]
    lab_predictions: list[dict]

    def as_dict(self) -> dict:
        return asdict(self)


def robust_z(values: pd.Series, baseline: pd.Series) -> pd.Series:
    """Robust z-score using median and MAD; falls back to SD if MAD collapses."""
    b = pd.to_numeric(baseline, errors="coerce").dropna()
    x = pd.to_numeric(values, errors="coerce")
    if b.empty:
        return pd.Series(np.nan, index=x.index)
    med = float(b.median())
    mad = float((b - med).abs().median())
    scale = 1.4826 * mad
    if not np.isfinite(scale) or scale < 1e-12:
        scale = float(b.std(ddof=1))
    if not np.isfinite(scale) or scale < 1e-12:
        scale = 1.0
    return (x - med) / scale


def personalized_anomaly_score(
    recent: Mapping[str, float],
    baseline: Mapping[str, tuple[float, float] | float],
    *,
    feature_weights: Mapping[str, float] | None = None,
) -> tuple[float, dict[str, float]]:
    """Combine standardized deviations from a person's own baseline.

    baseline values may be ``(median, robust_scale)`` tuples or simple medians. For
    simple medians, a relative 10% scale is used as a conservative demo fallback.
    """
    weights = dict(feature_weights or {
        "resting_hr": 1.25,
        "overnight_hr": 1.1,
        "hrv_rmssd": 1.15,
        "sleep_duration": 0.75,
        "sleep_efficiency": 0.8,
        "activity": 0.55,
        "skin_temp": 0.95,
        "cgm_variability": 1.15,
    })
    zs: dict[str, float] = {}
    weighted = []
    denom = 0.0
    for name, value in recent.items():
        if name not in baseline or value is None or not np.isfinite(value):
            continue
        b = baseline[name]
        if isinstance(b, (tuple, list)):
            med, scale = float(b[0]), abs(float(b[1]))
        else:
            med = float(b)
            scale = max(abs(med) * 0.10, 1e-6)
        if scale < 1e-12:
            continue
        z = (float(value) - med) / scale
        if name in {"hrv_rmssd", "sleep_duration", "sleep_efficiency", "activity"}:
            z = -z
        zs[name] = float(z)
        w = float(weights.get(name, 0.5))
        magnitude = np.tanh(max(z, 0.0) / 2.25)
        weighted.append(w * magnitude)
        denom += w
    if denom == 0:
        return 0.0, zs
    return float(np.clip(sum(weighted) / denom, 0, 1)), zs


def fuse_evidence(
    evidence: Sequence[Evidence],
    lab_predictions: Sequence[LabPrediction] = (),
    *,
    days_since_last_draw: float | None = None,
    minimum_test_interval_days: float = 7.0,
) -> Decision:
    """Fuse independent expert outputs without pretending cohorts share participants."""
    ev = list(evidence)
    weighted = [e.weighted for e in ev]
    if weighted:
        combined = 1.0 - float(np.prod([1.0 - min(w, 0.95) for w in weighted]))
        confidence = float(np.clip(np.mean([e.reliability for e in ev]), 0, 1))
    else:
        combined, confidence = 0.0, 0.0

    anomaly_scores = [e.weighted for e in ev if e.domain == "anomaly"]
    anomaly = max(anomaly_scores, default=0.0)

    labs = list(lab_predictions)
    lab_signal = max((float(np.clip(x.probability_changed, 0, 1)) for x in labs), default=0.0)
    priority = 0.58 * combined + 0.27 * lab_signal + 0.15 * anomaly

    if days_since_last_draw is not None and days_since_last_draw < minimum_test_interval_days:
        priority *= max(0.25, days_since_last_draw / minimum_test_interval_days)

    priority = float(np.clip(priority, 0, 1))
    if priority >= 0.72:
        status = "TEST NOW"
    elif priority >= 0.46:
        status = "WATCH"
    else:
        status = "NO TEST"

    domain_to_panel = {
        "metabolic": "Metabolic / glucose",
        "hematology": "CBC",
        "inflammation": "Inflammation",
        "lipids": "Lipid panel",
        "kidney": "Renal function",
        "liver": "Liver function",
    }
    domain_strength: dict[str, float] = {}
    for p in labs:
        domain_strength[p.domain] = max(domain_strength.get(p.domain, 0.0), p.probability_changed)
    panels = [domain_to_panel[d] for d, v in sorted(domain_strength.items(), key=lambda kv: -kv[1])
              if d in domain_to_panel and v >= 0.45]
    if not panels and anomaly >= 0.55:
        panels = ["CBC", "Metabolic / glucose"]

    top_reasons = [e.reason for e in sorted(ev, key=lambda x: x.weighted, reverse=True)[:4]]
    return Decision(
        priority=priority,
        status=status,
        confidence=confidence,
        anomaly_score=float(anomaly),
        recommended_panel=panels,
        reasons=top_reasons,
        evidence=[asdict(e) | {"weighted": e.weighted} for e in ev],
        lab_predictions=[asdict(p) for p in labs],
    )


def evidence_from_scores(
    *,
    anomaly: float,
    metabolic: float,
    lab_change: float,
    population_prior: float,
    hormone_context: float = 0.0,
) -> list[Evidence]:
    """Convenience constructor mapping dataset-expert outputs into fusion evidence."""
    return [
        Evidence("Stanford illness", anomaly, 0.88, "anomaly",
                 "Persistent heart-rate/activity deviation from the personal baseline."),
        Evidence("BIG IDEAs", metabolic, 0.78, "metabolic",
                 "Wearable/CGM pattern resembles states associated with abnormal glycemic physiology."),
        Evidence("iPOP", lab_change, 0.82, "general",
                 "Wearable trajectory predicts movement in clinical laboratory measurements."),
        Evidence("NHANES", population_prior, 0.62, "general",
                 "Population activity phenotype increases the prior probability of an abnormal lab."),
        Evidence("MMASH", hormone_context, 0.48, "anomaly",
                 "Sleep/HRV/hormonal context supports that the wearable deviation is physiological rather than activity alone."),
    ]
