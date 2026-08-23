from pathlib import Path
import tempfile
import pandas as pd

from adapters import big_ideas_daily_features, nhanes_join_activity_labs, stanford_illness_daily_features


def test_big_ideas():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / '001'; p.mkdir()
        ts = pd.date_range('2026-01-01', periods=4, freq='h')
        pd.DataFrame({'Timestamp': ts, 'Value': [60,62,64,66]}).to_csv(p/'HR_001.csv', index=False)
        pd.DataFrame({'Timestamp': ts, 'Value': [90,100,150,110]}).to_csv(p/'Dexcom_001.csv', index=False)
        out = big_ideas_daily_features(td)
        assert len(out) == 1 and out.loc[0,'hr_mean'] == 63
        assert out.loc[0,'cgm_time_above_140'] == .25


def test_nhanes():
    a = pd.DataFrame({'SEQN':[1,1,2,2], 'steps':[3,4,5,6], 'intensity':[1.,3.,2.,4.]})
    l = pd.DataFrame({'SEQN':[1,2], 'glucose':[90,110]})
    out = nhanes_join_activity_labs(a, l)
    assert len(out) == 2
    assert out.loc[out.SEQN == 1, 'steps'].iloc[0] == 7


def test_stanford():
    with tempfile.TemporaryDirectory() as td:
        ts = pd.date_range('2026-01-01', periods=4, freq='h')
        pd.DataFrame({'timestamp':ts,'value':[60,61,62,63]}).to_csv(Path(td)/'P001-AppleWatch-hr.csv', index=False)
        pd.DataFrame({'timestamp':ts,'steps':[0,10,0,4]}).to_csv(Path(td)/'P001-AppleWatch-st.csv', index=False)
        out = stanford_illness_daily_features(td)
        assert len(out) == 1
        assert 'heart_rate_mean' in out and 'steps_mean' in out


if __name__ == '__main__':
    for f in [test_big_ideas, test_nhanes, test_stanford]:
        f(); print('PASS', f.__name__)
