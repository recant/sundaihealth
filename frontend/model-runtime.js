export function sigmoid(x){ return 1/(1+Math.exp(-Math.max(-40,Math.min(40,x)))); }
function relu(x){ return Math.max(0,x); }
function matvec(v,w,b,activation){
  const out=new Array(b.length).fill(0);
  for(let j=0;j<b.length;j++){
    let s=b[j];
    for(let i=0;i<v.length;i++) s += v[i]*w[i][j];
    out[j]=activation==='relu'?relu(s):sigmoid(s);
  }
  return out;
}
export function runPanelModel(model, features){
  const m=model.panel_model;
  let v=m.feature_names.map((name,i)=>{
    const x=features[name];
    const raw=Number.isFinite(x)?x:m.imputer_median[i];
    const scale=m.scaler_scale[i] || 1;
    return (raw-m.scaler_mean[i])/scale;
  });
  for(let k=0;k<m.layers.length;k++){
    const last=k===m.layers.length-1;
    v=matvec(v,m.layers[k],m.biases[k],last?'sigmoid':'relu');
  }
  return Object.fromEntries(m.output_names.map((name,i)=>[name,v[i]]));
}
