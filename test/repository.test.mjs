import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('B2 mantém uma única fonte web em public/', async () => {
  for (const f of ['index.html','app.js','styles.css','sw.js','manifest.webmanifest','native-runtime.js']) {
    const inside = await stat(new URL(`../public/${f}`, import.meta.url));
    assert.ok(inside.isFile(), `public/${f} deve existir`);
    const rootCopy = await stat(new URL(`../${f}`, import.meta.url)).catch(() => null);
    assert.equal(rootCopy, null, `${f} não deve existir duplicado na raiz`);
  }
  const build = await readFile(new URL('../scripts/build-native.mjs', import.meta.url), 'utf8');
  assert.match(build, /path\.join\(root, 'public'\)/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.scripts?.['web:package']);
  assert.ok(pkg.scripts?.['repo:check']);
});


test('MM Registro Core 4.0 valida intervalos De/Até no Diário', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const core = await readFile(new URL('../public/mm-registro.js', import.meta.url), 'utf8');
  assert.match(core, /const VERSION = '4\.0\.0'/);
  assert.match(core, /function bindDateRange\(/);
  assert.match(app, /MMRegistro\.bindDateRange\(els\.analysisStartDate, els\.analysisEndDate/);
  assert.match(app, /MMRegistro\.bindDateRange\(els\.exportFilterFrom, els\.exportFilterTo/);
});


test('MM Registro Core 4.0 unifica canvas e superfície dos filtros sem repintar o Histórico', async () => {
  const css = await readFile(new URL('../public/mm-registro.css', import.meta.url), 'utf8');
  assert.match(css, /--mm-history-surface:var\(--mm-surface\)/);
  assert.match(css, /body\.mm-registro::before\{[\s\S]*?background-size:100vw 100dvh;[\s\S]*?background-image:var\(--mm-app-background\)/);
  assert.match(css, /body\.mm-registro \[data-mm-view-panel\]\{background:transparent !important;\}/);
  assert.match(css, /body\.mm-registro \.mm-history-sticky-zone\{[\s\S]*?background:none !important;/);
  assert.match(css, /body\.mm-registro \.mm-history-sticky-zone::before\{[\s\S]*?background-size:100vw 100dvh;/);
  assert.match(css, /body\.mm-registro \.mm-history-filter-sticky,[\s\S]*?body\.mm-registro \.mm-export-preview-sheet \.export-preview-filters,[\s\S]*?background:var\(--mm-history-surface\) !important;/);
});


test('MM Registro Core 4.0 alinha a prévia de imagem ao canvas do Histórico', async () => {
  const css = await readFile(new URL('../public/mm-registro.css', import.meta.url), 'utf8');
  assert.match(css, /body\.mm-registro \.mm-secondary-layer\.mm-export-preview-layer\{[\s\S]*?background-image:var\(--mm-app-background\) !important;[\s\S]*?backdrop-filter:none !important;/);
  assert.match(css, /body\.mm-registro \.mm-secondary-layer\.mm-export-preview-layer > \.mm-secondary-sheet\.mm-export-preview-sheet\{[\s\S]*?background:transparent !important;[\s\S]*?box-shadow:none !important;/);
});


test('Editar Registro usa Secondary Sheet canônica acima do chrome', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const core = await readFile(new URL('../public/mm-registro.css', import.meta.url), 'utf8');
  assert.match(html, /id="editSheet" class="mm-secondary-layer mm-edit-record-layer"[^>]*data-mm-secondary-layer="edit-record"/);
  assert.match(html, /mm-edit-record-sheet[\s\S]*?<button class="sheet-close liquid-button"[\s\S]*?<div class="mm-secondary-sheet__heading">/);
  assert.doesNotMatch(html, /id="editSheet"[\s\S]{0,600}sheet-title-row/);
  assert.match(core, /body\.mm-registro \.mm-secondary-layer > \.mm-secondary-sheet\{[\s\S]*?height:calc\(100dvh - var\(--mm-safe-top\) - 8px\);/);
  assert.doesNotMatch(css, /\.mm-edit-record-layer\s*\{[\s\S]*?height:calc\(100dvh/,'Diário não deve sobrescrever a altura canônica da Secondary Sheet');
});

test('Apagar todos os dados fica na zona destrutiva isolada', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/mm-registro.css', import.meta.url), 'utf8');
  assert.match(html, /class="mm-destructive-zone">[\s\S]*?id="moreClearBtn"/);
  assert.match(css, /\.mm-destructive-zone\{[\s\S]*?margin:clamp\(180px,28vh,320px\) auto 36px;/);
});
