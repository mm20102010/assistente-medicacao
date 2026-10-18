/* MM Registro: preferência de aparência puramente visual e independente por app. */
(()=>{
'use strict';
const app=document.currentScript?.dataset.mmApp||'starter';
const key=`mm.appearance.${app}`,root=document.documentElement;
const values=['light','dark','auto'];
const labels={
 'pt-BR':{title:'Aparência',light:'Claro',dark:'Escuro',auto:'Automático',desc:'Usar a aparência do dispositivo',close:'Fechar'},
 'en-US':{title:'Appearance',light:'Light',dark:'Dark',auto:'Automatic',desc:'Match device appearance',close:'Close'},
 'es-ES':{title:'Aspecto',light:'Claro',dark:'Oscuro',auto:'Automático',desc:'Usar el aspecto del dispositivo',close:'Cerrar'}
};
const media=window.matchMedia?.('(prefers-color-scheme: dark)');
let choice='dark'; // mantém o padrão anterior até o usuário alterar.
try{const stored=localStorage.getItem(key);if(values.includes(stored))choice=stored;}catch{}
const actual=()=>choice==='auto'?(media?.matches?'dark':'light'):choice;
const lang=()=>{const name=window.MMI18n?.locale||root.lang||navigator.language||'pt-BR';return name.startsWith('es')?'es-ES':name.startsWith('en')?'en-US':'pt-BR';};
function paint(){
 const theme=actual();root.dataset.theme=theme;root.style.colorScheme=theme;
 const meta=document.querySelector('meta[name="theme-color"]');
 if(meta){const color=theme==='light'?'#fff6e8':'#07111c';if(meta.content!==color){meta.content=color;if(meta.isConnected)meta.replaceWith(meta.cloneNode(false));}}
}
function refresh(){
 paint();const words=labels[lang()];
 document.querySelectorAll('[data-mm-appearance-title]').forEach(e=>{e.textContent=words.title;});
 document.querySelectorAll('[data-mm-appearance-current]').forEach(e=>{e.textContent=words[choice];});
 for(const [attr,key] of [['data-mm-appearance-description','desc'],['data-mm-appearance-close','close']]){document.querySelectorAll(`[${attr}]`).forEach(e=>{e.textContent=words[key];});}
 document.querySelectorAll('[data-mm-appearance-option]').forEach(e=>{
  const value=e.dataset.mmAppearanceOption,selected=value===choice;
  const name=e.querySelector('[data-mm-appearance-option-label]');if(name)name.textContent=words[value];
  e.classList.toggle('is-active',selected);e.setAttribute('aria-pressed',String(selected));
  const mark=e.querySelector('[data-mm-appearance-check]');if(mark)mark.textContent=selected?'✓':'';
 });
}
paint(); // antes do CSS e da primeira pintura, tal como em Viagem.
function init(){
 const trigger=document.getElementById('appearanceBtn'),dialog=document.getElementById('appearanceDialog');
 if(!trigger||!dialog)return;
 trigger.addEventListener('click',()=>{refresh();if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');});
 dialog.querySelectorAll('[data-mm-appearance-option]').forEach(button=>button.addEventListener('click',()=>{
  choice=button.dataset.mmAppearanceOption;
  try{localStorage.setItem(key,choice);}catch{}
  refresh();if(dialog.close)dialog.close();else dialog.removeAttribute('open');
 }));
 document.addEventListener('mm:localechange',refresh);
 refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
function restore(){try{const v=localStorage.getItem(key);if(values.includes(v))choice=v;}catch{}refresh();}
window.addEventListener('pageshow',restore);
window.addEventListener('storage',event=>{if(event.key===key)restore();});
media?.addEventListener?.('change',()=>{if(choice==='auto')refresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)restore();});
})();
