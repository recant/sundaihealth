"""Streaming/feature adapters for the datasets used by the adaptive-testing ensemble.

These functions intentionally preserve cohort boundaries. They emit compact daily or
participant-level feature tables suitable for source-specific models; they never join
unrelated participants across datasets.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import pandas as pd


def _read_table(path: str | Path, **kwargs) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() in {".parquet", ".pq"}:
        return pd.read_parquet(path, **kwargs)
    if path.suffix.lower() in {".xpt", ".xport"}:
        return pd.read_sas(path, format="xport", **kwargs)
    return pd.read_csv(path, **kwargs)


def _first(cols, names):
    lower = {str(c).lower(): c for c in cols}
    for n in names:
        if n.lower() in lower:
            return lower[n.lower()]
    return None


def _numeric_value_col(df: pd.DataFrame, *, exclude: Sequence[str] = ()) -> str | None:
    excluded = set(exclude)
    common = _first(df.columns, ["value", "heartrate", "heart_rate", "hr", "steps", "ibi", "temp", "temperature", "eda", "glucose"])
    if common is not None and common not in excluded:
        return common
    for c in df.columns:
        if c not in excluded and pd.api.types.is_numeric_dtype(df[c]):
            return c
    return None


def big_ideas_daily_features(root: str | Path, participants: Iterable[str] | None = None) -> pd.DataFrame:
    """Summarize every available BIG IDEAs participant into daily features."""
    root = Path(root)
    ids = set(str(x).zfill(3) for x in participants) if participants is not None else None
    folders = sorted(p for p in root.iterdir() if p.is_dir() and re.fullmatch(r"\d{3}", p.name))
    rows = []
    for folder in folders:
        pid = folder.name
        if ids is not None and pid not in ids:
            continue
        streams: dict[str, pd.DataFrame] = {}
        for signal in ["HR", "IBI", "TEMP", "EDA", "Dexcom"]:
            matches = list(folder.glob(f"{signal}_{pid}.csv")) + list(folder.glob(f"{signal}.csv"))
            if not matches:
                continue
            df = pd.read_csv(matches[0])
            tcol = _first(df.columns, ["Timestamp", "timestamp", "datetime", "time"])
            vcol = _numeric_value_col(df, exclude=[tcol] if tcol else [])
            if tcol is None or vcol is None:
                continue
            x = df[[tcol, vcol]].rename(columns={tcol: "timestamp", vcol: "value"})
            x["timestamp"] = pd.to_datetime(x["timestamp"], errors="coerce")
            x["value"] = pd.to_numeric(x["value"], errors="coerce")
            x = x.dropna(subset=["timestamp", "value"])
            x["date"] = x["timestamp"].dt.date
            streams[signal.lower()] = x

        dates = sorted(set().union(*(set(x["date"]) for x in streams.values()))) if streams else []
        for date in dates:
            rec = {"participant_id": pid, "date": pd.Timestamp(date), "source": "big_ideas"}
            for name, x in streams.items():
                s = x.loc[x["date"] == date, "value"]
                if s.empty:
                    continue
                rec[f"{name}_mean"] = float(s.mean())
                rec[f"{name}_std"] = float(s.std(ddof=1)) if len(s) > 1 else 0.0
                rec[f"{name}_median"] = float(s.median())
                rec[f"{name}_n"] = int(len(s))
                if name == "ibi" and len(s) >= 3:
                    d = np.diff(s.to_numpy(dtype=float))
                    rec["rmssd"] = float(np.sqrt(np.mean(d ** 2)))
                if name == "dexcom":
                    mean = float(s.mean())
                    rec["cgm_cv"] = float(s.std(ddof=1) / mean) if mean else np.nan
                    rec["cgm_time_above_140"] = float((s > 140).mean())
                    rec["cgm_time_below_70"] = float((s < 70).mean())
            rows.append(rec)
    return pd.DataFrame(rows).sort_values(["participant_id", "date"]).reset_index(drop=True) if rows else pd.DataFrame()


def mmash_daily_features(mmash_module=None) -> pd.DataFrame:
    """Use the existing clean MMASH loaders to emit one row per user/day."""
    if mmash_module is None:
        import mmash as mmash_module
    ag = mmash_module.actigraph(drop_artifacts=True)
    daily = ag.groupby(["user_id", "day"], as_index=False).agg(
        heart_rate_mean=("hr", "mean"),
        heart_rate_std=("hr", "std"),
        heart_rate_median=("hr", "median"),
        steps=("steps", "sum"),
        vector_magnitude_mean=("vector_magnitude", "mean") if "vector_magnitude" in ag.columns else ("hr", "size"),
    )
    hrv = mmash_module.hrv(by_day=True).rename(columns={"mean_hr": "ibi_mean_hr"})
    keep = [c for c in ["user_id", "day", "rmssd_ms", "sdnn_ms", "ibi_mean_hr", "suspect"] if c in hrv.columns]
    out = daily.merge(hrv[keep], on=["user_id", "day"], how="left")
    out = out.rename(columns={"user_id": "participant_id"})
    out["source"] = "mmash"
    return out


def stanford_illness_daily_features(root: str | Path) -> pd.DataFrame:
    """Summarize Stanford illness/COVID wearable CSVs without hard-coding one device."""
    root = Path(root)
    files = list(root.rglob("*.csv")) if root.is_dir() else [root]
    per_signal = []
    for path in files:
        name = path.name.lower()
        signal = None
        if re.search(r"(?:^|[-_])(rhr|resting.?hr)(?:[-_.]|$)", name): signal = "resting_hr"
        elif re.search(r"(?:^|[-_])(hr|heartrate|heart.?rate)(?:[-_.]|$)", name): signal = "heart_rate"
        elif re.search(r"(?:^|[-_])(st|step|steps)(?:[-_.]|$)", name): signal = "steps"
        elif "sleep" in name: signal = "sleep"
        if signal is None:
            continue
        try:
            df = pd.read_csv(path)
        except Exception:
            continue
        tcol = _first(df.columns, ["timestamp", "datetime", "date", "time", "Time", "Date"])
        if tcol is None:
            tcol = df.columns[0] if len(df.columns) else None
        vcol = _numeric_value_col(df, exclude=[tcol] if tcol else [])
        if tcol is None or vcol is None:
            continue
        x = df[[tcol, vcol]].copy()
        x.columns = ["timestamp", "value"]
        x["timestamp"] = pd.to_datetime(x["timestamp"], errors="coerce", utc=True)
        x["value"] = pd.to_numeric(x["value"], errors="coerce")
        x = x.dropna()
        if x.empty:
            continue
        m = re.match(r"([^_-]+)", path.name)
        pid = m.group(1) if m else path.stem
        x["participant_id"] = pid
        x["signal"] = signal
        per_signal.append(x)
    if not per_signal:
        return pd.DataFrame()
    allx = pd.concat(per_signal, ignore_index=True)
    allx["date"] = allx["timestamp"].dt.floor("D").dt.tz_localize(None)
    rows = []
    for (pid, date), g in allx.groupby(["participant_id", "date"]):
        rec = {"participant_id": pid, "date": date, "source": "stanford_illness"}
        for signal, x in g.groupby("signal"):
            s = x["value"]
            rec[f"{signal}_mean"] = float(s.mean())
            rec[f"{signal}_median"] = float(s.median())
            rec[f"{signal}_std"] = float(s.std(ddof=1)) if len(s) > 1 else 0.0
            rec[f"{signal}_n"] = int(len(s))
        rows.append(rec)
    return pd.DataFrame(rows).sort_values(["participant_id", "date"]).reset_index(drop=True)


def nhanes_join_activity_labs(
    activity: pd.DataFrame | str | Path,
    labs: pd.DataFrame | str | Path,
    *,
    seqn: str = "SEQN",
) -> pd.DataFrame:
    """Create a same-participant NHANES activity + laboratory table."""
    a = activity.copy() if isinstance(activity, pd.DataFrame) else _read_table(activity)
    l = labs.copy() if isinstance(labs, pd.DataFrame) else _read_table(labs)
    if seqn not in a.columns or seqn not in l.columns:
        raise ValueError(f"both NHANES tables must contain {seqn}")
    numeric_a = [c for c in a.select_dtypes(include=np.number).columns if c != seqn]
    if a[seqn].duplicated().any():
        agg = {}
        for c in numeric_a:
            lc = c.lower()
            agg[c] = "sum" if any(k in lc for k in ["step", "count", "minute"]) else "mean"
        a = a.groupby(seqn, as_index=False).agg(agg)
    if l[seqn].duplicated().any():
        num_l = [c for c in l.select_dtypes(include=np.number).columns if c != seqn]
        other = [c for c in l.columns if c not in num_l + [seqn]]
        l_num = l.groupby(seqn, as_index=False)[num_l].median() if num_l else l[[seqn]].drop_duplicates()
        if other:
            l_other = l.groupby(seqn, as_index=False)[other].first()
            l = l_num.merge(l_other, on=seqn, how="left")
        else:
            l = l_num
    out = a.merge(l, on=seqn, how="inner", validate="one_to_one")
    out["participant_id"] = out[seqn].astype(str)
    out["source"] = "nhanes"
    return out


def iter_ipop_wearable_csvs(root: str | Path):
    """Yield iPOP wearable CSVs one at a time so the ~20 GB archive is never loaded whole."""
    root = Path(root)
    for path in sorted(root.rglob("*.csv")):
        try:
            df = pd.read_csv(path)
        except Exception:
            continue
        yield path, df
