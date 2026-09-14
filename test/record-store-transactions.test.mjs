import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { IDBFactory, IDBObjectStore } from './vendor/fake-indexeddb/index.js';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const row = id => ({id, medicine:'A',date:'2026-09-12',time:'12:00',relief:'Não definido',createdAt:'2026-09-12T12:00:00Z',updatedAt:'2026-09-12T12:00:00Z',rawDate:''});
function context(indexedDB) {
  const window = { MMNative:{isIOS:false} };
  const ctx = vm.createContext({window,document:{addEventListener(){}},indexedDB,console,structuredClone,Date,Intl,queueMicrotask,setTimeout,clearTimeout,localStorage:{getItem:()=>null}});
  vm.runInContext(source,ctx);
  vm.runInContext('updateStatus=()=>{};',ctx);
  return ctx;
}
const run = (ctx, script) => vm.runInContext(script,ctx);
async function legacy(factory, count=10001) {
  const db = await new Promise((resolve,reject)=>{
    const r=factory.open('assistente_medicacao',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('app_state');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('app_state','readwrite');
    tx.objectStore('app_state').put({version:1,records:Array.from({length:count},(_,i)=>row(`id-${i}`)),medicines:['A']},'main');
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });db.close();
}

test('migração atômica preserva 10.001 registros e CRUD incremental após reabrir',async()=>{
  const factory=new IDBFactory();await legacy(factory);
  const ctx=context(factory);await run(ctx,'openDatabase().then(value=>{db=value;return loadState()})');
  assert.equal((await run(ctx,'dbGet(STATE_KEY)')).records.length,10001);
  run(ctx,'db.close()');
  const reopened=context(factory);await run(reopened,'openDatabase().then(value=>{db=value;return loadState()})');
  let writes=0,deletes=0;
  const put=IDBObjectStore.prototype.put,del=IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.put=function(...args){if(this.name==='records')writes++;return put.apply(this,args)};
  IDBObjectStore.prototype.delete=function(...args){if(this.name==='records')deletes++;return del.apply(this,args)};
  try {
    reopened.row=row('added');await run(reopened,"state.records.push(row);saveState()");
    assert.equal(writes,1);assert.equal(deletes,0);
    await run(reopened,"state.records.find(r=>r.id==='added').relief='1 hour';saveState()");
    assert.equal((await run(reopened,'dbGet(STATE_KEY)')).records.find(r=>r.id==='added').relief,'1 hora');
    assert.equal(writes,2);
    await run(reopened,"state.records=state.records.filter(r=>r.id!=='added');saveState()");
    assert.equal(deletes,1);
    await run(reopened,"state.medicines.push('B');saveState()");assert.equal(writes,2);
    assert.equal((await run(reopened,'dbGet(STATE_KEY)')).records.length,10001);
    assert.equal((await run(reopened,'persistedRecordIDSet()')).size,10001);
    await run(reopened,"state.records=[];saveState()");
    assert.equal((await run(reopened,'dbGet(STATE_KEY)')).records.length,0);
    reopened.row=row('restore');await run(reopened,'state.records=[row];saveState()');
    assert.equal((await run(reopened,'dbGet(STATE_KEY)')).records[0].id,'restore');
  } finally { IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.delete=del;run(reopened,'db.close()'); }
});

test('aborto durante migração preserva blob legado e reinício permite nova tentativa',async()=>{
  const factory=new IDBFactory();await legacy(factory,250);
  const ctx=context(factory);await run(ctx,'openDatabase().then(value=>{db=value})');
  const put=IDBObjectStore.prototype.put;let count=0;
  IDBObjectStore.prototype.put=function(...args){if(this.name==='records' && ++count===12){this.transaction.abort();throw new Error('quota simulada')}return put.apply(this,args)};
  try {await assert.rejects(run(ctx,'loadState()'),/quota/)} finally {IDBObjectStore.prototype.put=put}
  const before=await run(ctx,'dbGet(STATE_KEY)');assert.equal(before.recordStorageVersion,undefined);assert.equal(before.records.length,250);
  run(ctx,'db.close()');
  const retry=context(factory);await run(retry,'openDatabase().then(value=>{db=value;return loadState()})');
  const after=await run(retry,'dbGet(STATE_KEY)');assert.equal(after.recordStorageVersion,2);assert.equal(after.records.length,250);run(retry,'db.close()');
});

test('falha de gravação não confirma Watch; retry persiste antes do ACK; duplicata não duplica',async()=>{
  const ctx=context(new IDBFactory());await run(ctx,'openDatabase().then(value=>{db=value;return loadState()})');
  let ack=0;
  ctx.window.MMNative={isIOS:true,getWatchMedicationEvents:async()=>[{id:'watch-one',medicine:'A',occurredAt:'2026-09-12T12:00:00.123Z'}],acknowledgeWatchMedicationEvent:async()=>{assert.equal((await run(ctx,'persistedRecordIDSet()')).has('watch-one'),true);ack++;return {acknowledged:true}}};
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){if(this.name==='records'){this.transaction.abort();throw new Error('quota simulada')}return put.apply(this,args)};
  try {await run(ctx,'syncWatchMedicationEventsFromNative({render:false})')} finally {IDBObjectStore.prototype.put=put}
  assert.equal(ack,0);assert.equal((await run(ctx,'dbGet(STATE_KEY)')).records.length,0);
  await run(ctx,'syncWatchMedicationEventsFromNative({render:false})');assert.equal(ack,1);
  assert.ok((await run(ctx,'dbGet(STATE_KEY)')).medicines.includes('A'));
  await run(ctx,'syncWatchMedicationEventsFromNative({render:false})');assert.equal((await run(ctx,'dbGet(STATE_KEY)')).records.length,1);
  run(ctx,'db.close()');
});
