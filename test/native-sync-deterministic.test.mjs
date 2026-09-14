import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../scripts/native-sync.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('native:sync é determinístico e independente do Capacitor CLI', () => {
  assert.match(pkg.scripts['native:sync'], /native:build.*native-sync\.mjs.*apply-ios-assets\.mjs/);
  assert.doesNotMatch(pkg.scripts['native:sync'], /cap sync/);
  assert.match(script, /fs\.cp\(source, iosPublic/);
  assert.match(script, /br\.com\.mmregistro\.assistentemedicacao/);
  assert.match(script, /contentInset: 'never'/);
  assert.match(script, /fs\.writeFile\(iosConfig/);
});
