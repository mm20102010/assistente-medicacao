import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const native = readFileSync(new URL('../ios/App/App/WatchSessionManager.swift', import.meta.url), 'utf8');
const start = '2026-10-13T02:30:00.000Z'; // 12/10 23h30, São Paulo
const end = '2026-10-15T02:30:00.000Z';   // 14/10 23h30, fim exclusivo
const doses = [
  '2026-10-13T02:30:00.000Z',
  '2026-10-13T10:30:00.000Z',
  '2026-10-13T18:30:00.000Z',
  '2026-10-14T02:30:00.000Z',
  '2026-10-14T10:30:00.000Z',
  '2026-10-14T18:30:00.000Z'
];
function setup(now, { consumed = [], enabled = true } = {}) {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const requests = [];
  const window = {
    MMI18n: null,
    MMNative: { isIOS: true, async reconcileMedicationNotifications(items, on) {
      requests.push({ items, on });
      return {accepted:true, requested:items.length, scheduled:items.length, preserved:0, failed:0};
    } }
  };
  const document = {addEventListener(){}, getElementById(){return null}, visibilityState:'visible'};
  const ctx = vm.createContext({window, document, console, Date:Clock, Intl, Math, Set, Map, JSON, Promise, structuredClone, crypto:{randomUUID:()=> 'id'}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask});
  vm.runInContext(source, ctx);
  ctx.__data = {
    records: consumed.map((at, i)=>({ id:`r${i}`, scheduleId:'kaloba', scheduledAt:at, medicine:'Kaloba', date:'2026-10-14',time:'15:33' })),
    medicines:['Kaloba'],
    schedules:[{id:'kaloba',status:'active',createdAt:start,updatedAt:start,revisions:[{
      id:'rev1',medicine:'Kaloba',intervalMinutes:480,planStartAt:start,effectiveFrom:start,endAt:end
    }]}],
    remindersEnabled:enabled
  };
  vm.runInContext('state = __data', ctx);
  return {ctx,requests};
}

test('cenário Kaloba 48h: seis doses exibidas correspondem a seis solicitações nativas distintas', async () => {
  const {ctx,requests}=setup('2026-10-13T00:00:00.000Z');
  assert.equal(vm.runInContext('scheduleProgress(state.schedules[0]).planned',ctx),6);
  await vm.runInContext('reconcileMedicationNotifications()',ctx);
  assert.equal(requests.length,1);
  assert.equal(requests[0].on,true);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].items.map(x=>x.at))),doses);
  assert.equal(new Set(requests[0].items.map(x=>x.id)).size,6);
  assert.deepEqual(requests[0].items.map(x=>x.id),requests[0].items.map(x=>`medsched.kaloba.${new Date(x.at).getTime()}`));
});

test('última das seis doses não desaparece durante reconciliação próxima do horário', async () => {
  const {ctx,requests}=setup('2026-10-14T18:20:00.000Z',{consumed:doses.slice(0,5)});
  assert.equal(vm.runInContext('scheduleProgress(state.schedules[0]).taken',ctx),5);
  await vm.runInContext('reconcileMedicationNotifications()',ctx);
  assert.deepEqual(requests[0].items.map(x=>x.at),[doses[5]]);
  assert.equal(requests[0].items[0].scheduledAt,doses[5]);
});

test('nenhuma dose já confirmada deve ser reagendada; lembretes desativados geram lista vazia', async () => {
  const {ctx,requests}=setup('2026-10-13T00:00:00.000Z',{consumed:[doses[0],doses[3]]});
  await vm.runInContext('reconcileMedicationNotifications()',ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].items.map(x=>x.at))),doses.filter((_,i)=>![0,3].includes(i)));
  vm.runInContext('state.remindersEnabled = false',ctx);
  await vm.runInContext('reconcileMedicationNotifications()',ctx);
  assert.equal(requests[1].items.length,0);
  assert.equal(requests[1].on,false);
});

test('endAt exclusivo não introduz dose adicional; hora final é distinta da última dose', () => {
  const {ctx}=setup('2026-10-13T00:00:00.000Z');
  const result=vm.runInContext('scheduleOccurrences(state.schedules[0]).map(o=>o.at.toISOString())',ctx);
  assert.equal(result.length,6);
  assert.equal(result.at(-1),doses[5]);
  assert.ok(!result.includes(end));
});

test('nativo mantém pendências idênticas, substitui apenas alteradas e remove somente obsoletas', () => {
  const section=native.slice(native.indexOf('    @objc func reconcileMedicationNotifications('),native.indexOf('\n}\n\n// Registers the local plugin'));
  assert.match(section,/let obsolete = owned\.map\(\\\.identifier\)\.filter \{ !desiredIDs\.contains\(\$0\) \}/);
  assert.match(section,/if !obsolete\.isEmpty \{ center\.removePendingNotificationRequests\(withIdentifiers: obsolete\) \}/);
  assert.match(section,/preserved \+= 1/);
  assert.match(section,/center\.add\(request\)/);
  assert.match(section,/"scheduled": preserved \+ added/);
  assert.match(section,/"accepted": failed == 0/);
  assert.match(section,/guard granted, error == nil else/);
  assert.ok(section.indexOf('guard granted, error == nil else')<section.indexOf('let obsolete ='));
});

test('reconciliações concorrentes são serializadas e a última usa o estado mais recente', async () => {
  const {ctx,requests}=setup('2026-10-13T00:00:00.000Z');
  let unblock;
  ctx.window.MMNative.reconcileMedicationNotifications = (items,on) => {
    requests.push({items,on});
    if(requests.length===1) return new Promise(resolve=>{unblock=()=>resolve({accepted:true,scheduled:items.length})});
    return Promise.resolve({accepted:true,scheduled:items.length});
  };
  const a=vm.runInContext('reconcileMedicationNotifications()',ctx);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests.length,1);
  const b=vm.runInContext('reconcileMedicationNotifications()',ctx);
  vm.runInContext('state.remindersEnabled = false',ctx);
  assert.equal(requests.length,1,'segunda operação não pode cancelar antes da primeira terminar');
  unblock();
  await Promise.all([a,b]);
  assert.equal(requests.length,2);
  assert.equal(requests[0].items.length,6);
  assert.equal(requests[1].items.length,0);
  assert.equal(requests[1].on,false);
});
