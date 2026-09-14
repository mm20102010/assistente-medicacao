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
    'assistant.nextDose','assistant.fromLabel','assistant.untilLabel','assistant.nextDoseLabel','assistant.noNextDose','assistant.scheduledAnalysis','assistant.scheduledBadge'
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


test('Home mostra Gerenciar remédios antes de Agendar medicamento e mantém espaçamento vertical', () => {
  assert.ok(html.indexOf('id="homeMedicinesBtn"') < html.indexOf('id="homeScheduleBtn"'));
  assert.match(css, /\.tab-panel__register-wrap\s*\{[^}]*gap:20px/s);
  assert.match(css, /\.assistente-home-actions\{[^}]*gap:14px/s);
});

test('sheet de agendamento mantém header fixo e controles editáveis com a mesma altura', () => {
  assert.match(css, /\.assistente-schedule-sheet\{[^}]*display:flex[^}]*overflow:hidden/s);
  assert.match(css, /\.assistente-schedule-form\{[^}]*overflow-y:auto/s);
  assert.match(css, /\.assistente-field-row input,[\s\S]*\.assistente-field-row select\{[\s\S]*height:56px!important/s);
  assert.match(html, /id="scheduleIntervalHours"[^>]*max="248"/);
  assert.match(css, /input\[type="datetime-local"\][\s\S]*text-align:center/s);
});

test('Histórico esconde Limpar filtros sem filtro e não mostra ação Informar alívio nos cards', () => {
  assert.match(css, /#historyFilterActions\[hidden\]\{display:none!important\}/);
  const block = app.slice(app.indexOf('function historyRecordRow'), app.indexOf('function renderRecords'));
  assert.doesNotMatch(block, /quick-relief|relief\.inform|assistente-inline-action/);
  assert.match(css, /\.assistente-history-row\{[\s\S]*height:76px/s);
});

test('Agendamentos exibem intervalo ao lado do nome e progresso como fração', () => {
  const block = app.slice(app.indexOf('function renderSchedules()'), app.indexOf('function renderReminderToggle()'));
  assert.match(block, /assistente-schedule-interval/);
  assert.match(block, /\$\{p\.taken\}\/\$\{p\.planned\}/);
  assert.match(block, /assistant\.fromLabel/);
  assert.match(block, /assistant\.untilLabel/);
  assert.match(block, /assistant\.nextDoseLabel/);
  assert.match(block, /assistente-schedule-period-line/);
  assert.match(block, /assistente-schedule-meta-label/);
  assert.match(block, /assistente-schedule-next/);
  assert.doesNotMatch(block, /→/);
  assert.doesNotMatch(block, /assistant\.ofPlanned/);
});

test('confirmação de baixa antecipada está localizada nos três idiomas', () => {
  const keys=['assistant.linkScheduleTitle','assistant.linkScheduleCopy','assistant.linkScheduleConfirm','assistant.keepEventual'];
  for (const locale of ['pt-BR','en-US','es-ES']) for (const key of keys) assert.equal(typeof catalog?.[locale]?.[key], 'string', `${locale}: ${key}`);
});

test('rótulos de período e próxima dose são localizados nos três idiomas', () => {
  assert.equal(catalog['pt-BR']['assistant.fromLabel'], 'de');
  assert.equal(catalog['pt-BR']['assistant.untilLabel'], 'até');
  assert.equal(catalog['pt-BR']['assistant.nextDoseLabel'], 'Próxima dose');
  assert.equal(catalog['en-US']['assistant.fromLabel'], 'from');
  assert.equal(catalog['en-US']['assistant.untilLabel'], 'until');
  assert.equal(catalog['en-US']['assistant.nextDoseLabel'], 'Next dose');
  assert.equal(catalog['es-ES']['assistant.fromLabel'], 'de');
  assert.equal(catalog['es-ES']['assistant.untilLabel'], 'hasta');
  assert.equal(catalog['es-ES']['assistant.nextDoseLabel'], 'Próxima dosis');
});
