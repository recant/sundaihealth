# PulseLab AI

A research prototype for **event-triggered blood testing from wearable physiology**.

The user enters a personal baseline and current wearable metrics (resting HR, HRV, sleep, steps, temperature, SpO2, respiratory rate, and optionally CGM). A small deterministic preprocessing layer computes change-from-baseline features and persistence. A server-side Gemini model then returns:

- an AI testing-priority score,
- `NO_TEST`, `WATCH`, or `CONSIDER_TESTING_SOON`,
- plain-English reasons tied to the supplied wearable signals,
- a focused list of standard blood tests to consider and why,
- uncertainty and next steps.

This is a **research/demo system, not a medical device**. It does not diagnose disease or know whether a laboratory result is abnormal.

## Run locally

From `frontend/`:

```bash
npm i -g vercel
vercel dev
```

Create `.env.local` in `frontend/`:

```bash
GEMINI_API_KEY=your_key_here
# optional; defaults to gemini-3.5-flash
GEMINI_MODEL=gemini-3.5-flash
```

Then open the local URL printed by Vercel.

## Deploy on Vercel

Import `recant/sundaihealth` and set the Vercel project's **Root Directory** to `frontend`.

In **Project Settings → Environment Variables**, add:

```text
GEMINI_API_KEY = <your Gemini API key>
```

Apply it to Production (and Preview if desired), then redeploy.

The browser never receives the Gemini API key. The serverless function calls Gemini's Interactions API with `store: false` and returns only the structured analysis.

## API

`POST /api/analyze`

Example body:

```json
{
  "baseline": {"resting_hr": 58, "hrv": 56, "sleep_hours": 7.5, "spo2": 98},
  "current": {"resting_hr": 69, "hrv": 37, "sleep_hours": 5.9, "spo2": 96},
  "persistence_days": 3,
  "days_since_last_blood_test": 150,
  "notes": "Unusually fatigued for three days; no hard workout or travel."
}
```
