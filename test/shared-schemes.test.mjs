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

  // Xcode 27 normaliza o scheme principal para 1.3 e inclui Testables vazio.
  // Manter esta forma evita que apenas abrir o projeto deixe o Git sujo.
  assert.match(app, /version = "1\.3"/);
  assert.match(app, /<Testables>[\s\S]*<\/Testables>/);

  // No scheme do Watch, Xcode 27 preserva BlueprintName no BuildAction,
  // mas o remove das referências de Launch/Profile. Portanto deve haver
  // exatamente uma ocorrência do nome do target no XML inteiro.
  assert.equal((watch.match(/BlueprintName = "Assistente Watch Watch App"/g) || []).length, 1);
});
