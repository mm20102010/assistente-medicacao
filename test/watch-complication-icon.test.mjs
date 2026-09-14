import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('complication do Assistente é WidgetKit dinâmica embutida no Watch', async () => {
  const [pbx, swift] = await Promise.all([
    read('ios/App/App.xcodeproj/project.pbxproj'),
    read('ios/App/Assistente Watch Complications/AssistenteComplications.swift')
  ]);
  assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = br\.com\.mmregistro\.assistentemedicacao\.watchkitapp\.complications/);
  assert.match(swift, /AssistenteStatusComplication/);
  assert.match(swift, /Gauge\(value:\s*progress\)/);
  assert.match(swift, /todayPlanned/);
  assert.match(swift, /todayTaken/);
  assert.match(swift, /nextScheduledAt/);
});

test('Watch e complication compartilham snapshot por App Group', async () => {
  const [watch, complication, pbx] = await Promise.all([
    read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift'),
    read('ios/App/Assistente Watch Complications/AssistenteComplications.swift'),
    read('ios/App/App.xcodeproj/project.pbxproj')
  ]);
  for (const source of [watch, complication]) assert.match(source, /group\.br\.com\.mmregistro\.assistentemedicacao\.watch/);
  assert.match(pbx, /AssistenteWatch\.entitlements/);
  assert.match(pbx, /AssistenteComplications\.entitlements/);
  assert.match(watch, /publishAssistenteComplicationSnapshot/);
  assert.match(watch, /applyOptimisticProjection/);
});

test('complication não cria transporte próprio', async () => {
  const swift = await read('ios/App/Assistente Watch Complications/AssistenteComplications.swift');
  assert.doesNotMatch(swift, /WatchConnectivity|WCSession|URLSession/);
});


test('complication usa catálogo PT/EN/ES sem extrair contador dinâmico', async () => {
  const [swift, catalog, pbx] = await Promise.all([
    read('ios/App/Assistente Watch Complications/AssistenteComplications.swift'),
    read('ios/App/Assistente Watch Complications/Localizable.xcstrings'),
    read('ios/App/App.xcodeproj/project.pbxproj')
  ]);
  assert.match(swift, /Text\(verbatim:\s*"\\\(entry\.taken\)\/\\\(entry\.planned\)"\)/);
  assert.match(swift, /String\(localized:\s*"complication\.status\.name"\)/);
  assert.match(swift, /String\(localized:\s*"complication\.status\.description"\)/);
  assert.match(swift, /String\(localized:\s*"complication\.status\.accessibility"\)/);
  assert.doesNotMatch(swift, /configurationDisplayName\("Assistente"\)|description\("Progresso/);
  const parsed = JSON.parse(catalog);
  assert.deepEqual(Object.keys(parsed.strings).sort(), [
    'complication.status.accessibility',
    'complication.status.description',
    'complication.status.name'
  ]);
  for (const entry of Object.values(parsed.strings)) {
    for (const locale of ['pt', 'en', 'es']) assert.ok(entry.localizations?.[locale]?.stringUnit?.value);
  }
  assert.doesNotMatch(catalog, /"%@\/%@"|"Diary"/);
  const complicationBlocks = [...pbx.matchAll(/E4030000000000000000000[CD][\s\S]*?buildSettings = \{([\s\S]*?)\n\t\t\t\};/g)];
  assert.equal(complicationBlocks.length, 2);
  for (const [, block] of complicationBlocks) assert.match(block, /SWIFT_EMIT_LOC_STRINGS = NO;/);
});
