import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readBuffer = path => readFile(new URL(`../${path}`, import.meta.url));

test('lembrete iPhone transporta contexto exato da dose e captura toque em app ativo ou cold launch', async () => {
  const ios = await read('ios/App/App/WatchSessionManager.swift');
  const delegate = await read('ios/App/App/AppDelegate.swift');
  const scene = await read('ios/App/App/SceneDelegate.swift');

  assert.match(ios, /content\.categoryIdentifier = "MEDICATION_SCHEDULED"/);
  assert.match(ios, /content\.userInfo = \[[\s\S]*?"type": "scheduledMedication"[\s\S]*?"scheduleId"[\s\S]*?"medicine"[\s\S]*?"scheduledAt"/);
  assert.match(delegate, /UNUserNotificationCenterDelegate/);
  assert.match(delegate, /identifier: "MEDICATION_SCHEDULED"/);
  assert.match(delegate, /MedicationNotificationContextStore\.shared\.store/);
  assert.match(delegate, /request: response\.notification\.request/);
  assert.match(scene, /connectionOptions\.notificationResponse/);
  assert.match(scene, /MedicationNotificationContextStore\.shared\.store/);
  assert.match(delegate, /identifier\.hasPrefix\("medsched\."\)/);
  assert.match(delegate, /suffix\.lastIndex\(of: "\."\)/);
  assert.match(delegate, /request\.content\.title/);
  assert.match(delegate, /isoString\(fromMilliseconds:/);
});

test('fallback nativo reconstrói a dose pelo identifier medsched mesmo sem userInfo', async () => {
  const app = await read('public/app.js');
  const delegate = await read('ios/App/App/AppDelegate.swift');
  assert.match(app, /id:`medsched\.\$\{o\.scheduleId\}\.\$\{o\.at\.getTime\(\)\}`/);
  assert.match(delegate, /fallbackContext\(from request: UNNotificationRequest\)/);
  assert.match(delegate, /String\(identifier\.dropFirst\("medsched\."\.count\)\)/);
  assert.match(delegate, /let scheduleID = String\(suffix\[\.\.<separator\]\)/);
  assert.match(delegate, /let milliseconds = Int64\(millisecondsRaw\)/);
  assert.match(delegate, /"scheduledAt": String\(isoString\(fromMilliseconds: milliseconds\)\.prefix\(64\)\)/);
});

test('ponte iOS expõe contexto de notificação ao WebView e emite evento de abertura', async () => {
  const ios = await read('ios/App/App/WatchSessionManager.swift');
  const runtime = await read('public/native-runtime.js');

  assert.match(ios, /CAPPluginMethod\(name: "consumeScheduledMedicationNotificationContext"/);
  assert.match(ios, /notifyListeners\("scheduledMedicationNotificationOpened"/);
  assert.match(runtime, /consumeScheduledMedicationNotificationContext/);
  assert.match(runtime, /addListener\('scheduledMedicationNotificationOpened'/);
  assert.match(runtime, /mm:scheduled-medication-notification-opened/);
});


test('foreground faz recuperação durável do contexto da notificação mesmo se o evento nativo for perdido', async () => {
  const app = await read('public/app.js');
  assert.match(app, /recoverScheduledMedicationNotificationContext/);
  assert.match(app, /const delays = retry \? \[0, 120, 420, 900\] : \[0\]/);
  assert.match(app, /window\.addEventListener\('focus'/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(app, /SCHEDULE_NOTIFICATION_CONTEXT_RECEIVED/);
  assert.match(app, /SCHEDULE_NOTIFICATION_CONTEXT_EMPTY/);
  const initStart = app.indexOf('async function init()');
  const initBlock = app.slice(initStart, app.indexOf('document.addEventListener("DOMContentLoaded", init)', initStart));
  assert.ok(initBlock.indexOf('refreshEntryMedicineDefault()') < initBlock.indexOf('recoverScheduledMedicationNotificationContext({ retry:true })'), 'contexto da notificação deve ser aplicado depois do default normal da Home');
});

test('toque no lembrete preenche Home com o remédio e preserva a ocorrência exata até registrar', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('async function applyScheduledNotificationContext');
  const end = app.indexOf('\nasync function consumeScheduledMedicationNotificationContext', start);
  const block = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /scheduledOccurrenceFromNotificationContext\(normalizedContext\)/);
  assert.match(block, /isOccurrenceConsumed\(occurrence\)/);
  assert.match(block, /pendingScheduledNotificationContext=normalizedContext/);
  assert.match(block, /setActiveTab\('register'\)/);
  assert.match(block, /fillMedicineSelect\(els\.entryMedicine,medicine\)/);
  assert.match(block, /setNow\(\)/);

  const addStart = app.indexOf('async function addRecord()');
  const addEnd = app.indexOf('\nfunction openEdit', addStart);
  const add = app.slice(addStart, addEnd);
  assert.match(add, /scheduledOccurrenceFromNotificationContext\(\)/);
  assert.match(add, /newRecord\.scheduleId=notificationOccurrence\.scheduleId/);
  assert.match(add, /newRecord\.scheduledAt=notificationOccurrence\.at\.toISOString\(\)/);
  assert.match(add, /source:'notification'/);
  assert.match(add, /clearScheduledNotificationContext\(\)/);
});

test('notificação antiga de dose já consumida é ignorada antes de pré-selecionar o remédio', async () => {
  const app = await read('public/app.js');
  const start = app.indexOf('async function applyScheduledNotificationContext');
  const end = app.indexOf('\nasync function consumeScheduledMedicationNotificationContext', start);
  const block = app.slice(start, end);
  const consumed = block.indexOf('isOccurrenceConsumed(occurrence)');
  const pending = block.indexOf('pendingScheduledNotificationContext=normalizedContext');
  const select = block.indexOf('fillMedicineSelect(els.entryMedicine,medicine)');
  assert.ok(consumed >= 0 && pending > consumed && select > pending, 'validação de duplicidade deve anteceder o preenchimento da Home');
  assert.match(block, /SCHEDULE_NOTIFICATION_CONTEXT_IGNORED/);
});

test('Watch recebe o contexto da notificação, registra a dose e retorna à lista após confirmação de 2s', async () => {
  const router = await read('ios/App/Assistente Watch Watch App/Assistente_WatchApp.swift');
  const manager = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  const content = await read('ios/App/Assistente Watch Watch App/ContentView.swift');

  assert.match(router, /UNUserNotificationCenterDelegate/);
  assert.match(router, /identifier: "MEDICATION_SCHEDULED"/);
  assert.match(router, /"type"\] as\? String\) == "scheduledMedication"/);
  assert.match(router, /assistenteScheduledMedicationNotificationOpened/);
  assert.match(content, /handlePendingScheduledNotification\(\)/);
  assert.match(content, /registerScheduledMedicationFromNotification/);
  assert.match(content, /notificationConfirmationMedicine/);
  assert.match(content, /registeredFormat/);
  assert.match(manager, /func registerScheduledMedicationFromNotification/);
  assert.match(manager, /scheduleId:/);
  assert.match(manager, /scheduledAt:/);
  assert.match(manager, /Task\.sleep\(for: \.seconds\(2\)\)/);
  assert.match(manager, /notificationConfirmationMedicine = nil/);
});

test('projeção otimista do Watch só incrementa gauge quando a ocorrência exata ainda existe', async () => {
  const manager = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  const start = manager.indexOf('private func applyOptimisticProjection(scheduleId: String');
  const end = manager.indexOf('\n    private func applyOptimisticProjection(for medicine:', start);
  const block = manager.slice(start, end);
  const guardIndex = block.indexOf('guard let index = projectionOccurrences.firstIndex');
  const increment = block.indexOf('todayTaken = min');
  assert.ok(guardIndex >= 0 && increment > guardIndex, 'gauge não deve avançar se a ocorrência já desapareceu da projeção');
  assert.match(block, /projectionOccurrences\.remove\(at: index\)/);
});

test('confirmação grande no Watch está localizada em português, inglês e espanhol', async () => {
  const i18n = await read('public/i18n.js');
  assert.match(i18n, /"watch\.registeredFormat": "%@ registrado"/);
  assert.match(i18n, /"watch\.registeredFormat": "%@ recorded"/);
  assert.ok((i18n.match(/"watch\.registeredFormat": "%@ registrado"/g) || []).length >= 2);
});

test('ícone do Assistente usa a nova variante com glow e não é o ícone original do Diário', async () => {
  const icon = await readBuffer('native-assets/ios/icon-1024.png');
  const hash = createHash('sha256').update(icon).digest('hex');
  assert.notEqual(hash, 'a4dd514437347eee2bf9349ee832f861e0172dabfd141ef97d3b5a1ecdb7d852');
  assert.equal(hash, '07b72a089b464021f182cab1f1f7dc2fa2f71ce208013256b3c7fc82394fac7d');
});

test('Home mantém maior respiro e centralização vertical levemente elevada', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /body\.mm-registro--assistente \.tab-panel__register-wrap\s*\{[\s\S]*?gap:\s*28px[\s\S]*?justify-content:\s*center[\s\S]*?padding-bottom:\s*clamp\(34px,5\.5vh,62px\)/);
  assert.match(css, /body\.mm-registro--assistente \.tab-panel__register-wrap \.assistente-home-actions\s*\{[\s\S]*?gap:\s*18px/);
});

test('contexto do toque no iPhone é durável e sobrevive ao timing da WebView', async () => {
  const delegate = await read('ios/App/App/AppDelegate.swift');
  assert.match(delegate, /persistedContextKey\s*=\s*"mm\.assistente\.pendingScheduledMedicationContext\.v2"|persistedContextKey\s*=\s*"mm\.assistente\.pendingScheduledNotificationContext\.v2"/);
  assert.match(delegate, /UserDefaults\.standard\.set\(context, forKey: persistedContextKey\)/);
  assert.match(delegate, /validPersistedContextLocked\(\)/);
  assert.match(delegate, /maxContextAge:\s*TimeInterval\s*=\s*15 \* 60/);
  assert.match(delegate, /pendingContext \?\? validPersistedContextLocked\(\)/);
  assert.match(delegate, /UserDefaults\.standard\.removeObject\(forKey: persistedContextKey\)/);
});

test('delegate de notificações é reassumido após o bridge Capacitor e em transições de lifecycle', async () => {
  const delegate = await read('ios/App/App/AppDelegate.swift');
  const scene = await read('ios/App/App/SceneDelegate.swift');
  const bridge = await read('ios/App/App/WatchSessionManager.swift');

  assert.match(delegate, /func ensureNotificationDelegate\(\)[\s\S]*?UNUserNotificationCenter\.current\(\)\.delegate = self/);
  for (const callback of ['applicationWillResignActive','applicationDidEnterBackground','applicationWillEnterForeground','applicationDidBecomeActive']) {
    assert.match(delegate, new RegExp(`func ${callback}\\([\\s\\S]*?ensureNotificationDelegate\\(\\)`));
  }
  assert.match(bridge, /override func capacitorDidLoad\(\)[\s\S]*?AppDelegate\)\?\.ensureNotificationDelegate\(\)[\s\S]*?registerPluginInstance/);
  for (const callback of ['sceneWillResignActive','sceneDidEnterBackground','sceneWillEnterForeground','sceneDidBecomeActive']) {
    assert.match(scene, new RegExp(`func ${callback}\\([\\s\\S]*?ensureNotificationDelegate\\(\\)`));
  }
});

test('diagnóstico do contexto informa origem, request e delegate se o problema físico reaparecer', async () => {
  const ios = await read('ios/App/App/WatchSessionManager.swift');
  const runtime = await read('public/native-runtime.js');
  const app = await read('public/app.js');
  assert.match(ios, /"capturedAt": context\["capturedAt"\]/);
  assert.match(ios, /"captureSource": context\["captureSource"\]/);
  assert.match(ios, /"requestIdentifier": context\["requestIdentifier"\]/);
  assert.match(ios, /"delegateType": delegateType/);
  assert.match(runtime, /delegateType:String\(result\?\.delegateType/);
  assert.match(app, /SCHEDULE_NOTIFICATION_CONTEXT_EMPTY[\s\S]*?delegateType/);
  assert.match(app, /SCHEDULE_NOTIFICATION_CONTEXT_RECEIVED[\s\S]*?captureSource[\s\S]*?requestIdentifier[\s\S]*?delegateType/);
});
