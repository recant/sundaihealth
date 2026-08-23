# BloodNeedNet training

Changing any file in this directory triggers `.github/workflows/train-model.yml`, which downloads the public NHANES 2013–2014 wearable/laboratory files, trains the multilabel MLP with participant-level holdout, and commits `frontend/model/bloodneed-model.json`.
