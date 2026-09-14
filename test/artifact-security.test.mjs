import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/validate-release.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'diario-artifact-'));
  const files = [
    'package.json','package-lock.json','public/index.html','public/app.js',
    'ios/App/App.xcodeproj/project.pbxproj','.github/workflows/deploy.yml',
    '.github/workflows/apply-zip-update.yml'
  ];
  for (const rel of files) {
    const dest = path.join(root, rel);
    await mkdir(path.dirname(dest), { recursive:true });
    await writeFile(dest, '{}');
  }
  return root;
}

function run(...args) { return spawnSync(process.execPath, [script, ...args], { encoding:'utf8' }); }

test('validador permanente aceita o repositório e rejeita symlink/segredos no release', async () => {
  const current = run('--repo', repo);
  assert.equal(current.status, 0, current.stderr || current.stdout);

  const root = await fixture();
  try {
    assert.equal(run(root).status, 0);
    await symlink('app.js', path.join(root, 'public', 'alias.js'));
    let result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink não permitido/);
    await rm(path.join(root, 'public', 'alias.js'));
    await writeFile(path.join(root, '.env'), 'SECRET=x');
    result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /arquivo sensível\/temporário/);
  } finally { await rm(root, { recursive:true, force:true }); }
});
