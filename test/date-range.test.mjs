import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const coreText = fs.readFileSync(new URL('../public/mm-registro.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(coreText, { window, globalThis: window });

assert.equal(window.MMRegistro.version, '4.0.0');
assert.equal(typeof window.MMRegistro.bindDateRange, 'function');
assert.equal(typeof window.MMRegistro.constrainDateRange, 'function');

class FakeInput {
  constructor(value = '') {
    this.value = value;
    this.attrs = new Map();
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type = 'change') { for (const handler of this.listeners.get(type) || []) handler({ target:this }); }
}

const from = new FakeInput();
const to = new FakeInput();
let lastChange = null;
const control = window.MMRegistro.bindDateRange(from, to, { onChange: detail => { lastChange = detail; } });

// Escolher De restringe o mínimo possível de Até.
from.value = '2026-08-10';
from.dispatch();
assert.equal(to.getAttribute('min'), '2026-08-10');
assert.equal(from.getAttribute('max'), null);
assert.equal(lastChange.changed, 'from');
assert.equal(lastChange.adjusted, false);

// Escolher Até restringe o máximo possível de De.
to.value = '2026-08-12';
to.dispatch();
assert.equal(from.getAttribute('max'), '2026-08-12');
assert.equal(to.getAttribute('min'), '2026-08-10');

// Mesmo que um ambiente permita digitação inválida, o par nunca permanece invertido.
to.value = '2026-08-05';
to.dispatch();
assert.equal(from.value, '2026-08-05');
assert.equal(to.value, '2026-08-05');
assert.equal(lastChange.adjusted, true);
assert.equal(from.getAttribute('max'), '2026-08-05');
assert.equal(to.getAttribute('min'), '2026-08-05');

from.value = '2026-08-20';
from.dispatch();
assert.equal(from.value, '2026-08-20');
assert.equal(to.value, '2026-08-20');
assert.equal(lastChange.adjusted, true);

// Limpar o intervalo remove as restrições nativas.
from.value = '';
to.value = '';
control.refresh();
assert.equal(from.getAttribute('max'), null);
assert.equal(to.getAttribute('min'), null);

control.destroy();
console.log('MM Registro date-range constraint tests: OK');
