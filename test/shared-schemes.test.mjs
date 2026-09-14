import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../ios/App/App.xcodeproj/xcshareddata/xcschemes/${name}`, import.meta.url), 'utf8');

test('schemes compartilhados do iPhone e Watch ficam versionados', async () => {
  const app = await read('App.xcscheme');
  const watch = await read('Assistente Watch Watch App.xcscheme');
  const complications = await read('Assistente Watch Complications.xcscheme');

  assert.match(app, /BlueprintIdentifier = "504EC3031FED79650016851F"/);
  assert.match(app, /BlueprintName = "App"/);
  assert.match(app, /BuildableName = "App\.app"/);

  assert.match(watch, /BlueprintIdentifier = "D5048654302B968200E91836"/);
  assert.match(watch, /BlueprintName = "Assistente Watch Watch App"/);
  assert.match(watch, /BlueprintIdentifier = "E40300000000000000000006"/);
  assert.match(watch, /BlueprintName = "Assistente Watch Complications"/);

  assert.match(complications, /BlueprintIdentifier = "E40300000000000000000006"/);
  assert.match(complications, /BuildableName = "Assistente Watch Complications\.appex"/);
});
