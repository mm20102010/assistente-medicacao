import fs from 'node:fs';
import assert from 'node:assert/strict';

const css=fs.readFileSync(new URL('../public/mm-registro.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const core266=css.slice(css.indexOf('/* MM Registro 2.66 — top-level secondary headers'));

assert.match(html,/data-mm-view-panel="tools"[\s\S]*?<header class="mm-secondary-header">/,'Diário deve manter a estrutura direta oficial de Ferramentas');
assert.match(core266,/body\.mm-registro \[data-mm-view-panel\] > \.mm-secondary-header,[\s\S]*?body\.mm-registro \[data-mm-view-panel\] > \.mm-view-content > \.mm-secondary-header\{[\s\S]*?width:min\(var\(--mm-content-max\),calc\(100vw - 2 \* var\(--mm-space-4\)\)\) !important;[\s\S]*?margin-left:50% !important;[\s\S]*?transform:translateX\(-50%\);[\s\S]*?background:none !important;[\s\S]*?isolation:isolate;/,'Ferramentas deve alinhar sua geometria ao Histórico nas duas estruturas suportadas');
assert.match(core266,/body\.mm-registro \[data-mm-view-panel\] > \.mm-secondary-header::before,[\s\S]*?body\.mm-registro \[data-mm-view-panel\] > \.mm-view-content > \.mm-secondary-header::before\{[\s\S]*?width:100vw;[\s\S]*?background-image:var\(--mm-app-background\);[\s\S]*?background-size:100vw 100dvh;[\s\S]*?background-position:center top;/,'Ferramentas deve usar o mesmo canvas de viewport do Histórico');
const headerBlock=core266.match(/body\.mm-registro \[data-mm-view-panel\] > \.mm-secondary-header,[\s\S]*?body\.mm-registro \[data-mm-view-panel\] > \.mm-view-content > \.mm-secondary-header\{([^}]*)\}/)?.[1] || '';
assert.doesNotMatch(headerBlock,/background-attachment:fixed/,'Ferramentas não pode voltar ao background fixed que cria o retângulo no WKWebView');
assert.doesNotMatch(headerBlock,/background-image:var\(--mm-app-background\)/,'Ferramentas não pode voltar a pintar um gradiente próprio');

for(const viewportWidth of [320,390,430,560,900,1200]){
  const canonicalWidth=Math.min(720,viewportWidth-32);
  const historyLeft=(viewportWidth-canonicalWidth)/2;
  const toolsLeft=(viewportWidth-canonicalWidth)/2;
  assert.equal(toolsLeft,historyLeft,`Ferramentas deve alinhar o botão Voltar ao Histórico em ${viewportWidth}px`);
}
