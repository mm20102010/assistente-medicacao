import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mm-registro-core.json'), 'utf8'));
assert.equal(manifest.version, '4.0.0');
assert.equal(manifest.algorithm, 'sha256');
const prefix = 'public';
for (const [name, expected] of Object.entries(manifest.files)) {
  const file = path.join(root, prefix, name);
  assert.ok(fs.existsSync(file), `${name} deve existir`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(actual, expected, `${name} divergiu da baseline MM Registro 4.0`);
}
console.log('MM Registro Core 4.0 integrity: OK');
