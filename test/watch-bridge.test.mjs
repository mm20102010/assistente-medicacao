import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('runtime web mantém toda a ponte do Watch inativa', async () => {
  const source = await read('public/native-runtime.js');
  const ctx = {
    console,
    document: { documentElement: { dataset: {} } },
    window: null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);

  assert.equal(ctx.MMNative.isWeb, true);
  assert.equal(ctx.MMNative.isIOS, false);
  assert.equal((await ctx.MMNative.syncMedicines(['Dipirona'])).accepted, false);
  assert.deepEqual(JSON.parse(JSON.stringify(await ctx.MMNative.getWatchMedicationEvents())), []);
  assert.equal((await ctx.MMNative.acknowledgeWatchMedicationEvent('evt-1')).acknowledged, false);
  assert.equal((await ctx.MMNative.discardWatchMedicationEvent('evt-1')).discarded, false);
  assert.equal((await ctx.MMNative.resetWatchSynchronizationState('2026-08-28T10:00:00Z')).reset, false);
});

test('runtime iOS normaliza lista e eventos pela ponte local', async () => {
  const source = await read('public/native-runtime.js');
  let pluginName = null;
  let receivedMedicines = null;
  let acknowledgedID = null;
  let discardedID = null;
  let resetAt = null;
  let nativeListener = null;
  let dispatchedEvent = null;
  const ctx = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type) { this.type = type; }
    },
    dispatchEvent: event => { dispatchedEvent = event?.type || null; },
    document: { documentElement: { dataset: {} } },
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      registerPlugin: name => {
        pluginName = name;
        return {
          syncMedicines: async options => {
            receivedMedicines = options;
            return { accepted: true, delivered: true, count: options.medicines.length };
          },
          getPendingMedicationEvents: async () => ({
            events: [{
              id: ' EVT-1 ',
              medicine: '  Sumax   Pro ',
              occurredAt: '2026-08-11T19:30:00Z',
              localDate: '2026-08-11',
              localTime: '16:30',
            }],
          }),
          acknowledgeMedicationEvent: async options => {
            acknowledgedID = options.id;
            return { acknowledged: true, id: options.id };
          },
          discardMedicationEvent: async options => {
            discardedID = options.id;
            return { discarded: true, id: options.id };
          },
          resetSynchronizationState: async options => {
            resetAt = options.resetAt;
            return { reset: true, resetAt };
          },
          addListener: async (eventName, callback) => {
            assert.equal(eventName, 'watchMedicationEventAvailable');
            nativeListener = callback;
            return { remove: async () => {} };
          },
        };
      },
    },
    window: null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);

  const syncResult = await ctx.MMNative.syncMedicines(
    ['  Sumax   Pro  ', '', 'Dipirona'],
    { locale: 'en-US', texts: { title: 'Diary', queued: 'Queued' } }
  );
  assert.equal(pluginName, 'AssistenteWatch');
  assert.deepEqual(JSON.parse(JSON.stringify(receivedMedicines)), {
    medicines: ['Sumax Pro', 'Dipirona'],
    locale: 'en-US',
    texts: { title: 'Diary', queued: 'Queued' },
  });
  assert.equal(syncResult.accepted, true);

  const events = JSON.parse(JSON.stringify(await ctx.MMNative.getWatchMedicationEvents()));
  assert.deepEqual(events, [{
    id: 'EVT-1',
    medicine: 'Sumax Pro',
    occurredAt: '2026-08-11T19:30:00Z',
    localDate: '2026-08-11',
    localTime: '16:30',
  }]);

  const ack = await ctx.MMNative.acknowledgeWatchMedicationEvent(' EVT-1 ');
  assert.equal(ack.acknowledged, true);
  assert.equal(acknowledgedID, 'EVT-1');

  const discarded = await ctx.MMNative.discardWatchMedicationEvent(' EVT-1 ');
  assert.equal(discarded.discarded, true);
  assert.equal(discardedID, 'EVT-1');

  const reset = await ctx.MMNative.resetWatchSynchronizationState('2026-08-28T10:00:00Z');
  assert.equal(reset.reset, true);
  assert.equal(resetAt, '2026-08-28T10:00:00Z');

  assert.equal(typeof nativeListener, 'function');
  nativeListener();
  assert.equal(dispatchedEvent, 'mm:watch-medication-event-available');
});

test('Diário implementa registro Watch -> iPhone -> IndexedDB com deduplicação e despertar imediato', async () => {
  const app = await read('public/app.js');
  const ios = await read('ios/App/App/WatchSessionManager.swift');
  const scene = await read('ios/App/App/SceneDelegate.swift');
  const watch = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  const content = await read('ios/App/Assistente Watch Watch App/ContentView.swift');

  assert.match(app, /function syncMedicinesToNative/);
  assert.match(app, /function watchMedicationEventToRecord/);
  assert.match(app, /async function syncWatchMedicationEventsFromNative/);
  assert.match(app, /existingIds\.has\(record\.id\)/);
  assert.match(app, /await saveState\(\{ reason:'watch-drain' \}\)/);
  assert.match(app, /acknowledgeWatchMedicationEvent/);
  assert.match(app, /await loadState\(\);[\s\S]*?await syncWatchMedicationEventsFromNative\(\{ render: false \}\);/);
  assert.match(app, /window\.addEventListener\("mm:watch-medication-event-available", onNativeMedicationEvent\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange", recoverVisible\)/);
  assert.match(app, /watchEventSyncRequested/);

  assert.match(ios, /public class AssistenteWatchPlugin: CAPPlugin, CAPBridgedPlugin/);
  assert.match(ios, /CAPPluginMethod\(name: "getPendingMedicationEvents"/);
  assert.match(ios, /CAPPluginMethod\(name: "acknowledgeMedicationEvent"/);
  assert.match(ios, /CAPPluginMethod\(name: "discardMedicationEvent"/);
  assert.match(ios, /CAPPluginMethod\(name: "resetSynchronizationState"/);
  assert.match(ios, /didReceiveMessage message: \[String: Any\],[\s\S]*?replyHandler/);
  assert.match(ios, /didReceiveUserInfo userInfo: \[String: Any\]/);
  assert.match(ios, /pendingEventsKey/);
  assert.match(ios, /acknowledgedEventIDsKey/);
  assert.match(ios, /synchronizationResetAtKey/);
  assert.match(ios, /"persisted": result\.persisted/);
  assert.match(ios, /sendPersistedAcknowledgementToWatch/);
  assert.match(ios, /UserDefaults\.standard/);
  assert.match(ios, /notifyListeners\("watchMedicationEventAvailable"/);
  assert.match(ios, /setMedicationEventAvailableHandler/);
  assert.doesNotMatch(ios, /Remédio vindo do iPhone/);

  assert.match(scene, /rootViewController = AssistenteBridgeViewController\(\)/);
  assert.match(ios, /final class AssistenteBridgeViewController: CAPBridgeViewController/);
  assert.match(watch, /func registerMedication\(_ rawMedicine: String\)/);
  assert.match(watch, /UUID\(\)\.uuidString/);
  assert.match(watch, /session\.sendMessage/);
  assert.match(watch, /transferUserInfo/);
  assert.match(watch, /#if targetEnvironment\(simulator\)/);
  assert.match(watch, /outgoingMedicationEvents/);
  assert.match(watch, /reply\["persisted"\]/);
  assert.match(watch, /medicationPersistedAck/);
  assert.match(watch, /outstandingUserInfoTransfers/);
  assert.match(content, /watch\.registerMedication\(\s*medicine\s*\)/);
});


test('bootstrap instala listener Watch depois do estado e antes do primeiro drain', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('async function init()');
  const end = app.indexOf('document.addEventListener("DOMContentLoaded", init);', start);
  assert.ok(start >= 0 && end > start, 'init do Diário deve existir');
  const init = app.slice(start, end);
  const load = init.indexOf('await loadState();');
  const bind = init.indexOf('bindNativeWatchEventRecovery();');
  const drain = init.indexOf('await syncWatchMedicationEventsFromNative({ render: false });');
  const render = init.indexOf('renderAll();', drain);
  assert.ok(load >= 0 && bind > load, 'listener deve ser instalado somente depois de loadState');
  assert.ok(drain > bind, 'listener deve estar instalado antes do primeiro drain nativo');
  assert.ok(render > drain, 'primeiro render deve ocorrer depois do drain inicial');
});


test('evento nativo do Watch drena imediatamente mesmo com WebView hidden; recovery visual continua foreground-only', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('function bindNativeWatchEventRecovery()');
  const end = app.indexOf('\nasync function loadState()', start);
  assert.ok(start >= 0 && end > start, 'bindNativeWatchEventRecovery deve existir');
  const block = app.slice(start, end);

  const windowHandlers = new Map();
  const documentHandlers = new Map();
  const calls = [];
  const traces = [];
  const ctx = {
    console,
    document: {
      hidden: true,
      addEventListener(type, callback) { documentHandlers.set(type, callback); },
    },
    window: {
      MMNative: { isIOS: true },
      addEventListener(type, callback) { windowHandlers.set(type, callback); },
    },
    diagnosticTrace(event, detail) { traces.push({event, detail}); },
    syncWatchMedicationEventsFromNative: async options => { calls.push(options ?? {}); return { added:1, acknowledged:1 }; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${block}\nbindNativeWatchEventRecovery();`, ctx);

  assert.equal(typeof windowHandlers.get('mm:watch-medication-event-available'), 'function');
  await windowHandlers.get('mm:watch-medication-event-available')({ type:'mm:watch-medication-event-available' });
  await Promise.resolve();
  assert.equal(calls.length, 1, 'callback nativo deve drenar mesmo em background');
  assert.equal(traces.at(-1).detail.hidden, true);

  documentHandlers.get('visibilitychange')({ type:'visibilitychange' });
  await Promise.resolve();
  assert.equal(calls.length, 1, 'visibilitychange para hidden não deve criar trabalho redundante');

  ctx.document.hidden = false;
  windowHandlers.get('focus')({ type:'focus' });
  await Promise.resolve();
  assert.equal(calls.length, 2, 'focus visível permanece como recovery fallback');
});
