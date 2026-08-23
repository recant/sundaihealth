from __future__ import annotations
import pathlib, shutil, subprocess, sys
HERE=pathlib.Path(__file__).resolve().parent
DIST=HERE/'dist'
if DIST.exists(): shutil.rmtree(DIST)
DIST.mkdir()
for name in ['index.html','app.js','styles.css','model-runtime.js']:
    shutil.copy2(HERE/name,DIST/name)
subprocess.run([sys.executable,str(HERE/'train_model.py'),'--out',str(DIST/'model'/'bloodneed-model.json')],check=True)
print(f'Built static app in {DIST}')
