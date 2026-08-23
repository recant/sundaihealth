# Multi-dataset adaptive blood testing demo

Goal: continuously watch a person's wearable physiology and trigger a blood draw only when a new test is likely to reveal useful new information.

## Important modeling rule

The datasets do **not** contain the same participants, so they are not concatenated into one fake table. Instead, each source trains an expert for the part of the problem it can actually supervise:

- **Stanford illness / COVID wearables** → learns personal baseline deviation and persistence (the **when did physiology change?** expert).
- **Stanford iPOP** → learns wearable features preceding repeated clinical lab results (the **what labs may have moved?** expert). Public wearables are available; the study lab export requires authorized access.
- **BIG IDEAs** → learns rich wrist-wearable / CGM patterns linked to metabolic testing and HbA1c (direct **metabolic test value** evidence).
- **NHANES** → provides a large population prior linking activity phenotype/demographics with abnormal laboratory values.
- **MMASH** → provides high-resolution HR, RR/HRV, sleep, activity, cortisol and melatonin for robust wearable/context feature engineering.
- **WEAR-ME** and **All of Us** are included in the registry as restricted validation sources and can be plugged in when access is available.

At inference time the source experts emit comparable 0–1 evidence scores and `unified.py` combines them with a noisy-OR-style evidence fusion rule. This preserves provenance: the frontend shows which dataset contributed each piece of evidence.

## Files

- `data_sources.py` — dataset registry and the role of each source.
- `ipop.py` — repeated-lab wearable-window pipeline from the Stanford iPOP design.
- `unified.py` — personalized anomaly scoring + evidence fusion + panel recommendation.
- `demo_pipeline.py` — generates demo JSON for the frontend.
- `frontend/` — dependency-free interactive dashboard.

## Run the frontend

From the repository root:

```bash
python demo_pipeline.py
python -m http.server 8080 -d frontend
```

Then open `http://localhost:8080`.

The three frontend scenarios are deliberately synthetic. They demonstrate the decision logic without pretending that subjects from unrelated cohorts can be joined. Replace the scores with outputs from source-specific trained models as the datasets are downloaded/prepared.

## Real-data training flow

1. **MMASH**: use the existing `mmash.py` loaders for HR/HRV/sleep/activity/context features.
2. **Stanford illness**: download the public COVID wearables ZIP and train a personal-baseline anomaly detector from HR/steps/sleep.
3. **BIG IDEAs**: use the PhysioNet v1.1.3 data; downsample HR/IBI/EDA/TEMP/ACC and derive CGM variability targets rather than loading the 34 GB raw files into RAM at once.
4. **NHANES**: join accelerometry and blood laboratory tables on `SEQN` within the same survey cycle; use participant-grouped evaluation and survey-aware analyses for population claims.
5. **iPOP**: use the public Stanford wearable archive plus an authorized clinical-lab export. `ipop.py` builds 1/3/5/7/14/30-day pre-draw windows and per-lab models.
6. Convert each expert's output into an `Evidence` object and call `fuse_evidence(...)`.

## Safety / interpretation

This is a research prototype. The `TEST NOW / WATCH / NO TEST` thresholds are demonstration policy thresholds, not clinically validated recommendations. A real clinical system would need prospective validation, false-negative analysis, calibration by lab and population, medical-device/regulatory review, and clinician-defined minimum/maximum retesting intervals.
