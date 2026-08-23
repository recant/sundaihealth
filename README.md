# PulseLab / BloodNeedNet

PulseLab is a research prototype for **continuous, event-triggered blood testing from wearable physiology**.

There is no “Analyze” button and no LLM in the decision path. The app continuously recomputes as wearable values change.

## Model

`BloodNeedNet v0.1` is a supervised multilabel neural network trained from same-participant NHANES 2013–2014 wrist accelerometry and laboratory data. The training pipeline constructs day-level examples relative to each participant's prior wearable baseline and predicts whether four focused blood panels contain a prespecified out-of-range target:

- glycemic → Hemoglobin A1c
- CBC → complete blood count
- metabolic → comprehensive metabolic panel
- lipid → lipid panel
- plus an `any_abnormal` head used for overall expected testing yield

The browser loads the exported neural-network weights from `frontend/model/bloodneed-model.json` and performs inference locally. A personal physiology-drift signal from resting HR, HRV, sleep, steps, temperature, SpO2, respiratory rate, and optional CGM modulates urgency and provides person-specific reasons.

The training target is **screening yield**, not a diagnosis and not proof that a test is medically necessary. This is not a validated medical device.

## Train the model

```bash
python -m pip install pandas numpy scikit-learn requests pyreadstat
python training/train_model.py
```

The script downloads the public NHANES files directly from CDC, trains the MLP with participant-level holdout, prints held-out AUROCs, and writes:

```text
frontend/model/bloodneed-model.json
```

GitHub Actions also retrains automatically whenever `training/**` changes. See `.github/workflows/train-model.yml`.

## Run the app

Because inference is static/browser-side, no API key is required.

```bash
cd frontend
python -m http.server 8000
```

Open `http://localhost:8000`. Any edit to the wearable fields updates the model immediately.

## Deploy

On Vercel, import `recant/sundaihealth` and set **Root Directory** to `frontend`. No build command or environment variables are required.

## Data sources used in v0.1 training

- NHANES 2013–2014 `PAXDAY_H`: wrist ActiGraph daily summaries
- `DEMO_H`: age/sex used for target definitions and optional model context
- `GHB_H`: glycohemoglobin
- `CBC_H`: CBC
- `BIOPRO_H`: standard biochemistry profile
- `HDL_H`: HDL cholesterol

Future versions should add genuinely longitudinal wearable + repeated-lab cohorts so the target can become *new lab change within the next N days*, rather than cross-sectional screening yield.
