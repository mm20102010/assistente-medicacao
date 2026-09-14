import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../public/native-runtime.js', import.meta.url), 'utf8');
const phone = fs.readFileSync(new URL('../ios/App/App/WatchSessionManager.swift', import.meta.url), 'utf8');
const watch = fs.readFileSync(new URL('../ios/App/Assistente Watch Watch App/WatchSessionManager.swift', import.meta.url), 'utf8');

test('validação não descarta silenciosamente o registro 10.001', () => {
  const start = app.indexOf('const DEFAULT_MEDICINES');
  const end = app.indexOf('\nfunction openDatabase()', start);
  const context = vm.createContext({ Date, Intl, Math, Set, crypto:{ randomUUID:()=>'generated' } });
  vm.runInContext(`${app.slice(start, end)}; globalThis.validateState = validateState;`, context);
  const records = Array.from({ length:10001 }, (_, index) => ({
    id:`r-${index}`, medicine:'Teste', date:'2026-09-12', time:'12:00'
  }));
  assert.equal(context.validateState({ records, medicines:['Teste'] }).records.length, 10001);
  assert.doesNotMatch(app, /MAX_RECORDS/);
});

test('histórico limita somente o DOM e oferece paginação progressiva', () => {
  assert.match(app, /const HISTORY_RENDER_BATCH = 250/);
  assert.match(app, /filtered\.slice\(0, historyRenderLimit\)/);
  assert.match(app, /data-action="load-more"/);
});

test('primeiro drain aguarda a confirmação real do listener nativo', () => {
  assert.match(runtime, /const watchEventsReady = watchPlugin\?\.addListener \? Promise\.resolve/);
  assert.match(app, /await window\.MMNative\?\.watchEventsReady[\s\S]*?await syncWatchMedicationEventsFromNative\(\{ render: false \}\)/);
});

test('iPhone e Watch aceitam ISO 8601 com e sem frações de segundo', () => {
  for (const source of [phone, watch]) {
    assert.match(source, /private enum RecordDateCodec/);
    assert.match(source, /\.withFractionalSeconds/);
    assert.match(source, /fractional\.date\(from: value\) \?\? ISO8601DateFormatter\(\)\.date\(from: value\)/);
  }
});

test('imagem da análise identifica app local, nome inglês e geração localizada', () => {
  assert.match(app, /localizedName === 'Medication Assistant'/);
  assert.match(app, /tr\('export\.generated'/);
});

test('backup e diagnóstico registram locale, fuso, runtime e nome inglês', () => {
  assert.match(app, /appEnglishName:"Medication Assistant"/);
  assert.match(app, /timeZone:Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(app, /runtime:window\.MMNative\?\.platform \|\| 'web'/);
});
