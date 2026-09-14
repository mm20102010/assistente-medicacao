import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const parse = source => new Map([...source.matchAll(/"([^"]+)"\s*=\s*"([^"]*)"\s*;/g)].map(m => [m[1], m[2]]));
const expected = { en:'Medication', es:'Medicación', pt:'Medicação' };

for (const [lang,name] of Object.entries(expected)) {
  test(`nome nativo localizado ${lang} usa DisplayName e BundleName`, async () => {
    for (const target of ['ios/App/App','ios/App/Assistente Watch Watch App']) {
      const strings = parse(await read(`${target}/${lang}.lproj/InfoPlist.strings`));
      assert.equal(strings.get('CFBundleDisplayName'), name);
      assert.equal(strings.get('CFBundleName'), name);
    }
  });
}
