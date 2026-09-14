import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Diário oferece diagnóstico opt-in no Suporte e só inclui trace no backup quando ligado', async () => {
  const [html, app, i18n] = await Promise.all([
    read('public/index.html'), read('public/app.js'), read('public/i18n.js')
  ]);
  assert.match(html, /id="supportDialog"[\s\S]*?id="supportEmailBtn"[\s\S]*?id="diagnosticModeToggle"/);
  assert.match(app, /const DIAGNOSTIC_MODE_KEY = 'assistente\.diagnosticMode\.v1'/);
  assert.match(app, /const DIAGNOSTIC_TRACE_LIMIT = 500/);
  assert.match(app, /function diagnosticTrace\(event, extra = \{\}\) \{\s*if \(!diagnosticModeEnabled\(\)\) return;/);
  assert.match(app, /function initializeDiagnosticMode\(\)[\s\S]*?removeItem\(DIAGNOSTIC_TRACE_KEY\)/);
  assert.match(app, /function setDiagnosticMode\(enabled\)[\s\S]*?removeItem\(DIAGNOSTIC_TRACE_KEY\)/);
  assert.match(app, /if \(diagnosticModeEnabled\(\)\) \{\s*backup\.diagnostics = \{/);
  assert.match(app, /WATCH_DRAIN_BEGIN/);
  assert.match(app, /WATCH_EVENT_ACK_RESULT/);
  assert.match(app, /STATE_WRITE_BEGIN/);
  assert.match(app, /IPHONE_RECORD_BEGIN/);
  assert.match(app, /CLEAR_ALL_BEGIN/);
  for (const key of ['support.diagnosticMode','support.diagnosticDesc','support.diagnosticEnabledToast','support.diagnosticDisabledToast']) {
    assert.equal((i18n.match(new RegExp(`"${key.replace('.', '\\.')}":`, 'g')) || []).length, 3, `${key} deve existir nos três idiomas`);
  }
});
