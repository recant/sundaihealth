const tabs=[...document.querySelectorAll('[data-tab]')];
const panels=[...document.querySelectorAll('[data-tab-panel]')];

function activate(name,{updateHash=true}={}){
  const valid=panels.some(p=>p.dataset.tabPanel===name)?name:'live';
  for(const tab of tabs){
    const active=tab.dataset.tab===valid;
    tab.classList.toggle('active',active);
    tab.setAttribute('aria-selected',active?'true':'false');
  }
  for(const panel of panels)panel.classList.toggle('active',panel.dataset.tabPanel===valid);
  if(updateHash)history.replaceState({},'',`#${valid}`);
  window.dispatchEvent(new CustomEvent('pulselab:tab',{detail:{tab:valid}}));
  window.scrollTo({top:0,behavior:'smooth'});
}

for(const tab of tabs)tab.addEventListener('click',()=>activate(tab.dataset.tab));
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-go-tab]');
  if(button)activate(button.dataset.goTab);
});

const initial=location.hash.replace('#','');
activate(initial||'live',{updateHash:false});
window.addEventListener('hashchange',()=>activate(location.hash.replace('#','')||'live',{updateHash:false}));
