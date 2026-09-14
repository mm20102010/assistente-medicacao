import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');

function localeBlock(locale, nextLocale) {
  const start = i18nSource.indexOf(`"${locale}": {`);
  assert.ok(start >= 0, `catálogo ${locale} existe`);
  const end = nextLocale ? i18nSource.indexOf(`"${nextLocale}": {`, start + 1) : i18nSource.lastIndexOf('\n  }');
  assert.ok(end > start, `catálogo ${locale} tem limite válido`);
  return i18nSource.slice(start, end);
}

test('Análises resolve dias com uso nos três idiomas', () => {
  const pt = localeBlock('pt-BR', 'en-US');
  const en = localeBlock('en-US', 'es-ES');
  const es = localeBlock('es-ES');

  assert.match(pt, /"analysis\.dayWithUse":\s*"dia com uso"/);
  assert.match(pt, /"analysis\.daysWithUse":\s*"dias com uso"/);
  assert.match(en, /"analysis\.dayWithUse":\s*"day with use"/);
  assert.match(en, /"analysis\.daysWithUse":\s*"days with use"/);
  assert.match(es, /"analysis\.dayWithUse":\s*"día con uso"/);
  assert.match(es, /"analysis\.daysWithUse":\s*"días con uso"/);

  assert.match(app, /tr\(summary\.activeDays === 1 \? 'analysis\.dayWithUse' : 'analysis\.daysWithUse'\)/);
});

test('Análises usa camada de data localizada canônica e a atualiza com o locale do app', () => {
  assert.match(html, /id="analysisStartDateDisplay"/);
  assert.match(html, /id="analysisEndDateDisplay"/);
  assert.match(html, /class="date-control"[^>]*><span class="date-display" id="analysisStartDateDisplay"/);
  assert.match(html, /class="date-control"[^>]*><span class="date-display" id="analysisEndDateDisplay"/);
  assert.match(app, /function syncAnalysisDateDisplays\(\)/);
  assert.match(app, /analysisStartDateDisplay\.textContent = formatDateLabel/);
  assert.match(app, /analysisEndDateDisplay\.textContent = formatDateLabel/);
  assert.match(app, /function isoToLocalDate[\s\S]*I18N\?\.formatDate\(new Date\(year, month - 1, day\), \{ day:'2-digit', month:'2-digit', year:'numeric' \}\)/);
  assert.match(app, /analysisDateRangeControl\?\.refresh\(\);\s*syncAnalysisDateDisplays\(\);/);
});

test('exportação da análise compartilha somente o PNG e não cria item textual text.txt', () => {
  assert.match(app, /const fileName = `Diario_Medicacao_Analise_\$\{summary\.start\}_\$\{summary\.end\}\.png`/);
  assert.match(app, /await navigator\.share\(\{ files:\[file\] \}\);/);
  assert.doesNotMatch(app, /navigator\.share\(\{ files:\[file\], title:tr\('analysis\.shareTitle'\) \}\)/);
});
