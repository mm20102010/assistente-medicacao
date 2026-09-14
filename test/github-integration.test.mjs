import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('workflows atuais do Diário exigem ZIP completo e preservam infraestrutura protegida', async () => {
  for (const f of ['deploy.yml','apply-zip-update.yml','restore-stable.yml']) {
    const info = await stat(new URL(`../.github/workflows/${f}`, import.meta.url));
    assert.ok(info.isFile(), `.github/workflows/${f} deve existir`);
  }

  const apply = await read('.github/workflows/apply-zip-update.yml');
  assert.match(apply, /Validate complete ZIP structure/);
  assert.match(apply, /"package\.json"[\s\S]*?"package-lock\.json"[\s\S]*?"ios\/App\/App\.xcodeproj\/project\.pbxproj"/);
  assert.match(apply, /find \/tmp\/diario-update -type l -print \| grep -q \./);
  assert.match(apply, /ZIP contains symbolic links, which are not accepted/);
  assert.match(apply, /Preserve protected infrastructure[\s\S]*?cp -R \.github \/tmp\/diario-protected\/github/);
  assert.match(apply, /Sync complete project from ZIP[\s\S]*?cp -R "\$ROOT"\/\. \./);
  assert.match(apply, /npm ci[\s\S]*?npm run repo:gate/);
});

test('deploy do Diário executa gate completo antes do Cloudflare Pages', async () => {
  const deploy = await read('.github/workflows/deploy.yml');
  assert.match(deploy, /npm ci/);
  assert.match(deploy, /npm run repo:gate/);
  assert.match(deploy, /pages deploy public --project-name=diario-medicacao/);
  assert.ok(deploy.indexOf('npm run repo:gate') < deploy.indexOf('pages deploy public --project-name=diario-medicacao'));
  assert.doesNotMatch(deploy, /pages deploy ios/);
});

test('WebApp compartilhado inclui runtime nativo sem remover o service worker web', async () => {
  const index = await read('public/index.html');
  const app = await read('public/app.js');
  const pkg = JSON.parse(await read('package.json'));
  const appVersion = pkg.version.replace(/\.0$/, '');
  const escapedVersion = appVersion.replace(/\./g, '\\.');
  assert.match(index, new RegExp(`native-runtime\\.js\\?v=${escapedVersion}`));
  assert.match(app, /if \(window\.MMNative\?\.isNative\) return;/);
  assert.match(app, /navigator\.serviceWorker\.register/);
});
