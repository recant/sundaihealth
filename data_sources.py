"""Registry for the multi-dataset blood-test timing demo.

The sources do not share participant identifiers, so they are *not* concatenated row-wise.
Each source trains or calibrates one piece of the decision system and the evidence is fused
at inference time.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DataSource:
    key: str
    name: str
    role: str
    modalities: tuple[str, ...]
    target: str
    access: str
    url: str
    public: bool = True


SOURCES = {
    "mmash": DataSource(
        key="mmash",
        name="MMASH",
        role="wearable physiology + context feature engineering",
        modalities=("heart_rate", "rr", "accelerometry", "steps", "sleep", "activity", "cortisol", "melatonin"),
        target="personal physiology state",
        access="Sundai bucket loader in mmash.py",
        url="https://github.com/zach-yaninek/sundai-mmash",
    ),
    "stanford_illness": DataSource(
        key="stanford_illness",
        name="Stanford COVID Wearables",
        role="personalized longitudinal anomaly detector",
        modalities=("heart_rate", "steps", "sleep"),
        target="physiological deviation / illness event",
        access="public ZIP",
        url="https://storage.googleapis.com/gbsc-gcp-project-ipop_public/COVID-19/COVID-19-Wearables.zip",
    ),
    "stanford_illness_phase2": DataSource(
        key="stanford_illness_phase2",
        name="Stanford COVID Phase 2",
        role="real-time alert calibration",
        modalities=("heart_rate", "steps"),
        target="stress/infection alert",
        access="public ZIP",
        url="https://storage.googleapis.com/gbsc-gcp-project-ipop_public/COVID-19-Phase2/COVID-19-Phase2-Wearables.zip",
    ),
    "big_ideas": DataSource(
        key="big_ideas",
        name="BIG IDEAs Glycemic Wearables",
        role="direct wearable-to-metabolic-testing evidence",
        modalities=("heart_rate", "ibi", "eda", "skin_temp", "accelerometry", "cgm", "food", "hba1c"),
        target="glycemic variability / need for additional metabolic testing",
        access="PhysioNet open dataset; ~34 GB uncompressed",
        url="https://physionet.org/content/big-ideas-glycemic-wearable/1.1.3/",
    ),
    "ipop": DataSource(
        key="ipop",
        name="Stanford iPOP",
        role="wearable-to-clinical-lab prediction over repeated visits",
        modalities=("heart_rate", "skin_temp", "eda", "movement", "clinical_labs"),
        target="44 laboratory measurements",
        access="public ~20 GB wearable archive; lab export requires authorized study access",
        url="http://ipop-data.stanford.edu/wearable_data/Stanford_Wearables_data.tar",
    ),
    "nhanes": DataSource(
        key="nhanes",
        name="NHANES",
        role="large population prior linking activity phenotype to laboratory abnormalities",
        modalities=("accelerometry", "demographics", "cbc", "chemistry", "lipids", "glucose", "hba1c"),
        target="population probability of abnormal lab values",
        access="CDC public files / Sundai bloodwork kit",
        url="https://wwwn.cdc.gov/Nchs/Nhanes/Search/DataPage.aspx?Component=Laboratory&Cycle=2005-2006",
    ),
    "wear_me": DataSource(
        key="wear_me",
        name="WEAR-ME",
        role="broad wearable-to-blood biomarker validation",
        modalities=("heart_rate", "hrv", "sleep", "steps", "temperature", "spo2", "cbc", "cmp", "lipids", "hba1c", "hscrp"),
        target="blood biomarker prediction",
        access="approved-researcher access",
        url="https://doi.org/10.1038/s41586-026-10179-2",
        public=False,
    ),
    "all_of_us": DataSource(
        key="all_of_us",
        name="All of Us",
        role="large-scale longitudinal Fitbit + EHR lab validation",
        modalities=("heart_rate", "steps", "sleep", "ehr_labs", "diagnoses", "medications"),
        target="real-world lab change and test timing",
        access="Researcher Workbench",
        url="https://www.researchallofus.org/data-tools/data-access/",
        public=False,
    ),
}


def public_sources():
    return [s for s in SOURCES.values() if s.public]


def source_summary():
    return [
        {
            "key": s.key,
            "name": s.name,
            "role": s.role,
            "modalities": list(s.modalities),
            "target": s.target,
            "access": s.access,
            "url": s.url,
            "public": s.public,
        }
        for s in SOURCES.values()
    ]
