# PulseLab / BloodNeedNet

PulseLab is a research prototype for **continuous, event-triggered blood testing from wearable physiology**.

There is no “Analyze” button and no LLM in the decision path. The app continuously recomputes whenever wearable values change.

## Model

`BloodNeedNet v0.1` is a supervised multilabel neural network trained from same-participant NHANES 2013–2014 wrist accelerometry and laboratory data. The training pipeline creates day-level examples relative to each participant's previous wearable baseline and predicts whether focused blood panels contain a prespecified out-of-range target:

- glycemic → Hemoglobin A1c
- CBC → complete blood count
- metabolic → comprehensive metabolic panel
- lipid → lipid panel
- `any_abnormal` → overall expected screening yield

The exported MLP weights run directly in the browser. A personal physiology-drift layer uses resting HR, HRV, sleep, activity, temperature, SpO₂, respiratory rate, and optional CGM to update urgency and explain which current signals are changing.

The target is **expected screening yield**, not diagnosis or proof that testing is medically necessary. This is not a validated medical device.

## Deploy on Vercel

Import `recant/sundaihealth` and set **Root Directory** to `frontend`.

`frontend/vercel.json` handles the rest. During every deployment Vercel runs:

```text
install scientific Python dependencies
→ download the public NHANES XPT files from CDC
→ train BloodNeedNet with participant-level holdout
→ export dist/model/bloodneed-model.json
→ publish the static app
```

No Gemini key or other API key is required.

From the CLI, once authenticated with Vercel:

```bash
cd frontend
npx vercel --prod
```

For an unclaimed temporary deployment:

```bash
cd frontend
npx vercel deploy --temporary
```

## Train locally

```bash
cd frontend
python -m pip install -r requirements-build.txt
python train_model.py
```

This writes `frontend/model/bloodneed-model.json`. To test the static app locally after training:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. Every field edit reruns inference automatically.

## Repository training workflow

`training/train_model.py` provides the same training logic for GitHub Actions. `.github/workflows/train-model.yml` can retrain and commit the model artifact from the repository environment.

## Data used in v0.1

- NHANES 2013–2014 `PAXDAY_H`: wrist ActiGraph daily summaries
- `DEMO_H`: age and sex
- `GHB_H`: glycohemoglobin
- `CBC_H`: complete blood count
- `BIOPRO_H`: standard biochemistry profile
- `HDL_H`: HDL cholesterol

A stronger next model should pretrain a richer wearable encoder on MMASH, Stanford illness wearables, and BIG IDEAs, then fine-tune laboratory heads wherever paired blood measurements exist. Genuinely longitudinal repeated-lab data is needed before claiming a validated target such as “new lab change within the next N days.”
