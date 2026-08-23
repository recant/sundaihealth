# PulseLab / BloodNeedNet

PulseLab is a research prototype for **continuous, event-triggered blood testing from wearable physiology**.

There is no “Analyze” button and no LLM in the decision path. The app continuously recomputes whenever new wearable data arrives.

## Model

`BloodNeedNet v0.1` is a supervised multilabel neural network trained from same-participant NHANES 2013–2014 wrist accelerometry and laboratory data. The training pipeline creates day-level examples relative to each participant's previous wearable baseline and predicts whether focused blood panels contain a prespecified out-of-range target:

- glycemic → Hemoglobin A1c
- CBC → complete blood count
- metabolic → comprehensive metabolic panel
- lipid → lipid panel
- `any_abnormal` → overall expected screening yield

The exported MLP weights run directly in the browser. A personal physiology-drift layer uses resting HR, HRV, sleep, activity, temperature, SpO₂, respiratory rate, and optional CGM to update urgency and explain which current signals are changing.

The target is **expected screening yield**, not diagnosis or proof that testing is medically necessary. This is not a validated medical device.

## WHOOP integration

PulseLab supports WHOOP OAuth directly. The user experience is:

```text
Connect WHOOP
→ authorize PulseLab on WHOOP
→ return to PulseLab
→ recent Recovery + Sleep history syncs automatically
→ personal baseline updates
→ BloodNeedNet recommendation updates
```

The server requests only `read:recovery`, `read:sleep`, and `offline`. It uses the refresh token to renew short-lived WHOOP access tokens. Tokens are encrypted before being stored in an HttpOnly, Secure, SameSite cookie; the browser JavaScript never receives the WHOOP client secret or raw access token.

The sync endpoint currently backfills up to roughly 90 days and uses WHOOP Recovery for resting HR, HRV, SpO₂, and skin temperature, plus WHOOP Sleep for respiratory rate and sleep-stage duration.

### One-time WHOOP developer setup

Create an app in the WHOOP Developer Dashboard and register this callback URL:

```text
https://YOUR-STABLE-VERCEL-DOMAIN/api/whoop/callback
```

Request these scopes:

```text
read:recovery
read:sleep
offline
```

Then configure these Vercel environment variables:

```text
WHOOP_CLIENT_ID=<WHOOP client id>
WHOOP_CLIENT_SECRET=<WHOOP client secret>
WHOOP_REDIRECT_URI=https://YOUR-STABLE-VERCEL-DOMAIN/api/whoop/callback
SESSION_SECRET=<long random secret>
```

After redeploying, the **Connect WHOOP** button performs the real OAuth flow.

## Deploy on Vercel

Import `recant/sundaihealth` and set **Root Directory** to `frontend`.

The trained `frontend/model/bloodneed-model.json` is committed to the repository. Deployment simply packages that artifact and the static UI; retraining is a separate operation.

```bash
cd frontend
npx vercel --prod
```

A stable project URL is strongly recommended for WHOOP OAuth because WHOOP requires the redirect URI to exactly match a URL registered in its Developer Dashboard.

## Train locally

```bash
cd frontend
python -m pip install -r requirements-build.txt
python train_model.py
python build.py
```

## Repository training workflow

`training/train_model.py` provides the same training logic for GitHub Actions. `.github/workflows/train-model.yml` can be run manually to retrain and commit the model artifact.

## Data used in v0.1

- NHANES 2013–2014 `PAXDAY_H`: wrist ActiGraph daily summaries
- `DEMO_H`: age and sex
- `GHB_H`: glycohemoglobin
- `CBC_H`: complete blood count
- `BIOPRO_H`: standard biochemistry profile
- `HDL_H`: HDL cholesterol

A stronger next model should pretrain a richer wearable encoder on MMASH, Stanford illness wearables, and BIG IDEAs, then fine-tune laboratory heads wherever paired blood measurements exist. Genuinely longitudinal repeated-lab data is needed before claiming a validated target such as “new lab change within the next N days.”
