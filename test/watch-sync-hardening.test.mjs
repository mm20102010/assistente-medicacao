import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`\nfunction ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `função ${name} não encontrada`);
  return source.slice(start, end);
}

test('escritas do estado são serializadas e um snapshot antigo não pode vencer um mais novo', async () => {
  const app = await read('public/app.js');
  const saveStateSource = functionBlock(app, 'saveState', 'cacheElements');
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const persisted = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let writeCount = 0;

  const ctx = {
    Promise, JSON, structuredClone, console,
    STATE_KEY: 'main',
    state: null,
    dbPut: async (_key, snapshot) => {
      writeCount += 1;
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      if (writeCount === 1) await firstGate;
      persisted.push(structuredClone(snapshot));
      activeWrites -= 1;
    },
    normalizeStateForSave: value => structuredClone(value),
    updateStatus: () => {},
    syncMedicinesToNative: () => {},
    diagnosticTrace: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`
    let state = {version:1, records:[{id:'watch'}], medicines:['A']};
    let stateWriteTail = Promise.resolve();
    let stateWriteRevision = 0;
    let lastPersistedStateRevision = 0;
    ${saveStateSource}
  `, ctx);

  const first = vm.runInContext(`saveState({reason:'watch'})`, ctx);
  await Promise.resolve();
  vm.runInContext(`state.records.push({id:'iphone'});`, ctx);
  const second = vm.runInContext(`saveState({reason:'iphone'})`, ctx);
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(maxActiveWrites, 1, 'IndexedDB nunca deve receber duas gravações concorrentes do estado inteiro');
  assert.deepEqual(persisted.at(-1).records.map(r => r.id), ['watch','iphone']);
});

test('ACK do Watch só é final depois de persistência no IndexedDB', async () => {
  const [app, ios, watch] = await Promise.all([
    read('public/app.js'),
    read('ios/App/App/WatchSessionManager.swift'),
    read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift')
  ]);

  assert.match(app, /await saveState\(\{ reason:'watch-drain' \}\);[\s\S]*?persistedIDs = await persistedRecordIDSet\(\)[\s\S]*?persistedRecordIDsContain\(addedIds, persistedIDs\)/);
  assert.match(app, /if \(!persistedIDs\) persistedIDs = await persistedRecordIDSet\(\);[\s\S]*?persistedIDs\.has\(id\)[\s\S]*?acknowledgeWatchMedicationEvent\(id\)/);
  assert.match(ios, /private func savePendingEvents\(_ events: \[MedicationEvent\]\) -> Bool[\s\S]*?decoded == events/);
  assert.match(ios, /acknowledgeMedicationEvent[\s\S]*?storedAcknowledged\.contains\(id\)[\s\S]*?savePendingEvents\(pending\)/);
  assert.match(ios, /sendPersistedAcknowledgementToWatch\(id: id\)/);
  assert.match(watch, /if accepted && persisted[\s\S]*?removePendingEvent/);

  const finishStart = watch.indexOf('didFinish userInfoTransfer');
  assert.ok(finishStart >= 0);
  const finishBody = watch.slice(finishStart, watch.indexOf('\n    }\n}', finishStart));
  assert.doesNotMatch(finishBody, /removePendingEvent/, 'fim do transferUserInfo não é confirmação de persistência no Diário');
  assert.match(finishBody, /queued/);
});

test('reset/cutoff impede evento Watch antigo de reaparecer após limpeza ou substituição', async () => {
  const [app, runtime, ios, watch] = await Promise.all([
    read('public/app.js'), read('public/native-runtime.js'),
    read('ios/App/App/WatchSessionManager.swift'), read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift')
  ]);
  assert.match(app, /CLEAR_ALL_BEGIN[\s\S]*?resetWatchSynchronizationState\(resetAt\)[\s\S]*?reason:'clear-all'/);
  assert.match(app, /IMPORT_REPLACE_BEGIN[\s\S]*?resetWatchSynchronizationState\(resetAt\)[\s\S]*?reason:'import-replace'/);
  assert.match(runtime, /async function resetWatchSynchronizationState/);
  assert.match(ios, /synchronizationResetAtKey/);
  assert.match(ios, /isAtOrBeforeSynchronizationReset\(event\)[\s\S]*?return \(true, true, false, true\)/);
  assert.match(watch, /applySynchronizationResetIfNewer/);
  assert.match(watch, /occurred > incoming/);
});

test('relaunch do Watch reconstrói transfers em background para evitar tempestade de duplicatas', async () => {
  const watch = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  assert.match(watch, /rebuildBackgroundTransferIDs\(from session: WCSession\)/);
  assert.match(watch, /session\.outstandingUserInfoTransfers/);
  assert.match(watch, /activationDidComplete[\s\S]*?rebuildBackgroundTransferIDs[\s\S]*?flushPendingEvents/);
  assert.match(watch, /sessionReachabilityDidChange[\s\S]*?rebuildBackgroundTransferIDs[\s\S]*?flushPendingEvents/);
});


test('lista e idioma iPhone -> Watch são serializados e estado nativo é protegido contra data race', async () => {
  const [app, ios] = await Promise.all([
    read('public/app.js'), read('ios/App/App/WatchSessionManager.swift')
  ]);
  assert.match(app, /let nativeMedicineSyncTail = Promise\.resolve\(\)/);
  assert.match(app, /const execution = nativeMedicineSyncTail\.then\(run, run\)/);
  assert.match(app, /nativeMedicineSyncTail = execution\.catch\(\(\) => \{\}\)/);
  assert.match(ios, /stateQueue = DispatchQueue\(label: "br\.com\.mmregistro\.assistentemedicacao\.watch-state"\)/);
  assert.match(ios, /stateQueue\.sync \{[\s\S]*?latestMedicines = normalizedMedicines[\s\S]*?latestLocale = normalizedLocale[\s\S]*?latestTexts = normalizedTexts/);
  assert.match(ios, /let snapshot = stateQueue\.sync/);
});

test('Watch impede sendMessage simultâneo duplicado para o mesmo UUID', async () => {
  const watch = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  assert.match(watch, /private var immediateTransferIDs = Set<String>\(\)/);
  assert.match(watch, /guard immediateTransferIDs\.insert\(event\.id\)\.inserted else/);
  assert.match(watch, /replyHandler:[\s\S]*?immediateTransferIDs\.remove\(event\.id\)/);
  assert.match(watch, /errorHandler:[\s\S]*?immediateTransferIDs\.remove\(event\.id\)/);
  assert.match(watch, /private static let immediateSendFallbackSeconds: TimeInterval = 1\.5/);
  assert.match(watch, /scheduleImmediateSendFallback\(event\)[\s\S]*?session\.sendMessage/);
  assert.match(watch, /scheduleImmediateSendFallback[\s\S]*?Task\.sleep[\s\S]*?Self\.immediateSendFallbackSeconds[\s\S]*?immediateTransferIDs\.contains\(event\.id\)[\s\S]*?loadPendingEvents\(\)\.contains[\s\S]*?queueBackgroundDelivery/,
    'sendMessage sem callback deve cair para transferUserInfo e deixar de exibir Enviando');
  assert.match(watch, /replyHandler:[\s\S]*?guard self\.loadPendingEvents\(\)\.contains\(where: \{ \$0\.id == event\.id \}\) else/);
  assert.match(watch, /errorHandler:[\s\S]*?guard self\.loadPendingEvents\(\)\.contains\(where: \{ \$0\.id == event\.id \}\) else/);
});

test('exclusão individual consome UUID Watch conhecido antes de remover o IndexedDB', async () => {
  const [app, runtime, ios] = await Promise.all([
    read('public/app.js'), read('public/native-runtime.js'), read('ios/App/App/WatchSessionManager.swift')
  ]);
  assert.match(app, /deleteCurrentRecord[\s\S]*?discardWatchMedicationEvent\(record\.id\)[\s\S]*?state\.records = state\.records\.filter/);
  assert.match(runtime, /async function discardWatchMedicationEvent/);
  assert.match(ios, /func discardMedicationEventIfKnown/);
  assert.match(ios, /guard known else \{ return true \}[\s\S]*?acknowledgeMedicationEvent\(id: id\)/);
});

test('stress: 1.000 mutações persistem em fila única sem lost update', async () => {
  const app = await read('public/app.js');
  const saveStateSource = functionBlock(app, 'saveState', 'cacheElements');
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let finalSnapshot = null;
  const ctx = {
    Promise, JSON, structuredClone, console, STATE_KEY:'main',
    dbPut: async (_key, snapshot) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await Promise.resolve();
      finalSnapshot = structuredClone(snapshot);
      activeWrites -= 1;
    },
    normalizeStateForSave: value => structuredClone(value),
    updateStatus: () => {}, syncMedicinesToNative: () => {}, diagnosticTrace: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`
    let state = {version:1, records:[], medicines:['A']};
    let stateWriteTail = Promise.resolve();
    let stateWriteRevision = 0;
    let lastPersistedStateRevision = 0;
    ${saveStateSource}
  `, ctx);

  const saves = [];
  for (let i=0;i<1000;i++) {
    vm.runInContext(`state.records.push({id:'r${i}'});`, ctx);
    saves.push(vm.runInContext(`saveState({reason:'stress-${i}'})`, ctx));
  }
  await Promise.all(saves);
  assert.equal(maxActiveWrites, 1);
  assert.equal(finalSnapshot.records.length, 1000);
  assert.equal(finalSnapshot.records.at(-1).id, 'r999');
});

test('stress: lista iPhone -> Watch preserva ordem e nunca executa duas bridges ao mesmo tempo', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('function syncMedicinesToNative');
  const end = app.indexOf('\nfunction watchMedicationEventToRecord', start);
  assert.ok(start >= 0 && end > start);
  const fn = app.slice(start, end);
  let active = 0;
  let maxActive = 0;
  const order = [];
  const ctx = {
    Promise, JSON, console,
    I18N:{locale:'pt-BR'},
    uniqueMedicines:value=>[...value],
    watchTextsForNative:()=>({title:'Diário'}),
    diagnosticTrace:()=>{},
    window:{MMNative:{isIOS:true, syncMedicines:async medicines=>{
      active += 1; maxActive = Math.max(maxActive, active);
      order.push(medicines[0]);
      await Promise.resolve();
      active -= 1;
      return {accepted:true, delivered:true};
    }}},
  };
  vm.createContext(ctx);
  vm.runInContext(`
    let state={medicines:['A']};
    let lastNativeMedicinesSignature=null;
    let nativeMedicineSyncTail=Promise.resolve();
    ${fn}
  `,ctx);
  const promises=[];
  for (const medicine of ['A','B','C','D','E']) {
    vm.runInContext(`state.medicines=['${medicine}'];`,ctx);
    promises.push(vm.runInContext(`syncMedicinesToNative({force:true})`,ctx));
  }
  await Promise.all(promises);
  assert.equal(maxActive,1);
  assert.deepEqual(order,['A','B','C','D','E']);
});

test('epoch + revisão impedem snapshot antigo do iPhone de recuperar autoridade no Watch', async () => {
  const [ios, watch] = await Promise.all([
    read('ios/App/App/WatchSessionManager.swift'),
    read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift')
  ]);

  assert.match(ios, /stateSourceIDKey = "mm\.assistente\.watch\.stateSourceID\.v1"/);
  assert.match(ios, /stateRevisionKey = "mm\.assistente\.watch\.stateRevision\.v1"/);
  assert.match(ios, /"stateSourceID": Self\.stateSourceID/);
  assert.match(ios, /"stateRevision": snapshot\.revision/);
  assert.match(ios, /"schemaVersion": 4/);
  assert.match(watch, /lastAppliedStateSourceIDKey = "mm\.assistente\.watch\.lastAppliedStateSourceID\.v1"/);
  assert.match(watch, /retiredStateSourceIDsKey = "mm\.assistente\.watch\.retiredStateSourceIDs\.v1"/);
  assert.match(watch, /if incomingSourceID\.isEmpty, !lastSourceID\.isEmpty \{ return \}/);
  assert.match(watch, /retiredSources\.contains\(incomingSourceID\)/);

  function receive(items) {
    let source = '';
    let revision = 0;
    const retired = new Set();
    const applied = [];
    for (const item of items) {
      if (!item.source && source) continue;
      if (item.source && item.source !== source && retired.has(item.source)) continue;
      const changed = Boolean(item.source) && item.source !== source;
      let gate = changed ? 0 : revision;
      if (item.revision === 0 && gate > 0) continue;
      if (item.revision > 0 && item.revision < gate) continue;
      if (changed) {
        if (source) retired.add(source);
        source = item.source;
        revision = 0;
      }
      if (item.revision > 0) revision = item.revision;
      applied.push(`${item.source}:${item.revision}:${item.medicine}`);
    }
    return { source, revision, applied };
  }

  assert.deepEqual(receive([
    { source:'iphone-A', revision:101, medicine:'A' },
    { source:'iphone-A', revision:100, medicine:'STALE' },
    { source:'iphone-B', revision:1, medicine:'B' },
    { source:'iphone-A', revision:102, medicine:'OLD-EPOCH' },
    { source:'', revision:0, medicine:'LEGACY' }
  ]), {
    source:'iphone-B', revision:1,
    applied:['iphone-A:101:A','iphone-B:1:B']
  });
});

test('reset espera writers iPhone -> Watch em voo antes do cutoff e antes de liberar a UI', async () => {
  const app = await read('public/app.js');
  const replaceStart = app.indexOf("if (mode === \"replace\")");
  const replaceEnd = app.indexOf("} else {", replaceStart);
  const replace = app.slice(replaceStart, replaceEnd);
  assert.match(replace, /watchEventSyncPromise[\s\S]*?stateWriteTail[\s\S]*?nativeMedicineSyncTail[\s\S]*?resetWatchSynchronizationState\(resetAt\)/);
  assert.match(replace, /saveState\(\{ reason:'import-replace' \}\)[\s\S]*?nativeMedicineSyncTail/);

  const clearStart = app.indexOf('async function clearAllData()');
  const clearEnd = app.indexOf('\n\nfunction isEditingControl', clearStart);
  const clear = app.slice(clearStart, clearEnd);
  assert.match(clear, /watchEventSyncPromise[\s\S]*?stateWriteTail[\s\S]*?nativeMedicineSyncTail[\s\S]*?resetWatchSynchronizationState\(resetAt\)/);
  assert.match(clear, /saveState\(\{ reason:'clear-all' \}\)[\s\S]*?nativeMedicineSyncTail[\s\S]*?dataResetInProgress = false/);
});

test('background burst: evento novo durante drain em voo força segunda passagem sem depender de focus', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('async function syncWatchMedicationEventsFromNative');
  const end = app.indexOf('\nfunction bindNativeWatchEventRecovery()', start);
  assert.ok(start >= 0 && end > start, 'syncWatchMedicationEventsFromNative deve existir');
  const block = app.slice(start, end);

  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let getCalls = 0;
  const acked = [];
  const ctx = {
    console, Promise, Set, Math,
    queueMicrotask,
    dataResetInProgress: false,
    watchEventSyncRequested: false,
    watchEventSyncInProgress: false,
    watchEventSyncPromise: null,
    lastNativeWatchPendingCount: 0,
    state: { records: [] },
    cleanField: value => String(value ?? '').trim(),
    diagnosticTrace: () => {},
    watchMedicationEventToRecord: event => ({ id:event.id, medicine:event.medicine, createdAt:event.occurredAt }),
    saveState: async () => {},
    persistedRecordIDSet: async () => new Set(ctx.state.records.map(record => record.id)),
    persistedRecordIDsContain: async (ids, persisted) => ids.every(id => persisted.has(id)),
    renderAll: () => {},
    window: { MMNative: {
      isIOS: true,
      getWatchMedicationEvents: async () => {
        getCalls += 1;
        if (getCalls === 1) {
          await firstGate;
          return [{id:'watch-1', medicine:'A', occurredAt:'2026-08-29T16:00:00Z'}];
        }
        if (getCalls === 2) return [{id:'watch-2', medicine:'B', occurredAt:'2026-08-29T16:00:01Z'}];
        return [];
      },
      acknowledgeWatchMedicationEvent: async id => { acked.push(id); return {acknowledged:true}; },
    }},
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);

  const first = vm.runInContext('syncWatchMedicationEventsFromNative()', ctx);
  await Promise.resolve();
  const coalesced = vm.runInContext('syncWatchMedicationEventsFromNative()', ctx);
  releaseFirst();
  await Promise.all([first, coalesced]);

  for (let i=0; i<50 && acked.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(getCalls >= 2, 'novo evento em voo deve provocar redrain automático');
  assert.deepEqual(acked, ['watch-1','watch-2']);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.records.map(record => record.id))), ['watch-1','watch-2']);
});



test('drain confirma um burst inteiro com um único readback do IndexedDB', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('async function syncWatchMedicationEventsFromNative');
  const end = app.indexOf('\nfunction bindNativeWatchEventRecovery()', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);

  let readbacks = 0;
  const acked = [];
  const ctx = {
    console, Promise, Set, Math, queueMicrotask,
    dataResetInProgress:false,
    watchEventSyncRequested:false,
    watchEventSyncInProgress:false,
    watchEventSyncPromise:null,
    lastNativeWatchPendingCount:0,
    state:{records:[]},
    cleanField:value => String(value ?? '').trim(),
    diagnosticTrace:()=>{},
    watchMedicationEventToRecord:event => ({id:event.id, medicine:event.medicine, createdAt:event.occurredAt}),
    saveState:async()=>{},
    persistedRecordIDSet:async()=>{ readbacks += 1; return new Set(ctx.state.records.map(record => record.id)); },
    persistedRecordIDsContain:async(ids,persisted)=>ids.every(id=>persisted.has(id)),
    renderAll:()=>{},
    window:{MMNative:{
      isIOS:true,
      getWatchMedicationEvents:async()=>[
        {id:'watch-a',medicine:'A',occurredAt:'2026-08-29T16:00:00Z'},
        {id:'watch-b',medicine:'B',occurredAt:'2026-08-29T16:00:01Z'},
        {id:'watch-c',medicine:'C',occurredAt:'2026-08-29T16:00:02Z'}
      ],
      acknowledgeWatchMedicationEvent:async id=>{ acked.push(id); return {acknowledged:true}; }
    }}
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  const result = await vm.runInContext('syncWatchMedicationEventsFromNative()', ctx);
  assert.equal(result.added, 3);
  assert.equal(result.acknowledged, 3);
  assert.equal(readbacks, 1, 'um burst deve reler o IndexedDB uma única vez antes dos ACKs');
  assert.deepEqual(acked, ['watch-a','watch-b','watch-c']);
});

test('estado iPhone→Watch usa snapshot durável + fast path com a mesma revisão', async () => {
  const ios = await read('ios/App/App/WatchSessionManager.swift');
  const watch = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  assert.match(ios, /try session\.updateApplicationContext\(context\)[\s\S]*?session\.isReachable[\s\S]*?liveContext\["type"\] = "watchState"[\s\S]*?session\.sendMessage\(liveContext/);
  assert.match(watch, /case "watchState": self\.apply\(context: message\)/);
  assert.match(watch, /private let maxRetiredStateSourceIDs = 16/);
});

test('ACK × didFinish não regride sucesso para Na fila', async () => {
  const watch = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  assert.match(watch, /didFinish userInfoTransfer:[\s\S]*?guard self\.loadPendingEvents\(\)\.contains\(where: \{ \$0\.id == id \}\) else \{ return \}/);
  const converge = order => {
    let pending = true, label = 'queued';
    for (const step of order) {
      if (step === 'ack') { pending = false; label = 'persisted'; }
      if (step === 'didFinish' && pending) label = 'queued';
    }
    return label;
  };
  assert.equal(converge(['didFinish','ack']), 'persisted');
  assert.equal(converge(['ack','didFinish']), 'persisted');
});

test('fast path Watch tem timeout durável e converge em todos os ordenamentos de ACK/callback', () => {
  const simulate = order => {
    let pending = true;
    let immediate = true;
    let durable = false;
    let label = 'sending';
    for (const step of order) {
      if (step === 'timeout' && pending && immediate) {
        immediate = false; durable = true; label = 'queued';
      } else if (step === 'ack' && pending) {
        pending = false; immediate = false; durable = false; label = 'persisted';
      } else if (step === 'replyPersisted' && pending) {
        pending = false; immediate = false; durable = false; label = 'persisted';
      } else if (step === 'replyQueued' && pending) {
        immediate = false; label = 'queued';
      } else if (step === 'replyRejected' && pending) {
        immediate = false; label = durable ? 'queued' : 'waiting';
      } else if (step === 'error' && pending) {
        immediate = false; durable = true; label = 'queued';
      } else if (step === 'didFinish') {
        durable = false;
        if (pending) label = 'queued';
      }
    }
    return {pending, immediate, durable, label};
  };

  assert.deepEqual(simulate(['timeout']), {pending:true, immediate:false, durable:true, label:'queued'});
  assert.equal(simulate(['ack','timeout']).label, 'persisted');
  assert.equal(simulate(['timeout','ack']).label, 'persisted');
  assert.equal(simulate(['timeout','replyPersisted']).label, 'persisted');
  assert.equal(simulate(['timeout','ack','error']).label, 'persisted');
  assert.equal(simulate(['error','ack']).label, 'persisted');
  assert.equal(simulate(['timeout','didFinish','ack']).label, 'persisted');

  const permutations = items => {
    if (items.length <= 1) return [items];
    return items.flatMap((item, index) =>
      permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]));
  };
  for (const order of permutations(['timeout','ack','error','didFinish'])) {
    assert.equal(simulate(order).label, 'persisted',
      `ACK deve vencer qualquer ordenamento: ${order.join(' → ')}`);
  }
  for (const order of permutations(['timeout','replyPersisted','error','didFinish'])) {
    assert.equal(simulate(order).label, 'persisted',
      `reply persisted deve vencer qualquer ordenamento: ${order.join(' → ')}`);
  }
});
