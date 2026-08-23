from __future__ import annotations

import argparse
import json
import pathlib
import requests
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / '.training_cache'
CACHE.mkdir(exist_ok=True)
NHANES_BASE = 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2013/DataFiles'
FILES = ['PAXDAY_H','DEMO_H','GHB_H','CBC_H','BIOPRO_H','HDL_H']
FEATURES = ['age','sex_male','baseline_sleep_h','current_sleep_h','sleep_delta_pct','activity_delta_pct','persistence_days']
OUTPUTS = ['any_abnormal','glycemic','cbc','metabolic','lipid']


def download(name: str) -> pathlib.Path:
    path = CACHE / f'{name}.xpt'
    if path.exists() and path.stat().st_size > 1000:
        return path
    r = requests.get(f'{NHANES_BASE}/{name}.xpt', timeout=180, headers={'User-Agent':'Mozilla/5.0'})
    r.raise_for_status()
    path.write_bytes(r.content)
    return path


def load(name: str) -> pd.DataFrame:
    return pd.read_sas(download(name), format='xport')


def pct(cur, base):
    if pd.isna(cur) or pd.isna(base) or abs(base) < 1e-9:
        return np.nan
    return (cur-base)/abs(base)


def col(df, name):
    if name not in df.columns:
        return pd.Series(np.nan, index=df.index)
    return pd.to_numeric(df[name], errors='coerce')


def build_examples() -> pd.DataFrame:
    pax, demo, ghb, cbc, bio, hdl = [load(x) for x in FILES]
    labs = demo[['SEQN','RIDAGEYR','RIAGENDR']].copy()
    for df in (ghb, cbc, bio, hdl):
        labs = labs.merge(df, on='SEQN', how='left')

    male = labs['RIAGENDR'].eq(1)
    a1c = col(labs,'LBXGH')
    wbc = col(labs,'LBXWBCSI')
    platelets = col(labs,'LBXPLTSI')
    hgb = col(labs,'LBXHGB')
    albumin = col(labs,'LBXSAL')
    creatinine = col(labs,'LBXSCR')
    alt = col(labs,'LBXSATSI')
    ast = col(labs,'LBXSASSI')
    potassium = col(labs,'LBXSKSI')
    sodium = col(labs,'LBXSNASI')
    hdl_value = col(labs,'LBDHDD')
    total_chol = col(labs,'LBXSCH')

    gly = a1c.ge(5.7)
    cbc_bad = (
        wbc.lt(4.0) | wbc.gt(11.0) |
        platelets.lt(150) | platelets.gt(450) |
        (male & (hgb.lt(13.0) | hgb.gt(17.5))) |
        (~male & (hgb.lt(12.0) | hgb.gt(15.5)))
    )
    metabolic = (
        albumin.lt(3.5) |
        creatinine.gt(np.where(male,1.3,1.1)) |
        alt.gt(np.where(male,55,45)) |
        ast.gt(40) |
        potassium.lt(3.5) | potassium.gt(5.1) |
        sodium.lt(135) | sodium.gt(145)
    )
    lipid = hdl_value.lt(np.where(male,40,50)) | total_chol.ge(240)

    labs['glycemic'] = gly.fillna(False).astype(int)
    labs['cbc'] = cbc_bad.fillna(False).astype(int)
    labs['metabolic'] = metabolic.fillna(False).astype(int)
    labs['lipid'] = lipid.fillna(False).astype(int)
    labs['any_abnormal'] = labs[['glycemic','cbc','metabolic','lipid']].max(axis=1)

    # The analog bank only uses people with observed values for every target family.
    # This prevents a missing lab from being displayed as a reassuring "normal" analog outcome.
    labs['analog_complete'] = (
        a1c.notna() & wbc.notna() & platelets.notna() & hgb.notna() &
        albumin.notna() & creatinine.notna() & alt.notna() & ast.notna() &
        potassium.notna() & sodium.notna() & hdl_value.notna() & total_chol.notna()
    )

    rows=[]
    for seqn,g in pax.groupby('SEQN'):
        g=g.sort_values('PAXDAYD').copy()
        g=g[pd.to_numeric(g['PAXVMD'], errors='coerce').fillna(0)>=1000]
        if len(g)<3: continue
        sleep=pd.to_numeric(g['PAXSWMD'], errors='coerce')/60.0
        act=pd.to_numeric(g['PAXMTSD'], errors='coerce')
        for i in range(1,len(g)):
            prev_sleep=sleep.iloc[:i]; prev_act=act.iloc[:i]
            if prev_sleep.notna().sum()<1: continue
            base_sleep=float(prev_sleep.median()); cur_sleep=float(sleep.iloc[i])
            base_act=float(prev_act.median()) if prev_act.notna().any() else np.nan
            cur_act=float(act.iloc[i])
            sign=np.sign(cur_sleep-base_sleep); persistence=1
            for j in range(i-1,0,-1):
                b=float(sleep.iloc[:j].median()); s=np.sign(float(sleep.iloc[j])-b)
                if sign!=0 and s==sign: persistence+=1
                else: break
            rows.append({'SEQN':seqn,'baseline_sleep_h':base_sleep,'current_sleep_h':cur_sleep,
                'sleep_delta_pct':pct(cur_sleep,base_sleep),'activity_delta_pct':pct(cur_act,base_act),
                'persistence_days':min(persistence,7)})
    x=pd.DataFrame(rows).merge(labs[['SEQN','RIDAGEYR','RIAGENDR','analog_complete']+OUTPUTS],on='SEQN',how='inner')
    x=x.rename(columns={'RIDAGEYR':'age'}); x['sex_male']=x['RIAGENDR'].eq(1).astype(float)
    return x[(x['age']>=18)&(x['age']<=85)]


def export_mlp(pipe, metrics, n, n_people):
    imp=pipe.named_steps['imputer']; scaler=pipe.named_steps['scaler']; net=pipe.named_steps['mlp']
    return {'type':'mlp_multilabel','feature_names':FEATURES,'output_names':OUTPUTS,
        'imputer_median':imp.statistics_.tolist(),'scaler_mean':scaler.mean_.tolist(),'scaler_scale':scaler.scale_.tolist(),
        'layers':[w.tolist() for w in net.coefs_],'biases':[b.tolist() for b in net.intercepts_],
        'activation':'relu','output_activation':'sigmoid','training_rows':int(n),'training_participants':int(n_people),
        'heldout_auc':metrics}


def export_analog_bank(pipe, train_df: pd.DataFrame, max_people: int = 600):
    eligible = train_df[train_df['analog_complete'].fillna(False)].copy()
    if eligible.empty:
        return {'source':'NHANES 2013-2014','records':[]}

    # One representative wearable day per participant; never export SEQN itself.
    rep = eligible.sort_values(['SEQN']).groupby('SEQN', group_keys=False).tail(1).copy()
    if len(rep) > max_people:
        rep = rep.sample(max_people, random_state=42).sort_values('SEQN')

    imp = pipe.named_steps['imputer']
    scaler = pipe.named_steps['scaler']
    z = scaler.transform(imp.transform(rep[FEATURES]))
    records=[]
    for i,(_,row) in enumerate(rep.reset_index(drop=True).iterrows()):
        age=int(row['age']); lo=(age//10)*10; hi=lo+9
        records.append({
            'id':f'NH-A{i+1:04d}',
            'age_band':f'{lo}-{hi}',
            'z':[round(float(v),4) for v in z[i]],
            'outcomes':{name:int(row[name]) for name in OUTPUTS},
        })
    return {
        'source':'NHANES 2013-2014 anonymized complete-lab training participants',
        'meaning':'nearest neighbors in standardized BloodNeedNet input space; outcomes are same-participant lab targets, not later disease',
        'records':records,
    }


def train(out: pathlib.Path):
    df=build_examples().replace([np.inf,-np.inf],np.nan)
    groups=df['SEQN'].astype(int).to_numpy(); X=df[FEATURES]; Y=df[OUTPUTS].astype(int)
    tr,te=next(GroupShuffleSplit(n_splits=1,test_size=.2,random_state=42).split(X,Y,groups=groups))
    pipe=Pipeline([('imputer',SimpleImputer(strategy='median')),('scaler',StandardScaler()),
        ('mlp',MLPClassifier(hidden_layer_sizes=(32,16),activation='relu',alpha=.003,max_iter=700,
            early_stopping=True,validation_fraction=.15,random_state=42))])
    pipe.fit(X.iloc[tr],Y.iloc[tr]); probs=pipe.predict_proba(X.iloc[te]); metrics={}
    for j,name in enumerate(OUTPUTS):
        y=Y[name].iloc[te].to_numpy()
        try: metrics[name]=round(float(roc_auc_score(y,probs[:,j])),3)
        except Exception: metrics[name]=None

    analog_bank=export_analog_bank(pipe,df.iloc[tr])
    model={'name':'BloodNeedNet','version':'0.2.0','trained_on':'NHANES 2013-2014 wrist accelerometry + same-participant labs',
        'target_definition':'probability that a focused screening panel contains at least one prespecified out-of-range result',
        'forecast_capabilities':{
            'supports_current_lab_yield':True,
            'supports_persistence_scenario_projection':True,
            'supports_future_disease_incidence':False,
            'future_disease_note':'Requires longitudinal wearable data linked to later adjudicated disease outcomes.'
        },
        'panel_model':export_mlp(pipe,metrics,len(df),df.SEQN.nunique()),
        'analog_bank':analog_bank,
        'panel_tests':{
            'glycemic':{'name':'Hemoglobin A1c','description':'Longer-term glycemic status.'},
            'cbc':{'name':'Complete blood count (CBC)','description':'Hemoglobin, white cells, and platelets.'},
            'metabolic':{'name':'Comprehensive metabolic panel (CMP)','description':'Kidney, liver, electrolyte, protein, and glucose context.'},
            'lipid':{'name':'Lipid panel','description':'Cholesterol and cardiovascular-risk context.'}}}
    out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(model,separators=(',',':')))
    print(json.dumps({'rows':len(df),'participants':int(df.SEQN.nunique()),'analogs':len(analog_bank['records']),'auc':metrics},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--out',default='model/bloodneed-model.json'); a=p.parse_args()
    train((HERE/pathlib.Path(a.out)).resolve())
