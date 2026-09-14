import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8');

let catalog;
const sandbox = { window: { MMI18n: { registerCatalog(_name, value) { catalog = value; } } } };
vm.runInNewContext(i18nSource, sandbox, { filename: 'i18n.js' });

test('Home mantém ações acima do card de registro em uma única coluna', () => {
  assert.ok(html.indexOf('class="assistente-home-actions"') < html.indexOf('class="panel new-entry mm-card"'));
  assert.match(css, /\.tab-panel__register-wrap\s*\{[^}]*flex-direction:column/s);
  assert.match(css, /\.assistente-home-actions\s*\{[^}]*grid-template-columns:1fr/s);
});

test('Histórico usa lista compacta agrupada no padrão history-day-card', () => {
  assert.match(app, /class="history-day-card"/);
  assert.match(app, /assistente-history-row/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderRecords()'), app.indexOf('function clearHistoryFilters()')), /<article class="record"/);
});

test('Agendamentos reutilizam a linguagem visual do Histórico e não têm rótulos dinâmicos em português fixo', () => {
  const block = app.slice(app.indexOf('function renderSchedules()'), app.indexOf('function renderReminderToggle()'));
  assert.match(block, /history-day-card/);
  assert.match(block, /tr\('assistant\.active'\)/);
  assert.doesNotMatch(block, /Em andamento|Próximos|Concluídos|Nenhum agendamento|doses previstas até agora/);
});

test('Novo agendamento usa secondary sheet canônica e formulário agrupado', () => {
  assert.match(html, /id="scheduleDialog" class="mm-secondary-layer assistente-schedule-layer"/);
  assert.match(html, /class="sheet mm-secondary-sheet assistente-schedule-sheet"/);
  assert.match(html, /class="assistente-form-section"/);
  assert.doesNotMatch(html, /<dialog id="scheduleDialog"/);
  assert.doesNotMatch(app, /scheduleDialog\.showModal\(/);
});

test('Novos textos do Assistente existem em português, inglês e espanhol', () => {
  const keys = [
    'assistant.searchMedication','assistant.newSchedule','assistant.editSchedule','assistant.timing',
    'assistant.summary','assistant.totalDoses','assistant.lastDose','assistant.endsAt',
    'assistant.active','assistant.upcoming','assistant.completed','assistant.noSchedules',
    'assistant.scheduledAnalysis','assistant.scheduledBadge'
  ];
  for (const locale of ['pt-BR','en-US','es-ES']) {
    for (const key of keys) assert.equal(typeof catalog?.[locale]?.[key], 'string', `${locale}: ${key}`);
  }
});

test('Lembretes usam switch visual do app, sem checkbox nativo ampliado', () => {
  assert.match(html, /class="assistente-switch"><input id="remindersToggle"/);
  assert.match(css, /\.assistente-switch input:checked\+i/);
  assert.doesNotMatch(css.slice(css.lastIndexOf('Assistente 1.0')), /assistente-toggle-row input\{[^}]*scale/);
});
