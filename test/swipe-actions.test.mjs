import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const prefix = fs.existsSync(path.join(root, 'public/mm-registro.js')) ? 'public/' : '';
const code = fs.readFileSync(path.join(root, `${prefix}mm-registro.js`), 'utf8');
const window = {};
vm.runInNewContext(code, { window, globalThis:window });
const { wrapSwipeRow, bindSwipeActions } = window.MMRegistro;

class Node {
  constructor(tag='div', attrs={}) {
    this.tag=tag;this.parent=null;this.dataset={...attrs};this.children=[];this.events={};
    this.style={ props:{},setProperty:(name,val)=>{this.style.props[name]=val;} };
    const set=new Set();this.classList={add:name=>set.add(name),remove:name=>set.delete(name),contains:name=>set.has(name)};
    this.attrs={}; this.tabIndex=0;
  }
  append(child){child.parent=this;this.children.push(child);return child;}
  closest(selector){
    for(let cur=this;cur;cur=cur.parent) {
      if(selector==='[data-mm-swipe-id]' && cur.dataset.mmSwipeId!==undefined)return cur;
      if(selector==='[data-mm-swipe-action]' && cur.dataset.mmSwipeAction!==undefined)return cur;
      if(selector==='button,input,select,textarea,a' && ['button','input','select','textarea','a'].includes(cur.tag))return cur;
    }
    return null;
  }
  querySelectorAll(selector) { return selector==='[data-mm-swipe-action]'?this.children.filter(c=>c.dataset.mmSwipeAction):[]; }
  querySelector(selector){return selector==='.mm-swipe-content > button'?this.rowButton:null;}
  addEventListener(type,handler,opts){(this.events[type]??=[]).push({handler,opts});}
  contains(node){for(let c=node;c;c=c.parent)if(c===this)return true;return false;}
  setAttribute(k,v){this.attrs[k]=v;}
  fire(type,target,extra={}){
    const event={type,target,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const {handler} of this.events[type]||[]){handler(event);if(event.stopped)break;}
    return event;
  }
}
function setup() {
  const list=new Node();const item=list.append(new Node('div',{mmSwipeId:'r1'}));
  const edit=item.append(new Node('button',{mmSwipeAction:'edit'}));
  const remove=item.append(new Node('button',{mmSwipeAction:'delete'}));
  const content=item.append(new Node());const row=content.append(new Node('div'));
  const innerAction=row.append(new Node('button')); // Diário: ação já existente.
  item.rowButton=null;
  const calls=[];
  const ctrl=bindSwipeActions(list,{onEdit:id=>calls.push(['edit',id]),onDelete:id=>calls.push(['delete',id])});
  const start=(x,y=100,target=row)=>list.fire('touchstart',target,{touches:[{clientX:x,clientY:y}]});
  const move=(x,y=100,target=row)=>list.fire('touchmove',target,{touches:[{clientX:x,clientY:y}]});
  const end=(x,y=100,target=row)=>list.fire('touchend',target,{changedTouches:[{clientX:x,clientY:y}]});
  return {list,item,edit,remove,row,innerAction,calls,ctrl,start,move,end};
}

test('mark-up mantém rótulos escapados, iconografia, acessibilidade e conteúdo original',()=>{
  const markup=wrapSwipeRow('<article class="record">OK</article>',{id:'a"b',editLabel:'Edit <now>',deleteLabel:'Delete & remove'});
  assert.match(markup,/data-mm-swipe-id="a&quot;b"/);
  assert.match(markup,/>Edit &lt;now&gt;</);
  assert.match(markup,/>Delete &amp; remove</);
  assert.match(markup,/aria-hidden="true" tabindex="-1"/);
  assert.match(markup,/mm-registro-icons.svg#edit/);
  assert.match(markup,/mm-registro-icons.svg#trash/);
  assert.match(markup,/<article class="record">OK<\/article>/);
});
test('swipe esquerdo somente revela Excluir; click do botão dispara callback',()=>{
  const a=setup();a.start(150);a.move(50);a.end(50);
  assert.equal(a.item.dataset.mmSwipeOpen,'delete');assert.deepEqual(a.calls,[]);
  assert.equal(a.remove.tabIndex,0);assert.equal(a.edit.tabIndex,-1);
  a.list.fire('click',a.remove);assert.deepEqual(a.calls,[['delete','r1']]);
  assert.equal(a.item.dataset.mmSwipeOpen,'');
});
test('swipe direito somente revela Editar',()=>{
  const a=setup();a.start(90);a.move(165);a.end(165);
  assert.equal(a.item.dataset.mmSwipeOpen,'edit');assert.deepEqual(a.calls,[]);
  a.list.fire('click',a.edit);assert.deepEqual(a.calls,[['edit','r1']]);
});
test('rolagem vertical não ativa swipe nem bloqueia scroll',()=>{
  const a=setup();a.start(120,100);const e=a.move(125,155);a.end(125,155);
  assert.equal(e.prevented,false);assert.equal(a.item.dataset.mmSwipeOpen,undefined);
});
test('gesto na borda esquerda respeita voltar do iOS',()=>{
  const a=setup();a.start(12);a.move(100);a.end(100);
  assert.equal(a.item.dataset.mmSwipeOpen,undefined);
});
test('gesto cancelado não abre ação',()=>{
  const a=setup();a.start(150);a.move(55);a.list.fire('touchcancel',a.row);
  assert.equal(a.item.dataset.mmSwipeOpen,'');assert.equal(a.item.classList.contains('mm-swipe-dragging'),false);
});
test('tap após swipe é suprimido, não abre editor legado',()=>{
  const a=setup();a.start(150);a.move(55);a.end(55);
  assert.equal(a.list.fire('click',a.row).stopped,true);
  assert.equal(a.item.dataset.mmSwipeOpen,'');
  assert.deepEqual(a.calls,[]);
});
test('toque em botão interno não inicia gesto; preserva ação rápida',()=>{
  const a=setup();a.start(140,100,a.innerAction);a.move(30,100,a.innerAction);a.end(30,100,a.innerAction);
  assert.equal(a.item.dataset.mmSwipeOpen,undefined);
});
test('reset fecha ação antiga sem adicionar novos listeners',()=>{
  const a=setup();const counts=Object.fromEntries(Object.entries(a.list.events).map(([k,v])=>[k,v.length]));
  a.start(100);a.move(180);a.end(180);
  bindSwipeActions(a.list,{onEdit:id=>a.calls.push(['new',id]),onDelete:id=>a.calls.push(['newDelete',id])});
  assert.equal(a.item.dataset.mmSwipeOpen,'');
  assert.deepEqual(Object.fromEntries(Object.entries(a.list.events).map(([k,v])=>[k,v.length])),counts);
  a.start(100);a.move(180);a.end(180);a.list.fire('click',a.edit);
  assert.deepEqual(a.calls,[['new','r1']]);
});
test('confirmação, offline e sincronização permanecem responsabilidade das rotinas originais',()=>{
  const jsFile=path.join(root,`${prefix}app.js`);
  if(!fs.existsSync(jsFile))return; // Starter é agnóstico de domínio.
  const src=fs.readFileSync(jsFile,'utf8');
  assert.match(src,/async function deleteRecordSelected\(record\)/);
  assert.match(src,/const ok = await confirmAction\(tr\('confirm.deleteRecord'\)/);
  assert.match(src,/discardWatchMedicationEvent\(record.id\)/);
  assert.match(src,/saveState\(\{ reason:'delete-record' \}\)/);
  if(root.includes('assistente')){
    assert.match(src,/async function deleteScheduleSelected\(schedule\)/);
    assert.match(src,/const ok=confirm\(tr\('assistant.deleteConfirm'\)\)/);
    assert.match(src,/await reconcileMedicationNotifications\(\)/);
    assert.match(src,/bindSwipeActions\(els.schedulesList/);
  }
});
test('rótulos do Core traduzidos em todos os idiomas sem depender do domínio',()=>{
  const common=fs.readFileSync(path.join(root,`${prefix}mm-registro-i18n.js`),'utf8');
  for(const [locale,edit,remove] of [['pt-BR','Editar','Excluir'],['en-US','Edit','Delete'],['es-ES','Editar','Eliminar']]) {
    assert.ok(common.includes(`'common.edit':'${edit}'`),`common.edit ${locale}`);
    assert.ok(common.includes(`'common.delete':'${remove}'`),`common.delete ${locale}`);
  }
  const app=path.join(root,`${prefix}app.js`);
  if(fs.existsSync(app)) {
    const src=fs.readFileSync(app,'utf8');
    assert.match(src,/editLabel:tr\('common.edit'\), deleteLabel:tr\('common.delete'\)/);
  }
});
