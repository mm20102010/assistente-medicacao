import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = [
  'package.json',
  'package-lock.json',
  'README.md',
  'public/app.js',
  'public/index.html',
  'public/sw.js',
  'public/i18n.js',
  'scripts/set-version.mjs',
  'scripts/package-web.mjs',
  'ios/App/App.xcodeproj/project.pbxproj'
];

test('version:set preserva .0 no Xcode e encurta apenas a versão visual', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'diario-versioning-'));
  try {
    for (const rel of files) {
      const src = path.join(repoRoot, rel);
      const dst = path.join(temp, rel);
      await mkdir(path.dirname(dst), { recursive: true });
      await cp(src, dst);
    }

    await execFileAsync(process.execPath, [path.join(temp, 'scripts/set-version.mjs'), '4.11.0'], { cwd: temp });

    const pkg = JSON.parse(await readFile(path.join(temp, 'package.json'), 'utf8'));
    const pbx = await readFile(path.join(temp, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const app = await readFile(path.join(temp, 'public/app.js'), 'utf8');
    const index = await readFile(path.join(temp, 'public/index.html'), 'utf8');

    assert.equal(pkg.version, '4.11.0');
    assert.equal(pkg.marketingVersion, '4.11.0');
    assert.equal((pbx.match(/MARKETING_VERSION = 4\.11\.0;/g) || []).length, 6);
    assert.doesNotMatch(pbx, /MARKETING_VERSION = 4\.11;/);
    assert.match(app, /const APP_VERSION = "4\.11";/);
    assert.match(app, /const DIAGNOSTIC_REVISION = '4\.11';/);
    assert.match(index, />v4\.11</);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
