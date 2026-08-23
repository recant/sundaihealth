from __future__ import annotations
import pathlib, shutil

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE / 'dist'
MODEL = HERE / 'model' / 'bloodneed-model.json'

if not MODEL.exists():
    raise FileNotFoundError(
        'Missing model/bloodneed-model.json. Train BloodNeedNet before deployment.'
    )

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()

for name in ['index.html', 'app.js', 'styles.css', 'model-runtime.js']:
    shutil.copy2(HERE / name, DIST / name)

(DIST / 'model').mkdir()
shutil.copy2(MODEL, DIST / 'model' / 'bloodneed-model.json')

print(f'Built static app in {DIST} using trained model {MODEL}')
