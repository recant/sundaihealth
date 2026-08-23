"""Utilities for turning Stanford iPOP wearable + lab data into blood-test triggers.

The public Stanford archive contains the raw wearable time series. The clinical lab
CSV used by Dunn et al. (Nature Medicine 2021) was stored in their SECURE_data
directory and is not redistributed here. This module standardizes an authorized iPOP
lab export, summarizes pre-draw wearable windows, trains one regression model per lab,
and converts predicted departures from the last measured lab into a testing priority.

Research/demo code; not a clinical decision system.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np
import pandas as pd

PUBLIC_WEARABLE_URL = "http://ipop-data.stanford.edu/wearable_data/Stanford_Wearables_data.tar"

LAB_COLUMNS = (
    "LYM", "NEUT", "LYMAB", "NEUTAB", "IGM", "HSCRP", "ALKP", "ALT", "HDL",
    "MCV", "TBIL", "CHOLHDL", "GLOB", "AG", "CO2", "CA", "LDLHDL", "BUN",
    "NHDL", "NA.", "UALB", "MONOAB", "CHOL", "MONO", "RDW", "HCT", "TP",
    "TGL", "EOS", "LDL", "GLU", "AST", "PLT", "K", "EOSAB", "BASOAB", "MCH",
    "ALB", "HGB", "A1C", "CL", "RBC", "BASO", "MCHC",
)
DEFAULT_WINDOWS_DAYS = (1, 3, 5, 7, 14, 30)
_ID_ALIASES = ("participant_id", "iPOP_ID", "HIMC_ID", "HIMCID", "user_id")
_DATE_ALIASES = ("lab_date", "Clin_Result_Date", "RESULT_TIME", "RECORDED_TIME", "date", "timestamp")
_TIME_ALIASES = ("timestamp", "datetime", "time", "date_time", "DateTime", "Time")
_WEARABLE_ID_ALIASES = ("participant_id", "iPOP_ID", "HIMC_ID", "HIMCID", "user_id", "subject")


def _read_frame(obj) -> pd.DataFrame:
    if isinstance(obj, pd.DataFrame):
        return obj.copy()
    path = Path(obj)
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    if suffix in {".csv", ".txt"}:
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    raise ValueError(f"unsupported table format: {path}")


def _first_present(columns, aliases: Sequence[str]) -> str | None:
    cols = set(columns)
    return next((c for c in aliases if c in cols), None)


def _to_numeric_loose(s: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(s):
        return pd.to_numeric(s, errors="coerce")
    text = s.astype("string")
    number = text.str.extract(r"([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)", expand=False)
    return pd.to_numeric(number, errors="coerce")


def load_labs(obj, *, lab_columns: Sequence[str] = LAB_COLUMNS) -> pd.DataFrame:
    df = _read_frame(obj)
    id_col = _first_present(df.columns, _ID_ALIASES)
    date_col = _first_present(df.columns, _DATE_ALIASES)
    if id_col is None or date_col is None:
        raise ValueError("lab table must contain a participant id and date")
    present = [c for c in lab_columns if c in df.columns]
    if not present:
        raise ValueError("no known iPOP lab columns found; pass lab_columns=... for a custom panel")
    out = df[[id_col, date_col] + present].copy()
    out = out.rename(columns={id_col: "participant_id", date_col: "lab_date"})
    out["participant_id"] = out["participant_id"].astype(str)
    out["lab_date"] = pd.to_datetime(out["lab_date"], errors="coerce")
    out = out.dropna(subset=["participant_id", "lab_date"])
    for c in present:
        out[c] = _to_numeric_loose(out[c])
    return (
        out.groupby(["participant_id", "lab_date"], as_index=False)[present]
        .median(numeric_only=True)
        .sort_values(["participant_id", "lab_date"])
        .reset_index(drop=True)
    )


def standardize_wearables(obj, *, participant_col: str | None = None, timestamp_col: str | None = None) -> pd.DataFrame:
    df = _read_frame(obj)
    participant_col = participant_col or _first_present(df.columns, _WEARABLE_ID_ALIASES)
    timestamp_col = timestamp_col or _first_present(df.columns, _TIME_ALIASES)
    if participant_col is None or timestamp_col is None:
        raise ValueError("wearable table must contain participant and timestamp columns")
    out = df.rename(columns={participant_col: "participant_id", timestamp_col: "timestamp"}).copy()
    out["participant_id"] = out["participant_id"].astype(str)
    out["timestamp"] = pd.to_datetime(out["timestamp"], errors="coerce", utc=True)
    out = out.dropna(subset=["participant_id", "timestamp"])
    return out.sort_values(["participant_id", "timestamp"]).reset_index(drop=True)


def _slope_per_day(timestamps: pd.Series, values: pd.Series) -> float:
    mask = values.notna()
    if mask.sum() < 3:
        return np.nan
    t = timestamps[mask]
    v = values[mask].astype(float).to_numpy()
    x = (t - t.iloc[0]).dt.total_seconds().to_numpy() / 86400.0
    if np.ptp(x) == 0:
        return np.nan
    return float(np.polyfit(x, v, 1)[0])


def summarize_window(frame: pd.DataFrame, *, signal_columns: Sequence[str]) -> dict[str, float]:
    rec: dict[str, float] = {}
    for col in signal_columns:
        s = pd.to_numeric(frame[col], errors="coerce")
        valid = s.dropna()
        rec[f"{col}__n"] = float(valid.size)
        if valid.empty:
            for stat in ("mean", "std", "median", "min", "max", "q25", "q75", "slope_day"):
                rec[f"{col}__{stat}"] = np.nan
            continue
        rec[f"{col}__mean"] = float(valid.mean())
        rec[f"{col}__std"] = float(valid.std(ddof=1)) if valid.size > 1 else 0.0
        rec[f"{col}__median"] = float(valid.median())
        rec[f"{col}__min"] = float(valid.min())
        rec[f"{col}__max"] = float(valid.max())
        rec[f"{col}__q25"] = float(valid.quantile(0.25))
        rec[f"{col}__q75"] = float(valid.quantile(0.75))
        rec[f"{col}__slope_day"] = _slope_per_day(frame["timestamp"], s)
    return rec


def build_lab_windows(wearables, labs, *, windows_days: Sequence[int] = DEFAULT_WINDOWS_DAYS,
                      signal_columns: Sequence[str] | None = None, min_points: int = 10) -> pd.DataFrame:
    w = standardize_wearables(wearables)
    raw_labs = _read_frame(labs)
    present_labs = [c for c in LAB_COLUMNS if c in raw_labs.columns]
    l = load_labs(raw_labs, lab_columns=present_labs or LAB_COLUMNS)
    if signal_columns is None:
        signal_columns = [c for c in w.columns if c not in {"participant_id", "timestamp"}
                          and pd.api.types.is_numeric_dtype(w[c])]
    signal_columns = list(signal_columns)
    if not signal_columns:
        raise ValueError("no numeric wearable signal columns found")
    windows_days = tuple(sorted(set(int(d) for d in windows_days if int(d) > 0)))
    if not windows_days:
        raise ValueError("windows_days must contain positive integers")
    rows = []
    groups = {pid: g for pid, g in w.groupby("participant_id", sort=False)}
    lab_cols = [c for c in l.columns if c not in {"participant_id", "lab_date"}]
    for _, visit in l.iterrows():
        pid = visit["participant_id"]
        g = groups.get(pid)
        if g is None or g.empty:
            continue
        t = pd.Timestamp(visit["lab_date"])
        t = t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")
        rec = {"participant_id": pid, "lab_date": t}
        for c in lab_cols:
            rec[c] = visit[c]
        for days in windows_days:
            start = t - pd.Timedelta(days=days)
            window = g[(g["timestamp"] >= start) & (g["timestamp"] < t)]
            rec[f"window_{days}d__rows"] = float(len(window))
            for key, value in summarize_window(window, signal_columns=signal_columns).items():
                rec[f"window_{days}d__{key}"] = value
        if rec[f"window_{max(windows_days)}d__rows"] >= min_points:
            rows.append(rec)
    return pd.DataFrame(rows).sort_values(["participant_id", "lab_date"]).reset_index(drop=True)


def add_previous_lab_values(table: pd.DataFrame, *, lab_columns: Sequence[str] | None = None) -> pd.DataFrame:
    out = table.sort_values(["participant_id", "lab_date"]).copy()
    labs = list(lab_columns or [c for c in LAB_COLUMNS if c in out.columns])
    for lab in labs:
        out[f"{lab}__previous"] = out.groupby("participant_id")[lab].shift(1)
        out[f"{lab}__delta"] = out[lab] - out[f"{lab}__previous"]
        denom = out[f"{lab}__previous"].abs().replace(0, np.nan)
        out[f"{lab}__relative_delta"] = out[f"{lab}__delta"] / denom
    out["previous_lab_date"] = out.groupby("participant_id")["lab_date"].shift(1)
    out["days_since_previous_lab"] = (out["lab_date"] - out["previous_lab_date"]).dt.total_seconds() / 86400.0
    return out


@dataclass
class LabModel:
    lab: str
    feature_columns: list[str]
    model: object
    n_train: int


def train_lab_models(feature_table: pd.DataFrame, *, labs: Sequence[str] = ("GLU", "A1C", "HGB", "HCT", "RBC", "MONOAB"),
                     min_rows: int = 20, random_state: int = 0) -> dict[str, LabModel]:
    try:
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.impute import SimpleImputer
        from sklearn.pipeline import make_pipeline
    except ImportError as e:
        raise ImportError("train_lab_models requires scikit-learn") from e
    feature_cols = [c for c in feature_table.columns
                    if c not in {"participant_id", "lab_date", "previous_lab_date"}
                    and c not in LAB_COLUMNS
                    and not c.endswith(("__previous", "__delta", "__relative_delta"))
                    and pd.api.types.is_numeric_dtype(feature_table[c])]
    models: dict[str, LabModel] = {}
    for lab in labs:
        if lab not in feature_table:
            continue
        df = feature_table.loc[feature_table[lab].notna(), feature_cols + [lab]].copy()
        if len(df) < min_rows:
            continue
        model = make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestRegressor(n_estimators=300, min_samples_leaf=max(2, len(df) // 50),
                                  random_state=random_state, n_jobs=-1),
        )
        model.fit(df[feature_cols], df[lab].astype(float))
        models[lab] = LabModel(lab=lab, feature_columns=feature_cols, model=model, n_train=len(df))
    return models


def predict_testing_priority(model: LabModel, feature_row: pd.Series | Mapping[str, float], *,
                             last_measured_value: float, reference_scale: float | None = None,
                             relative_change_trigger: float = 0.15) -> dict[str, float | bool | str]:
    row = pd.DataFrame([{c: feature_row.get(c, np.nan) for c in model.feature_columns}])
    predicted = float(model.model.predict(row)[0])
    delta = predicted - float(last_measured_value)
    if reference_scale is not None and reference_scale > 0:
        score = abs(delta) / float(reference_scale)
    else:
        denom = max(abs(float(last_measured_value)), 1e-12)
        score = abs(delta) / (relative_change_trigger * denom)
    return {"lab": model.lab, "predicted_value": predicted, "last_measured_value": float(last_measured_value),
            "predicted_change": delta, "priority_score": float(score), "test_now": bool(score >= 1.0)}


def participant_folds(df: pd.DataFrame, *, n_folds: int = 5, seed: int = 0):
    ids = np.array(sorted(df["participant_id"].dropna().astype(str).unique()))
    if not 2 <= n_folds <= len(ids):
        raise ValueError("n_folds must be between 2 and the number of participants")
    rng = np.random.default_rng(seed)
    rng.shuffle(ids)
    for held_out in np.array_split(ids, n_folds):
        test_mask = df["participant_id"].isin(held_out)
        yield df.index[~test_mask].to_numpy(), df.index[test_mask].to_numpy()
