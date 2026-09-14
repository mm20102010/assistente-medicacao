import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('stateSourceID do Diário falha fechado', () => {
  const swift = read('ios/App/App/WatchSessionManager.swift');
  assert.match(swift, /string\(forKey: key\) == value \? value : ""/);
  assert.doesNotMatch(swift, /string\(forKey: key\) == value \? value : UUID\(\)\.uuidString/);
  assert.match(swift, /private func sendLatestWatchState[\s\S]*?guard !Self\.stateSourceID\.isEmpty/);
});

test('repo gate verifica o native sync real em sandbox sem gerar arquivos no clone', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['repo:gate'], /native:verify-sync/);
  assert.equal(pkg.scripts['native:verify-sync'], 'node scripts/verify-native-sync.mjs');
  const verify = read('scripts/verify-native-sync.mjs');
  assert.match(verify, /mkdtemp/);
  assert.match(verify, /build-native\.mjs/);
  assert.match(verify, /native-sync\.mjs/);
  assert.match(verify, /public ↔ native-web/);
  assert.match(verify, /public ↔ ios\/App\/App\/public/);
});

test('workflows usam bootstrap protegido e restore web executa gate atual', () => {
  for (const name of ['apply-zip-update.yml','deploy.yml','restore-stable.yml']) {
    assert.match(read(`.github/workflows/${name}`), /protected-repo-gate\.mjs/);
  }
  const restore = read('.github/workflows/restore-stable.yml');
  assert.match(restore, /Run current web restore gate[\s\S]*?npm run web:restore-gate/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['web:restore-gate'], /npm test/);
  assert.match(pkg.scripts['web:restore-gate'], /web:validate/);
  assert.match(pkg.scripts['web:restore-gate'], /validate:repo/);
});

test('bootstrap protegido atual aprova o repositório corrente', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const script = fileURLToPath(new URL('../.github/scripts/protected-repo-gate.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {cwd:root,encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
