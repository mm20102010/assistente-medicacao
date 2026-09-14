import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync(new URL('../public/mm-registro.css',import.meta.url),'utf8');
assert.match(css,/MM Registro Core 4\.0/);
assert.match(css,/--mm-history-surface:var\(--mm-surface\)/);
assert.match(css,/\.mm-history-sticky-zone\{[\s\S]*?background:none !important;/);
assert.match(css,/\.mm-history-sticky-zone::before\{[\s\S]*?background-size:100vw 100dvh;/);
assert.match(css,/\.mm-history-filter-sticky,[\s\S]*?\.mm-export-preview-sheet \.export-preview-filters,[\s\S]*?background:var\(--mm-history-surface\) !important;/);

assert.match(css,/body\.mm-registro \.mm-secondary-layer\.mm-export-preview-layer\{[\s\S]*?background-image:var\(--mm-app-background\) !important;[\s\S]*?backdrop-filter:none !important;/);
assert.match(css,/body\.mm-registro \.mm-secondary-layer\.mm-export-preview-layer > \.mm-secondary-sheet\.mm-export-preview-sheet\{[\s\S]*?background:transparent !important;[\s\S]*?box-shadow:none !important;/);

// 3.4.10 — Editar Registro must use exactly the canonical Secondary Sheet header/close geometry.
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const localCss=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
assert.match(html,/id="editSheet" class="mm-secondary-layer mm-edit-record-layer"[\s\S]*?<button class="sheet-close liquid-button"[\s\S]*?<div class="mm-secondary-sheet__heading">/);
assert.doesNotMatch(html,/id="editSheet"[\s\S]{0,500}sheet-title-row/,'Editar Registro não deve manter header legado');
assert.doesNotMatch(localCss,/\.mm-edit-record-layer\s*\{[\s\S]*?height:calc\(100dvh - var\(--mm-safe-top\)\)/,'app não deve sobrescrever a altura canônica da Secondary Sheet');
assert.match(html,/class="mm-destructive-zone"[\s\S]*?<button id="moreClearBtn" class="danger-outline-btn"/,'Diário deve usar a ação destrutiva canônica');
