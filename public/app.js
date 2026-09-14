"use strict";

const APP_VERSION = "1.0";
const I18N = window.MMI18n;
const tr = (key, vars = {}) => I18N?.t(key, vars) ?? key;
const trSource = (text, vars = {}) => I18N?.translateSource(text, vars) ?? String(text ?? "");
const DB_NAME = "assistente_medicacao";
const DB_VERSION = 3;
const STORE_NAME = "app_state";
const RECORD_STORE_NAME = "records";
let committedRecordSignatures = new Map();
const STATE_KEY = "main";
const DEFAULT_MEDICINES = [
  "Sumax Pro",
  "Dipirona",
  "Dorflex",
  "Sumax",
  "Bi-Profenid",
  "Allegra D",
  "Buscopan"
];
const DEFAULT_RELIEF = "Não definido";
const RELIEF_PRESET_VALUES = ["30 minutos", "1 hora", "2 horas", "3 horas", "Sem alívio", "Não definido"];
const HISTORY_RENDER_BATCH = 250;
const DIAGNOSTIC_REVISION = '1.0';
const DIAGNOSTIC_MODE_KEY = 'assistente.diagnosticMode.v1';
const DIAGNOSTIC_TRACE_KEY = 'assistente.diagnosticTrace.v1';
const DIAGNOSTIC_TRACE_LIMIT = 500;

const $ = id => document.getElementById(id);
const els = {};
let db = null;
let state = { version: 2, records: [], medicines: [...DEFAULT_MEDICINES], schedules: [], remindersEnabled: true };
let lastNativeMedicinesSignature = null;
let nativeMedicineSyncTail = Promise.resolve();
let pendingImport = null;
let toastTimer = null;
let activeSheet = null;
let currentTab = "register";
let mmAppShell = null;
let entryDateTimeAuto = true;
let entryDateTimeTimer = null;
let singleFileExportInProgress = false;
let recordSaveInProgress = false;
let pendingScheduledNotificationContext = null;
let watchEventSyncInProgress = false;
let watchEventSyncRequested = false;
let watchEventSyncPromise = null;
let dataResetInProgress = false;
let stateWriteTail = Promise.resolve();
let stateWriteRevision = 0;
let lastPersistedStateRevision = 0;
let lastNativeWatchPendingCount = 0;
const filterSelections = { history: { dates: [], medicines: [] }, export: { dates: [], medicines: [] } };
let currentMultiFilter = { scope: "history", type: "dates" };
let tabbarSuspendUntil = 0;
let analysisSelection = { start: "", end: "" };
let analysisRangePreset = "all";
let lastAnalysisSummary = null;
let analysisDateRangeControl = null;
let exportDateRangeControl = null;
let historyRenderLimit = HISTORY_RENDER_BATCH;

const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_MAP = {
  jan:1, january:1, janeiro:1, ene:1, enero:1,
  feb:2, fev:2, february:2, fevereiro:2, febrero:2,
  mar:3, march:3, março:3, marco:3, marzo:3,
  apr:4, abr:4, april:4, abril:4,
  may:5, mai:5, maio:5, mayo:5,
  jun:6, june:6, junho:6, junio:6,
  jul:7, july:7, julho:7, julio:7,
  aug:8, ago:8, august:8, agosto:8,
  sep:9, sept:9, set:9, september:9, setembro:9, septiembre:9, setiembre:9,
  oct:10, out:10, october:10, outubro:10, octubre:10,
  nov:11, november:11, novembro:11, noviembre:11,
  dec:12, dez:12, december:12, dezembro:12, dic:12, diciembre:12
};

function diagnosticModeEnabled() {
  try { return localStorage.getItem(DIAGNOSTIC_MODE_KEY) === '1'; }
  catch { return false; }
}

function initializeDiagnosticMode() {
  const enabled = diagnosticModeEnabled();
  if (!enabled) {
    try { localStorage.removeItem(DIAGNOSTIC_TRACE_KEY); } catch {}
  }
  return enabled;
}

function readDiagnosticTrace() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIAGNOSTIC_TRACE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function diagnosticStateSnapshot(extra = {}) {
  return {
    at:new Date().toISOString(),
    recordCount:Array.isArray(state?.records) ? state.records.length : 0,
    medicineCount:Array.isArray(state?.medicines) ? state.medicines.length : 0,
    scheduleCount:Array.isArray(state?.schedules) ? state.schedules.length : 0,
    watchSyncInProgress:Boolean(watchEventSyncInProgress),
    watchSyncRequested:Boolean(watchEventSyncRequested),
    nativeWatchPendingCount:Number(lastNativeWatchPendingCount || 0),
    stateWriteRevision:Number(stateWriteRevision || 0),
    lastPersistedStateRevision:Number(lastPersistedStateRevision || 0),
    dataResetInProgress:Boolean(dataResetInProgress),
    visibility:document?.visibilityState || null,
    locale:I18N?.locale || null,
    timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    runtime:window.MMNative?.platform || 'web',
    ...extra
  };
}

function diagnosticTrace(event, extra = {}) {
  if (!diagnosticModeEnabled()) return;
  try {
    const trace = readDiagnosticTrace();
    trace.push({ event, ...diagnosticStateSnapshot(extra) });
    localStorage.setItem(DIAGNOSTIC_TRACE_KEY, JSON.stringify(trace.slice(-DIAGNOSTIC_TRACE_LIMIT)));
  } catch (error) {
    console.warn('[DIAG] Falha ao registrar diagnóstico:', error);
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function cleanField(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return cleanField(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function canonicalRelief(value) {
  const raw = cleanField(value);
  const aliases = {
    '30 minutos':'30 minutos','30 minutes':'30 minutos',
    '1 hora':'1 hora','1 hour':'1 hora',
    '2 horas':'2 horas','2 hours':'2 horas',
    '3 horas':'3 horas','3 hours':'3 horas',
    'sem alivio':'Sem alívio','no relief':'Sem alívio','sin alivio':'Sem alívio',
    'nao definido':'Não definido','not defined':'Não definido','no definido':'Não definido','sin definir':'Não definido'
  };
  return aliases[normalizeKey(raw)] || raw || DEFAULT_RELIEF;
}

function localizedRelief(value) {
  const canonical = canonicalRelief(value);
  const key = normalizeKey(canonical);
  if (key === normalizeKey('30 minutos')) return tr('relief.value30');
  if (key === normalizeKey('1 hora')) return tr('relief.value1');
  if (key === normalizeKey('2 horas')) return tr('relief.value2');
  if (key === normalizeKey('3 horas')) return tr('relief.value3');
  if (key === normalizeKey('Sem alívio')) return tr('relief.noRelief');
  if (key === normalizeKey(DEFAULT_RELIEF)) return tr('relief.undefined');
  return cleanField(value);
}

function uniqueMedicines(items) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const medicine = cleanField(item);
    const key = normalizeKey(medicine);
    if (!medicine || seen.has(key)) continue;
    seen.add(key);
    result.push(medicine.slice(0, 80));
  }
  return result.length ? result.slice(0, 200) : [...DEFAULT_MEDICINES];
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function validDateParts(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseDateTimeText(value) {
  const raw = cleanField(value);
  if (!raw) return null;

  const to24Hour = (hour, marker) => {
    let h = Number(hour);
    if (!marker) return h;
    const pm = /^p/i.test(marker);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return h;
  };

  // ISO date/time is stable across all locales.
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+|\s+(?:às|at|a las)\s+)?(\d{1,2})?[:h](\d{2})?\s*([ap]\.?m\.?)?/i);
  if (m) {
    const year = +m[1], month = +m[2], day = +m[3];
    const hour = m[4] == null ? 0 : to24Hour(m[4], m[6]), minute = m[5] == null ? 0 : +m[5];
    if (validDateParts(year, month, day) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { date:`${year}-${pad2(month)}-${pad2(day)}`, time:`${pad2(hour)}:${pad2(minute)}` };
  }

  // en-US export: MM/DD/YYYY at h:mm AM/PM. "at"/AM/PM removes ambiguity.
  m = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s+(?:at\s+)?(\d{1,2})[:h](\d{2})\s*([ap]\.?m\.?)$/i);
  if (!m && /\sat\s/i.test(raw)) m = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s+at\s+(\d{1,2})[:h](\d{2})(?:\s*([ap]\.?m\.?))?$/i);
  if (m) {
    let year = +m[3]; if (year < 100) year += year >= 70 ? 1900 : 2000;
    const month=+m[1], day=+m[2], hour=to24Hour(m[4],m[6]), minute=+m[5];
    if (validDateParts(year,month,day) && hour>=0 && hour<=23 && minute>=0 && minute<=59) return { date:`${year}-${pad2(month)}-${pad2(day)}`, time:`${pad2(hour)}:${pad2(minute)}` };
  }

  // pt-BR / es-ES: DD/MM/YYYY às|a las HH:mm (connector optional for legacy files).
  m = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(?:(?:às|as|a las)\s*)?)?(\d{1,2})?[:h](\d{2})?/i);
  if (m) {
    let year=+m[3]; if(year<100) year += year>=70?1900:2000;
    const month=+m[2], day=+m[1], hour=m[4]==null?0:+m[4], minute=m[5]==null?0:+m[5];
    if(validDateParts(year,month,day)&&hour>=0&&hour<=23&&minute>=0&&minute<=59) return {date:`${year}-${pad2(month)}-${pad2(day)}`,time:`${pad2(hour)}:${pad2(minute)}`};
  }

  // Named months in English, Portuguese or Spanish.
  m = raw.match(/^(\d{1,2})[\/.-]([\p{L}.]+)[\/.-](\d{2,4})(?:\s+(?:às|as|at|a las)?\s*)?(\d{1,2})?[:h](\d{2})?\s*([ap]\.?m\.?)?/iu);
  if (m) {
    let year=+m[3]; if(year<100) year += year>=70?1900:2000;
    const month=MONTH_MAP[normalizeKey(m[2].replace(/\./g,''))], day=+m[1], hour=m[4]==null?0:to24Hour(m[4],m[6]), minute=m[5]==null?0:+m[5];
    if(month&&validDateParts(year,month,day)&&hour>=0&&hour<=23&&minute>=0&&minute<=59) return {date:`${year}-${pad2(month)}-${pad2(day)}`,time:`${pad2(hour)}:${pad2(minute)}`};
  }
  return null;
}

function formatShortcutDate(record) {
  const date = recordDateObject(record);
  if (!date) return cleanField(record.rawDate || '');
  return I18N?.formatDateTime(date) || formatDisplayDate(record);
}

function formatDisplayDate(record) {
  const date = recordDateObject(record);
  if (!date) return cleanField(record.rawDate || tr('date.unrecognized'));
  return I18N?.formatDateTime(date) || `${pad2(date.getDate())}/${pad2(date.getMonth()+1)}/${date.getFullYear()} às ${record.time || '00:00'}`;
}

function formatDateOnly(record) {
  const date = recordDateObject(record);
  if (!date) return cleanField(record.rawDate || tr('date.unrecognized')).split(/\s+(?:às|at|a las)\s+/i)[0];
  return I18N?.formatDate(date, { day:'2-digit', month:'2-digit', year:'numeric' }) || `${pad2(date.getDate())}/${pad2(date.getMonth()+1)}/${date.getFullYear()}`;
}

function recordDateObject(record) {
  const match = String(record?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = String(record?.time || '00:00').match(/^(\d{2}):(\d{2})$/);
  if (!match || !time) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(time[1]), Number(time[2]), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimeOnly(record) {
  const date = recordDateObject(record);
  if (!date) return /^\d{2}:\d{2}$/.test(record?.time || '') ? record.time : '00:00';
  const locale = I18N?.locale || 'pt-BR';
  return new Intl.DateTimeFormat(locale, locale === 'en-US' ? { hour:'numeric', minute:'2-digit', hour12:true } : { hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(date);
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const ka = `${a.date || "0000-00-00"}T${a.time || "00:00"}`;
    const kb = `${b.date || "0000-00-00"}T${b.time || "00:00"}`;
    if (ka !== kb) return kb.localeCompare(ka);
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function sortRecordsAscending(records) {
  return [...records].sort((a, b) => {
    const ka = `${a.date || "0000-00-00"}T${a.time || "00:00"}`;
    const kb = `${b.date || "0000-00-00"}T${b.time || "00:00"}`;
    if (ka !== kb) return ka.localeCompare(kb);
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function sanitizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const medicine = cleanField(record.medicine).slice(0, 80);
  const relief = canonicalRelief(record.relief || DEFAULT_RELIEF).slice(0, 100) || DEFAULT_RELIEF;
  let date = cleanField(record.date);
  let time = cleanField(record.time);
  let rawDate = cleanField(record.rawDate);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    const parsed = parseDateTimeText(rawDate || date);
    if (parsed) {
      date = parsed.date;
      time = parsed.time;
      rawDate = "";
    }
  }

  if (!medicine) return null;
  const scheduleId = cleanField(record.scheduleId).slice(0, 100);
  const scheduledAtRaw = cleanField(record.scheduledAt).slice(0, 64);
  const scheduledAt = scheduleId && scheduledAtRaw && !Number.isNaN(new Date(scheduledAtRaw).getTime()) ? scheduledAtRaw : "";
  return {
    id: cleanField(record.id) || makeId(),
    date,
    time,
    rawDate,
    medicine,
    relief,
    scheduleId: scheduledAt ? scheduleId : "",
    scheduledAt,
    createdAt: cleanField(record.createdAt) || new Date().toISOString(),
    updatedAt: cleanField(record.updatedAt) || new Date().toISOString()
  };
}


function sanitizeScheduleRevision(revision) {
  if (!revision || typeof revision !== "object") return null;
  const medicine = cleanField(revision.medicine).slice(0,80);
  const intervalMinutes = Math.round(Number(revision.intervalMinutes));
  const planStartAt = cleanField(revision.planStartAt || revision.startAt).slice(0,64);
  const endAt = cleanField(revision.endAt).slice(0,64);
  const effectiveFrom = cleanField(revision.effectiveFrom || planStartAt).slice(0,64);
  if (!medicine || intervalMinutes < 60 || intervalMinutes > 14880) return null;
  if ([planStartAt,endAt,effectiveFrom].some(v => Number.isNaN(new Date(v).getTime()))) return null;
  if (new Date(endAt) <= new Date(planStartAt)) return null;
  return { id:cleanField(revision.id)||makeId(), effectiveFrom, medicine, intervalMinutes, planStartAt, endAt };
}
function sanitizeSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") return null;
  let revisions = (Array.isArray(schedule.revisions) ? schedule.revisions : [schedule]).map(sanitizeScheduleRevision).filter(Boolean);
  if (!revisions.length) return null;
  revisions.sort((a,b)=>new Date(a.effectiveFrom)-new Date(b.effectiveFrom));
  return { id:cleanField(schedule.id)||makeId(), status:schedule.status==='cancelled'?'cancelled':'active', createdAt:cleanField(schedule.createdAt)||new Date().toISOString(), updatedAt:cleanField(schedule.updatedAt)||new Date().toISOString(), revisions };
}
function currentScheduleRevision(schedule, at = new Date()) {
  const revisions = schedule?.revisions || [];
  let selected = revisions[0] || null;
  for (const revision of revisions) if (new Date(revision.effectiveFrom) <= at) selected = revision;
  return selected;
}
function scheduleOccurrences(schedule, rangeStart = new Date(0), rangeEnd = new Date(8640000000000000)) {
  if (!schedule || schedule.status === 'cancelled') return [];
  const revisions = schedule.revisions || [];
  const out = [];
  revisions.forEach((revision,index)=>{
    const nextEffective = revisions[index+1]?.effectiveFrom ? new Date(revisions[index+1].effectiveFrom) : null;
    const start = new Date(revision.planStartAt), end = new Date(revision.endAt), effective = new Date(revision.effectiveFrom);
    if ([start,end,effective].some(d=>Number.isNaN(d.getTime()))) return;
    const segmentStart = new Date(Math.max(start.getTime(), effective.getTime(), rangeStart.getTime()));
    const segmentEnd = new Date(Math.min(end.getTime(), nextEffective?.getTime() ?? end.getTime(), rangeEnd.getTime()));
    const step = revision.intervalMinutes * 60000;
    let n = Math.max(0, Math.ceil((segmentStart.getTime() - start.getTime()) / step));
    for (let t=start.getTime()+n*step; t < segmentEnd.getTime(); t += step) out.push({ scheduleId:schedule.id, medicine:revision.medicine, at:new Date(t), revisionId:revision.id });
  });
  return out;
}
function allScheduleOccurrences(rangeStart, rangeEnd) { return state.schedules.flatMap(s=>scheduleOccurrences(s,rangeStart,rangeEnd)).sort((a,b)=>a.at-b.at); }
function scheduledOccurrenceKey(scheduleId, at) {
  const time = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return scheduleId && Number.isFinite(time) ? `${scheduleId}|${time}` : '';
}
function recordScheduledOccurrenceKey(record) {
  return scheduledOccurrenceKey(cleanField(record?.scheduleId), record?.scheduledAt);
}
function usedScheduledOccurrenceKeys(excludeRecordId = '') {
  const used = new Set();
  for (const record of state.records) {
    if (excludeRecordId && record.id === excludeRecordId) continue;
    const key = recordScheduledOccurrenceKey(record);
    if (key) used.add(key);
  }
  return used;
}
function matchScheduledOccurrence(record, toleranceMinutes = 180, { excludeRecordId = '' } = {}) {
  const actual = recordDateObject(record); if (!actual) return null;
  const used = usedScheduledOccurrenceKeys(excludeRecordId);
  const futureAutoMs = 60 * 1000;
  const candidates = allScheduleOccurrences(
    new Date(actual.getTime()-toleranceMinutes*60000),
    new Date(actual.getTime()+futureAutoMs+1)
  ).filter(o => normalizeKey(o.medicine)===normalizeKey(record.medicine) && !used.has(scheduledOccurrenceKey(o.scheduleId,o.at)));
  if (!candidates.length) return null;
  return candidates.sort((a,b)=>{
    const da=a.at.getTime()-actual.getTime(), db=b.at.getTime()-actual.getTime();
    const distance=Math.abs(da)-Math.abs(db);
    if (distance) return distance;
    return da-db; // empate: prefere a dose já vencida à futura
  })[0];
}
function nextOpenScheduledOccurrence(medicine, actual, { excludeRecordId = '' } = {}) {
  if (!(actual instanceof Date) || Number.isNaN(actual.getTime())) return null;
  const medicineKey=normalizeKey(medicine);
  const used=usedScheduledOccurrenceKeys(excludeRecordId);
  let best=null;
  for (const schedule of state.schedules) {
    if (!schedule || schedule.status==='cancelled') continue;
    const revisions=schedule.revisions||[];
    for (let index=0; index<revisions.length; index++) {
      const revision=revisions[index];
      if (normalizeKey(revision.medicine)!==medicineKey) continue;
      const start=new Date(revision.planStartAt), effective=new Date(revision.effectiveFrom), end=new Date(revision.endAt);
      const nextEffective=revisions[index+1]?.effectiveFrom ? new Date(revisions[index+1].effectiveFrom) : null;
      if ([start,effective,end].some(d=>Number.isNaN(d.getTime()))) continue;
      const segmentStart=Math.max(start.getTime(),effective.getTime());
      const segmentEnd=Math.min(end.getTime(),nextEffective?.getTime() ?? end.getTime());
      if (segmentEnd<=actual.getTime()) continue;
      const step=revision.intervalMinutes*60000;
      let target=Math.max(actual.getTime(),segmentStart);
      let n=Math.max(0,Math.ceil((target-start.getTime())/step));
      let t=start.getTime()+n*step;
      if (t<segmentStart) { n=Math.ceil((segmentStart-start.getTime())/step); t=start.getTime()+n*step; }
      while (t<segmentEnd && used.has(scheduledOccurrenceKey(schedule.id,new Date(t)))) t+=step;
      if (t>=segmentEnd) continue;
      const candidate={scheduleId:schedule.id,medicine:revision.medicine,at:new Date(t),revisionId:revision.id};
      if (!best || candidate.at<best.at) best=candidate;
    }
  }
  return best;
}
function annotateRecordWithSchedule(record, options = {}) {
  const match = matchScheduledOccurrence(record, options.toleranceMinutes ?? 180, options);
  record.scheduleId = match?.scheduleId || '';
  record.scheduledAt = match?.at?.toISOString?.() || '';
  return record;
}
function isOccurrenceConsumed(occurrence, excludeRecordId = '') {
  const key=scheduledOccurrenceKey(occurrence?.scheduleId,occurrence?.at);
  if (!key) return false;
  return state.records.some(record=>record.id!==excludeRecordId && recordScheduledOccurrenceKey(record)===key);
}
function repairNearScheduleAssociations() {
  if (!state.schedules.length || !state.records.length) return 0;
  let changed=0;
  const used=new Set(state.records.map(recordScheduledOccurrenceKey).filter(Boolean));
  const ordered=[...state.records].sort((a,b)=>(recordDateObject(a)?.getTime()||0)-(recordDateObject(b)?.getTime()||0));
  for (const record of ordered) {
    if (record.scheduleId && record.scheduledAt) continue;
    const actual=recordDateObject(record); if(!actual) continue;
    const candidates=allScheduleOccurrences(new Date(actual.getTime()-60000),new Date(actual.getTime()+60001))
      .filter(o=>normalizeKey(o.medicine)===normalizeKey(record.medicine) && !used.has(scheduledOccurrenceKey(o.scheduleId,o.at)))
      .sort((a,b)=>Math.abs(a.at-actual)-Math.abs(b.at-actual));
    const match=candidates[0];
    if (!match) continue;
    record.scheduleId=match.scheduleId;
    record.scheduledAt=match.at.toISOString();
    used.add(scheduledOccurrenceKey(match.scheduleId,match.at));
    changed++;
  }
  return changed;
}
function scheduledDoseStats(start = new Date(new Date().setHours(0,0,0,0)), end = new Date(new Date().setHours(23,59,59,999))) {
  const occurrences = allScheduleOccurrences(start,end);
  const records = state.records.filter(r=>r.scheduleId && r.scheduledAt);
  let taken=0,onTime=0;
  for (const occ of occurrences) {
    const matches=records.filter(r=>r.scheduleId===occ.scheduleId && Math.abs(new Date(r.scheduledAt)-occ.at)<60000);
    if (matches.length) { taken++; const best=matches.map(recordDateObject).filter(Boolean).sort((a,b)=>Math.abs(a-occ.at)-Math.abs(b-occ.at))[0]; if(best && Math.abs(best-occ.at)<=30*60000) onTime++; }
  }
  return { planned:occurrences.length, taken, onTime, adherence:occurrences.length?Math.round(taken/occurrences.length*100):0, punctuality:taken?Math.round(onTime/taken*100):0 };
}
function medicationProjectionForWatch() {
  const now=new Date(), horizon=new Date(now.getTime()+72*3600000);
  const openOccurrences=allScheduleOccurrences(new Date(now.getTime()-12*3600000),horizon).filter(o=>!isOccurrenceConsumed(o));
  const occurrences=openOccurrences.map(o=>({scheduleId:o.scheduleId,medicine:o.medicine,at:o.at.toISOString()}));
  const todayStart=new Date(); todayStart.setHours(0,0,0,0); const todayEnd=new Date(todayStart.getTime()+86400000);
  const stats=scheduledDoseStats(todayStart,todayEnd); const next=openOccurrences.find(o=>o.at>now);
  return { occurrences, todayPlanned:stats.planned, todayTaken:stats.taken, nextScheduledAt:next?.at?.toISOString?.()||null };
}
function validateState(input) {
  const raw = input && typeof input === "object" ? input : {};
  const schedules = (Array.isArray(raw.schedules) ? raw.schedules : []).map(sanitizeSchedule).filter(Boolean);
  const records = (Array.isArray(raw.records) ? raw.records : []).map(sanitizeRecord).filter(Boolean);
  let medicines = uniqueMedicines(raw.medicines || DEFAULT_MEDICINES);
  medicines = uniqueMedicines([...medicines, ...records.map(r => r.medicine), ...schedules.flatMap(s => s.revisions.map(r => r.medicine))]);
  return { version: 2, records: sortRecords(records), medicines, schedules, remindersEnabled: raw.remindersEnabled !== false };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      if (!database.objectStoreNames.contains(RECORD_STORE_NAME)) {
        const records = database.createObjectStore(RECORD_STORE_NAME, { keyPath:'id' });
        records.createIndex('date', 'date');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error(tr('error.localStorage')));
  });
}

function dbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, RECORD_STORE_NAME], "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    let result;
    request.onsuccess = () => {
      result = request.result;
      if (result?.recordStorageVersion === 2) {
        const records = tx.objectStore(RECORD_STORE_NAME).getAll();
        records.onsuccess = () => { result = { ...result, records:records.result }; };
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error(tr('error.localStorage')));
  });
}

function dbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, RECORD_STORE_NAME], "readwrite");
    const records = tx.objectStore(RECORD_STORE_NAME);
    const next = new Map();
    try {
      for (const record of value.records) {
        if (next.has(record.id)) throw new Error('Duplicate record ID: ' + record.id);
        const signature = JSON.stringify(record);
        next.set(record.id, signature);
        if (committedRecordSignatures.get(record.id) !== signature) records.put(record);
      }
      for (const id of committedRecordSignatures.keys()) {
        if (!next.has(id)) records.delete(id);
      }
      // Metadata and record mutations commit together, including legacy migration.
      const { records:ignored, ...metadata } = value;
      tx.objectStore(STORE_NAME).put({ ...metadata, recordStorageVersion:2 }, key);
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already be aborted */ }
      reject(error);
      return;
    }
    tx.oncomplete = () => { committedRecordSignatures = next; resolve(); };
    tx.onerror = () => reject(tx.error || new Error(tr('error.save')));
    tx.onabort = () => reject(tx.error || new Error(tr('error.cancelled')));
  });
}

function watchTextsForNative() {
  return {
    title: tr('watch.title'),
    waitingPhone: tr('watch.waitingPhone'),
    sending: tr('watch.sending'),
    waitingPhoneShort: tr('watch.waitingPhoneShort'),
    queued: tr('watch.queued'),
    saveFailed: tr('watch.saveFailed'),
    registeredFormat: tr('watch.registeredFormat')
  };
}

function syncMedicinesToNative({ force = false } = {}) {
  if (!window.MMNative?.isIOS || typeof window.MMNative?.syncMedicines !== "function") return;

  const medicines = uniqueMedicines(state.medicines);
  const locale = I18N?.locale || 'pt-BR';
  const texts = watchTextsForNative();
  const projection = typeof medicationProjectionForWatch === 'function' ? medicationProjectionForWatch() : {};
  const signature = JSON.stringify({ medicines, locale, texts, projection });
  if (!force && signature === lastNativeMedicinesSignature) return;

  // Mark before the asynchronous bridge call so rapid consecutive saves do not
  // enqueue the same list repeatedly. A rejected call clears the signature and
  // lets the next state change retry naturally.
  lastNativeMedicinesSignature = signature;
  diagnosticTrace('WATCH_MEDICINES_SYNC_QUEUED', { medicineCount:medicines.length, locale });

  const run = async () => {
    diagnosticTrace('WATCH_MEDICINES_SYNC_BEGIN', { medicineCount:medicines.length, locale });
    try {
      const result = await window.MMNative.syncMedicines(medicines, { locale, texts, projection });
      diagnosticTrace('WATCH_MEDICINES_SYNC_RESULT', { accepted:Boolean(result?.accepted), delivered:Boolean(result?.delivered), medicineCount:medicines.length });
      if (result?.accepted === false && lastNativeMedicinesSignature === signature) {
        lastNativeMedicinesSignature = null;
      }
      return result;
    } catch (error) {
      if (lastNativeMedicinesSignature === signature) lastNativeMedicinesSignature = null;
      diagnosticTrace('WATCH_MEDICINES_SYNC_ERROR', { message:String(error?.message || error) });
      console.warn("Não foi possível sincronizar os remédios com o Apple Watch:", error);
      throw error;
    }
  };

  const execution = nativeMedicineSyncTail.then(run, run);
  nativeMedicineSyncTail = execution.catch(() => {});
  return execution;
}

function watchMedicationEventToRecord(event) {
  const id = cleanField(event?.id).slice(0, 100);
  const medicine = cleanField(event?.medicine).slice(0, 80);
  const occurredAt = cleanField(event?.occurredAt).slice(0, 64);
  if (!id || !medicine || !occurredAt) return null;

  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) return null;

  let date = cleanField(event?.localDate).slice(0, 10);
  let time = cleanField(event?.localTime).slice(0, 5);

  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  const validWatchDate = dateMatch && validDateParts(+dateMatch[1], +dateMatch[2], +dateMatch[3]);
  const validWatchTime = timeMatch && +timeMatch[1] >= 0 && +timeMatch[1] <= 23 && +timeMatch[2] >= 0 && +timeMatch[2] <= 59;

  // Prefer the Watch-local date/time captured at the tap. If an older native
  // payload lacks it, derive a safe local fallback from the absolute timestamp.
  if (!validWatchDate || !validWatchTime) {
    date = `${occurred.getFullYear()}-${pad2(occurred.getMonth() + 1)}-${pad2(occurred.getDate())}`;
    time = `${pad2(occurred.getHours())}:${pad2(occurred.getMinutes())}`;
  }

  const rawScheduleId = cleanField(event?.scheduleId).slice(0,100);
  const rawScheduledAt = cleanField(event?.scheduledAt).slice(0,64);
  const scheduledAtDate = rawScheduledAt ? new Date(rawScheduledAt) : null;
  const hasExactScheduleContext = rawScheduleId && scheduledAtDate && !Number.isNaN(scheduledAtDate.getTime());
  const record = sanitizeRecord({
    id,
    date,
    time,
    rawDate: "",
    medicine,
    relief: DEFAULT_RELIEF,
    scheduleId: hasExactScheduleContext ? rawScheduleId : "",
    scheduledAt: hasExactScheduleContext ? scheduledAtDate.toISOString() : "",
    createdAt: occurred.toISOString(),
    updatedAt: occurred.toISOString()
  });
  return record.scheduleId ? record : annotateRecordWithSchedule(record);
}

async function persistedRecordIDSet() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORD_STORE_NAME, 'readonly');
    const request = tx.objectStore(RECORD_STORE_NAME).getAllKeys();
    tx.oncomplete = () => resolve(new Set(request.result));
    tx.onerror = tx.onabort = () => reject(tx.error || new Error(tr('error.localStorage')));
  });
}

async function persistedRecordIDsContain(ids, persisted = null) {
  if (!ids.length) return true;
  const confirmed = persisted || await persistedRecordIDSet();
  return ids.every(id => confirmed.has(id));
}

async function syncWatchMedicationEventsFromNative({ render = true } = {}) {
  if (dataResetInProgress) {
    watchEventSyncRequested = true;
    diagnosticTrace('WATCH_DRAIN_DEFERRED_RESET');
    return { added: 0, acknowledged: 0, deferred: true };
  }
  if (watchEventSyncInProgress) {
    watchEventSyncRequested = true;
    diagnosticTrace('WATCH_DRAIN_COALESCED');
    return { added: 0, acknowledged: 0, deferred: true };
  }
  if (!window.MMNative?.isIOS || typeof window.MMNative?.getWatchMedicationEvents !== "function") {
    return { added: 0, acknowledged: 0 };
  }

  watchEventSyncInProgress = true;
  const execution = (async () => {
    diagnosticTrace('WATCH_DRAIN_BEGIN');
    const events = await window.MMNative.getWatchMedicationEvents();
    lastNativeWatchPendingCount = Array.isArray(events) ? events.length : 0;
    diagnosticTrace('WATCH_DRAIN_NATIVE_EVENTS', { eventCount:lastNativeWatchPendingCount, eventIds:(events || []).map(event => cleanField(event?.id)).filter(Boolean).slice(0, 50) });
    if (!Array.isArray(events) || !events.length) return { added: 0, acknowledged: 0 };

    const existingIds = new Set(state.records.map(record => cleanField(record.id)));
    const acceptedEventIds = [];
    const duplicateOccurrenceEventIds = new Set();
    const addedRecords = [];

    for (const event of events) {
      const record = watchMedicationEventToRecord(event);
      if (!record) {
        diagnosticTrace('WATCH_EVENT_INVALID', { eventId:cleanField(event?.id) || null });
        console.warn("Evento inválido recebido do Apple Watch; mantido pendente para diagnóstico:", event);
        continue;
      }

      acceptedEventIds.push(record.id);
      if (existingIds.has(record.id)) {
        diagnosticTrace('WATCH_EVENT_ALREADY_PRESENT', { eventId:record.id });
        continue;
      }
      const duplicateScheduledOccurrence = Boolean(record.scheduleId && record.scheduledAt) && state.records.some(existing =>
        cleanField(existing.scheduleId) === cleanField(record.scheduleId) &&
        cleanField(existing.scheduledAt) === cleanField(record.scheduledAt)
      );
      if (duplicateScheduledOccurrence) {
        duplicateOccurrenceEventIds.add(record.id);
        diagnosticTrace('WATCH_EVENT_SCHEDULE_OCCURRENCE_ALREADY_PRESENT', { eventId:record.id, scheduleId:record.scheduleId, scheduledAt:record.scheduledAt });
        continue;
      }

      existingIds.add(record.id);
      state.records.push(record);
      addedRecords.push(record);
      diagnosticTrace('WATCH_EVENT_ADDED_TO_MEMORY', { eventId:record.id, medicine:record.medicine, occurredAt:record.createdAt });
    }

    let persistedIDs = null;
    if (addedRecords.length) {
      try {
        await saveState({ reason:'watch-drain' });
        const addedIds = addedRecords.map(record => record.id);
        persistedIDs = await persistedRecordIDSet();
        if (!await persistedRecordIDsContain(addedIds, persistedIDs)) {
          throw new Error('Persistência IndexedDB do evento do Watch não pôde ser confirmada.');
        }
        diagnosticTrace('WATCH_EVENTS_PERSISTED', { eventIds:addedIds });
      } catch (error) {
        const addedIds = new Set(addedRecords.map(record => record.id));
        state.records = state.records.filter(record => !addedIds.has(record.id));
        diagnosticTrace('WATCH_EVENTS_PERSIST_ERROR', { eventIds:[...addedIds], message:String(error?.message || error) });
        throw error;
      }

      if (render) renderAll();
      if (typeof reconcileMedicationNotifications === 'function') { try { await reconcileMedicationNotifications(); } catch (notificationError) { console.warn('Falha ao reconciliar lembretes após registro do Watch:', notificationError); } }
    }

    let acknowledged = 0;
    if (typeof window.MMNative?.acknowledgeWatchMedicationEvent === "function") {
      if (!persistedIDs) persistedIDs = await persistedRecordIDSet();
      for (const id of acceptedEventIds) {
        if (!persistedIDs.has(id) && !duplicateOccurrenceEventIds.has(id)) {
          diagnosticTrace('WATCH_EVENT_ACK_SKIPPED_NOT_PERSISTED', { eventId:id });
          continue;
        }
        const result = await window.MMNative.acknowledgeWatchMedicationEvent(id);
        diagnosticTrace('WATCH_EVENT_ACK_RESULT', { eventId:id, acknowledged:Boolean(result?.acknowledged) });
        if (result?.acknowledged === true) acknowledged += 1;
      }
    }

    lastNativeWatchPendingCount = Math.max(0, lastNativeWatchPendingCount - acknowledged);
    return { added: addedRecords.length, acknowledged };
  })();
  watchEventSyncPromise = execution;

  try {
    return await execution;
  } catch (error) {
    console.error("Falha ao incorporar registros do Apple Watch:", error);
    diagnosticTrace('WATCH_DRAIN_ERROR', { message:String(error?.message || error) });
    return { added: 0, acknowledged: 0, error };
  } finally {
    if (watchEventSyncPromise === execution) watchEventSyncPromise = null;
    watchEventSyncInProgress = false;
    diagnosticTrace('WATCH_DRAIN_END');

    if (watchEventSyncRequested && !dataResetInProgress) {
      watchEventSyncRequested = false;
      queueMicrotask(() => {
        syncWatchMedicationEventsFromNative({ render }).catch(error => {
          console.warn("Falha ao processar novo registro enfileirado do Apple Watch:", error);
        });
      });
    }
  }
}

function bindNativeWatchEventRecovery() {
  if (!window.MMNative?.isIOS) return;

  // Igual ao Dentes: a notificação nativa de um novo registro do Watch é uma
  // oportunidade de persistência, não apenas de UI. Se a WebView ainda está
  // executando, drena imediatamente mesmo quando está hidden; o IndexedDB +
  // readback continuam sendo a condição para o ACK definitivo ao Watch.
  const onNativeMedicationEvent = event => {
    diagnosticTrace('WATCH_RECOVERY_TRIGGER', { trigger:event?.type || 'mm:watch-medication-event-available', hidden:Boolean(document.hidden) });
    syncWatchMedicationEventsFromNative().catch(error => {
      console.warn("Falha ao incorporar registro recebido do Apple Watch:", error);
    });
  };

  // focus/visibilitychange permanecem como rede de recuperação para o caso de
  // o iOS ter suspendido a WebView e o callback nativo não ter sido executado.
  const recoverVisible = event => {
    diagnosticTrace('WATCH_RECOVERY_TRIGGER', { trigger:event?.type || 'manual', hidden:Boolean(document.hidden) });
    if (document.hidden) return;
    syncWatchMedicationEventsFromNative().catch(error => {
      console.warn("Falha ao recuperar registros pendentes do Apple Watch:", error);
    });
  };

  window.addEventListener("mm:watch-medication-event-available", onNativeMedicationEvent);
  document.addEventListener("visibilitychange", recoverVisible);
  window.addEventListener("focus", recoverVisible);
}

function clearScheduledNotificationContext() {
  pendingScheduledNotificationContext = null;
}

function scheduledOccurrenceFromNotificationContext(context = pendingScheduledNotificationContext) {
  if (!context) return null;
  const scheduleId=cleanField(context.scheduleId).slice(0,100);
  const medicine=cleanField(context.medicine).slice(0,80);
  const scheduledAt=new Date(cleanField(context.scheduledAt).slice(0,64));
  if (!scheduleId || !medicine || Number.isNaN(scheduledAt.getTime())) return null;
  const schedule=state.schedules.find(item=>item.id===scheduleId && item.status!=='cancelled');
  if (!schedule) return null;
  const match=scheduleOccurrences(schedule,new Date(scheduledAt.getTime()-1),new Date(scheduledAt.getTime()+1))
    .find(item=>item.at.getTime()===scheduledAt.getTime() && normalizeKey(item.medicine)===normalizeKey(medicine));
  return match || null;
}

async function applyScheduledNotificationContext(context) {
  const medicine=cleanField(context?.medicine).slice(0,80);
  const scheduleId=cleanField(context?.scheduleId).slice(0,100);
  const scheduledAt=cleanField(context?.scheduledAt).slice(0,64);
  if (!medicine || !scheduleId || Number.isNaN(new Date(scheduledAt).getTime())) return false;
  const normalizedContext={medicine,scheduleId,scheduledAt};
  const occurrence=scheduledOccurrenceFromNotificationContext(normalizedContext);
  if (!occurrence || isOccurrenceConsumed(occurrence)) {
    clearScheduledNotificationContext();
    diagnosticTrace('SCHEDULE_NOTIFICATION_CONTEXT_IGNORED',{medicine,scheduleId,scheduledAt,reason:occurrence?'already-consumed':'missing-occurrence'});
    return false;
  }
  pendingScheduledNotificationContext=normalizedContext;
  setActiveTab('register');
  fillMedicineSelect(els.entryMedicine,medicine);
  setNow();
  diagnosticTrace('SCHEDULE_NOTIFICATION_CONTEXT_APPLIED',{medicine,scheduleId,scheduledAt,open:true});
  return true;
}

async function consumeScheduledMedicationNotificationContext() {
  if (!window.MMNative?.isIOS || typeof window.MMNative?.consumeScheduledMedicationNotificationContext !== 'function') return false;
  const context=await window.MMNative.consumeScheduledMedicationNotificationContext();
  if (!context) {
    diagnosticTrace('SCHEDULE_NOTIFICATION_CONTEXT_EMPTY');
    return false;
  }
  diagnosticTrace('SCHEDULE_NOTIFICATION_CONTEXT_RECEIVED', {
    medicine:cleanField(context.medicine).slice(0,80),
    scheduleId:cleanField(context.scheduleId).slice(0,100),
    scheduledAt:cleanField(context.scheduledAt).slice(0,64)
  });
  return applyScheduledNotificationContext(context);
}

let scheduledNotificationRecoveryPromise = null;
async function recoverScheduledMedicationNotificationContext({ retry = false } = {}) {
  if (scheduledNotificationRecoveryPromise) return scheduledNotificationRecoveryPromise;
  const delays = retry ? [0, 120, 420, 900] : [0];
  const run = (async()=>{
    for (const delay of delays) {
      if (delay) await new Promise(resolve=>setTimeout(resolve,delay));
      if (await consumeScheduledMedicationNotificationContext()) return true;
    }
    return false;
  })();
  scheduledNotificationRecoveryPromise = run;
  try { return await run; }
  finally { if (scheduledNotificationRecoveryPromise === run) scheduledNotificationRecoveryPromise = null; }
}

function bindNativeScheduledNotificationRecovery() {
  if (!window.MMNative?.isIOS) return;
  const recover = (event, retry = false) => {
    diagnosticTrace('SCHEDULE_NOTIFICATION_RECOVERY_TRIGGER', { trigger:event?.type || 'manual', hidden:Boolean(document.hidden) });
    recoverScheduledMedicationNotificationContext({ retry }).catch(error=>console.warn('Falha ao aplicar contexto do lembrete aberto:',error));
  };
  window.addEventListener('mm:scheduled-medication-notification-opened',event=>recover(event,false));
  window.addEventListener('focus',event=>recover(event,true));
  document.addEventListener('visibilitychange',event=>{ if (!document.hidden) recover(event,true); });
}

async function loadState() {
  const saved = await dbGet(STATE_KEY);
  state = validateState(saved || state);
  committedRecordSignatures = new Map();
  if (saved?.recordStorageVersion === 2) {
    committedRecordSignatures = new Map((saved.records || []).map(record => [record.id, JSON.stringify(record)]));
  }
  const repairedScheduleLinks = repairNearScheduleAssociations();
  if (saved?.recordStorageVersion !== 2 || repairedScheduleLinks > 0) {
    diagnosticTrace('SCHEDULE_LINK_REPAIR', { repaired:repairedScheduleLinks });
    await dbPut(STATE_KEY, state);
  }
  syncMedicinesToNative({ force: true });
}

function normalizeStateForSave(input) {
  const schedules = (Array.isArray(input.schedules) ? input.schedules : []).map(sanitizeSchedule).filter(Boolean);
  const records = input.records.map(record => committedRecordSignatures.get(record.id) === JSON.stringify(record) ? record : sanitizeRecord(record)).filter(Boolean);
  const medicines = uniqueMedicines([...input.medicines, ...records.map(record => record.medicine), ...schedules.flatMap(s => s.revisions.map(r => r.medicine))]);
  return { version:2, records, medicines, schedules, remindersEnabled:input.remindersEnabled !== false };
}

async function saveState({ reason = 'state-change' } = {}) {
  const revision = ++stateWriteRevision;
  const run = async () => {
    // Preserve normalization of edited fields and Watch medicine discovery;
    // unchanged records are reused without re-sanitizing or sorting history.
    state = normalizeStateForSave(state);
    const snapshot = typeof structuredClone === 'function'
      ? structuredClone(state)
      : JSON.parse(JSON.stringify(state));
    diagnosticTrace('STATE_WRITE_BEGIN', { revision, reason, snapshotRecordCount:snapshot.records.length });
    await dbPut(STATE_KEY, snapshot);
    lastPersistedStateRevision = revision;
    diagnosticTrace('STATE_WRITE_END', { revision, reason, persistedRecordCount:snapshot.records.length });
    updateStatus();
    syncMedicinesToNative();
  };

  const execution = stateWriteTail.then(run, run);
  stateWriteTail = execution.catch(() => {});
  return execution;
}

function cacheElements() {
  [
    "statusLine","appVersion","menuBtn","homeScheduleBtn","homeMedicinesBtn","tabSchedules","tabBtnSchedules","newScheduleBtn","scheduleSearchInput","schedulesList","remindersToggle","scheduleDialog","scheduleForm","scheduleId","scheduleMedicine","scheduleIntervalHours","scheduleStartAt","scheduleDurationDays","schedulePreview","scheduleSaveBtn","scheduleDeleteBtn","scheduleCancelBtn","scheduleManageMedicinesBtn","scheduleDialogTitle","moreBackBtn","appShell","tabRegister","tabHistory","tabMore","tabBtnRegister","tabBtnHistory","tabBtnMore","moreClearBtn","entryDateTime","entryDateTimeDisplay","entryMedicine","nowBtn","addBtn",
    "searchInput","dateFilterBtn","medicineFilterBtn","clearFiltersBtn","historyFilterActions","records","emptyState","overlay","editSheet",
    "medicinesSheet","analyticsSheet","installSheet",
    "exportSheet","exportFilterFrom","exportFilterTo","exportFilterFromDisplay","exportFilterToDisplay","exportPreviewClearBtn","exportRecords","confirmImageExportBtn","editId","editDateTime","editDateTimeDisplay",
    "editMedicine","editRelief","saveEditBtn","deleteRecordBtn","newMedicineInput",
    "addMedicineBtn","medicineManagerDoneBtn","medicinesList","analysisStartDate","analysisEndDate","analysisStartDateDisplay","analysisEndDateDisplay","analysisRefreshBtn","analysisImageBtn","analysisPreview","multiFilterDialog","multiFilterTitle","multiFilterSubtitle","multiFilterOptions","multiFilterClearBtn","reliefChoiceDialog","reliefChoiceText","confirmDialog","confirmTitle","confirmText",
    "recordSavedDialog","recordSavedText","recordSavedOkBtn","importDialog","importSummary","confirmImportBtn","toast","fileInput","historyExportBtn","languageBtn","languageDialog","privacyPolicyBtn","supportBtn","supportDialog","supportEmailBtn","diagnosticModeToggle","privacyPolicySheet","privacyPolicyContent"
  ].forEach(id => els[id] = $(id));
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function localTime() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function joinLocalDateTime(date, time) {
  if (!date || !time) return "";
  return `${date}T${time.slice(0,5)}`;
}

function splitLocalDateTime(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? { date: match[1], time: match[2] } : { date: "", time: "" };
}

function formatLocalDateTimeValue(value) {
  const { date, time } = splitLocalDateTime(value);
  if (!date || !time) return tr('date.selectDateTime');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return I18N?.formatDateTime(new Date(year, month - 1, day, hour, minute)) || `${pad2(day)}/${pad2(month)}/${year} às ${time}`;
}

function syncDateTimeDisplay(input, display) {
  if (!input || !display) return;
  display.textContent = formatLocalDateTimeValue(input.value);
}

function syncAllDateTimeDisplays() {
  syncDateTimeDisplay(els.entryDateTime, els.entryDateTimeDisplay);
  syncDateTimeDisplay(els.editDateTime, els.editDateTimeDisplay);
}

function refreshEntryDateTimeNow() {
  if (!els.entryDateTime) return;
  els.entryDateTime.value = joinLocalDateTime(localToday(), localTime());
  syncDateTimeDisplay(els.entryDateTime, els.entryDateTimeDisplay);
}

function setNow() {
  entryDateTimeAuto = true;
  refreshEntryDateTimeNow();
}

function startEntryDateTimeClock() {
  if (entryDateTimeTimer) clearInterval(entryDateTimeTimer);
  entryDateTimeTimer = setInterval(() => {
    if (entryDateTimeAuto && document.visibilityState === "visible") refreshEntryDateTimeNow();
  }, 15000);
}

function stopEntryDateTimeClock() {
  if (!entryDateTimeTimer) return;
  clearInterval(entryDateTimeTimer);
  entryDateTimeTimer = null;
}

function updateStatus() {
  const total = state.records.length;
  const unit = tr(total === 1 ? 'count.record.one' : 'count.record.other');
  els.statusLine.textContent = `${tr('status.localSave')} • ${total} ${unit}`;
  if (els.appVersion) els.appVersion.textContent = `v${APP_VERSION}`;
}

function legacyTabFromView(view) {
  return view === "tools" ? "more" : view === "home" ? "register" : view === "schedules" ? "schedules" : "history";
}

function canonicalViewFromTab(tab) {
  return tab === "more" ? "tools" : tab === "register" ? "home" : tab === "history" ? "history" : tab === "schedules" ? "schedules" : "home";
}

function setActiveTab(tab) {
  const view = canonicalViewFromTab(tab);
  if (mmAppShell) {
    mmAppShell.setView(view);
    return;
  }
  currentTab = legacyTabFromView(view);
}

function initMMAppShell() {
  if (!window.MMRegistro?.createAppShell) throw new Error("MM Registro Core 2 não carregado.");
  mmAppShell = window.MMRegistro.createAppShell({
    root: els.appShell,
    defaultView: "home",
    legacyViewMap: { home: "register", history: "history", schedules: "schedules", tools: "more" },
    afterViewChange: ({ nextView }) => {
      currentTab = legacyTabFromView(nextView);
      if (nextView !== "home") clearScheduledNotificationContext();
      if (nextView === "home") refreshEntryMedicineDefault();
    }
  });
}

function fillMedicineSelect(select, selected = "") {
  select.innerHTML = "";
  for (const medicine of state.medicines) {
    const option = document.createElement("option");
    option.value = medicine;
    option.textContent = medicine;
    select.appendChild(option);
  }
  if (selected && !state.medicines.some(m => normalizeKey(m) === normalizeKey(selected))) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = selected;
    select.appendChild(option);
  }
  if (selected) select.value = selected;
}

function renderMedicineSelects() {
  const currentEntry = els.entryMedicine.value;
  const currentEdit = els.editMedicine.value;
  fillMedicineSelect(els.entryMedicine, currentEntry || state.medicines[0]);
  fillMedicineSelect(els.editMedicine, currentEdit || state.medicines[0]);
  if (els.scheduleMedicine) fillMedicineSelect(els.scheduleMedicine, els.scheduleMedicine.value || state.medicines[0]);
}

function refreshEntryMedicineDefault() {
  if (!els.entryMedicine) return;
  const contextual=cleanField(pendingScheduledNotificationContext?.medicine);
  fillMedicineSelect(els.entryMedicine, contextual || state.medicines[0] || "");
}


function getDateOptions() {
  const map = new Map();
  for (const record of sortRecords(state.records)) {
    if (record.date && !map.has(record.date)) map.set(record.date, formatDateOnly(record));
  }
  return [...map.entries()].map(([value, label]) => ({ value, label }));
}

function getMedicineOptions() {
  return uniqueMedicines(state.records.map(record => record.medicine))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(value => ({ value, label: value }));
}

function pruneFilterSelections() {
  const dateOptions = getDateOptions();
  const medicineOptions = getMedicineOptions();
  const dateSet = new Set(dateOptions.map(option => option.value));
  for (const scope of ["history", "export"]) {
    filterSelections[scope].dates = filterSelections[scope].dates.filter(value => dateSet.has(value));
    filterSelections[scope].medicines = filterSelections[scope].medicines.filter(value => medicineOptions.some(option => normalizeKey(option.value) === normalizeKey(value)));
  }
}

function summarizeFilterSelection(scope, type) {
  const selected = filterSelections[scope][type];
  if (!selected.length) return type === "dates" ? tr('filter.allDates') : tr('filter.allMedicines');
  if (selected.length === 1) {
    if (type === "dates") {
      const option = getDateOptions().find(option => option.value === selected[0]);
      return option?.label || `1 ${tr('filter.dateUnit')}`;
    }
    return selected[0];
  }
  return `${selected.length} ${type === "dates" ? tr('filter.dateUnits') : tr('filter.medicineUnits')}`;
}

function renderFilterButtons() {
  if (els.dateFilterBtn) els.dateFilterBtn.textContent = summarizeFilterSelection("history", "dates");
  if (els.medicineFilterBtn) els.medicineFilterBtn.textContent = summarizeFilterSelection("history", "medicines");
}

function getFilteredRecords(scope = "history") {
  if (scope === "export") return getExportPreviewRecords();
  const query = normalizeKey(els.searchInput.value);
  const dateSelections = filterSelections.history.dates;
  const medicineSelections = filterSelections.history.medicines;
  return sortRecords(state.records).filter(record => {
    if (dateSelections.length && !dateSelections.includes(record.date)) return false;
    if (medicineSelections.length && !medicineSelections.some(value => normalizeKey(value) === normalizeKey(record.medicine))) return false;
    if (query && !normalizeKey(`${formatDisplayDate(record)} ${record.medicine} ${record.relief}`).includes(query)) return false;
    return true;
  });
}

function openMultiFilterDialog(scope, type) {
  currentMultiFilter = { scope, type };
  renderMultiFilterDialog();
  els.multiFilterDialog.showModal();
}

function renderMultiFilterDialog() {
  const { scope, type } = currentMultiFilter;
  const selected = filterSelections[scope][type];
  const options = type === "dates" ? getDateOptions() : getMedicineOptions();
  els.multiFilterTitle.textContent = type === "dates" ? tr('filter.date') : tr('filter.medicine');
  els.multiFilterSubtitle.textContent = scope === "export" ? tr('filter.exportHint') : tr('filter.historyHint');
  if (!options.length) {
    els.multiFilterOptions.innerHTML = `<p class="filter-empty-copy">${escapeHtml(tr('filter.empty'))}</p>`;
    return;
  }
  els.multiFilterOptions.innerHTML = options.map(option => {
    const checked = selected.some(value => type === "dates" ? value === option.value : normalizeKey(value) === normalizeKey(option.value));
    return `<label class="filter-option-item"><input type="checkbox" data-filter-value="${escapeHtml(option.value)}" ${checked ? "checked" : ""}><span>${escapeHtml(option.label)}</span></label>`;
  }).join("");
}

function toggleMultiFilterValue(rawValue, checked) {
  const { scope, type } = currentMultiFilter;
  const current = filterSelections[scope][type];
  const exists = current.some(value => type === "dates" ? value === rawValue : normalizeKey(value) === normalizeKey(rawValue));
  if (checked && !exists) current.push(rawValue);
  if (!checked && exists) filterSelections[scope][type] = current.filter(value => type === "dates" ? value !== rawValue : normalizeKey(value) !== normalizeKey(rawValue));
  renderFilterButtons();
  if (scope === "history") renderRecords();
  else renderExportPreview();
}

function clearCurrentMultiFilterSelection() {
  const { scope, type } = currentMultiFilter;
  filterSelections[scope][type] = [];
  renderMultiFilterDialog();
  renderFilterButtons();
  if (scope === "history") renderRecords();
  else renderExportPreview();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
}

function renderHistoryFilters() {
  pruneFilterSelections();
  renderFilterButtons();
}

function formatHistoryDay(dateValue) {
  const iso = String(dateValue || "");
  const [year, month, day] = iso.split("-").map(Number);
  if (!validDateParts(year, month, day)) return iso;
  const label = new Intl.DateTimeFormat(I18N?.locale || 'pt-BR', { weekday:'long', day:'2-digit', month:'long' }).format(new Date(year, month - 1, day));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function historyRecordRow(record) {
  const undefinedRelief = normalizeKey(record.relief) === normalizeKey(DEFAULT_RELIEF);
  const scheduled = Boolean(record.scheduleId);
  return `<div class="record-row assistente-history-row" data-id="${escapeHtml(record.id)}" role="button" tabindex="0">
    <div class="record-icon" aria-hidden="true"><svg class="mm-icon" viewBox="0 0 24 24"><use href="mm-registro-icons.svg#medicine"></use></svg></div>
    <div class="record-main">
      <strong>${escapeHtml(record.medicine)}${scheduled ? `<span class="record-scheduled-badge">${escapeHtml(tr('assistant.scheduledBadge'))}</span>` : ''}</strong>
      <span class="${undefinedRelief ? "undefined" : ""}">${escapeHtml(tr('field.relief'))}: ${escapeHtml(localizedRelief(record.relief))}</span>
    </div>
    <div class="record-time">${escapeHtml(formatTimeOnly(record))}</div>
  </div>`;
}

function renderRecords() {
  const query = normalizeKey(els.searchInput.value);
  const hasFilter = !!query || filterSelections.history.dates.length > 0 || filterSelections.history.medicines.length > 0;
  if (els.historyFilterActions) els.historyFilterActions.hidden = !hasFilter;

  const filtered = getFilteredRecords("history");
  els.emptyState.hidden = state.records.length !== 0 || hasFilter;

  if (filtered.length === 0 && hasFilter) {
    els.records.innerHTML = `<div class="panel empty-state"><h2>${escapeHtml(tr('history.noResult'))}</h2><p>${escapeHtml(tr('history.noResultFiltered'))}</p></div>`;
    return;
  }

  const visible = filtered.slice(0, historyRenderLimit);
  const grouped = new Map();
  for (const record of visible) {
    if (!grouped.has(record.date)) grouped.set(record.date, []);
    grouped.get(record.date).push(record);
  }
  const groups = [...grouped.entries()].map(([date, rows]) => `
    <div class="history-day">${escapeHtml(formatHistoryDay(date))}</div>
    <div class="history-day-card">${rows.map(historyRecordRow).join("")}</div>`).join("");
  els.records.innerHTML = groups + (visible.length < filtered.length
    ? `<div class="history-load-more"><button class="secondary-btn" data-action="load-more" type="button">${escapeHtml(tr('history.loadMore', { count:Math.min(HISTORY_RENDER_BATCH, filtered.length - visible.length) }))}</button></div>`
    : "");
}

function clearHistoryFilters() {
  els.searchInput.value = "";
  filterSelections.history.dates = [];
  filterSelections.history.medicines = [];
  renderFilterButtons();
  renderRecords();
  els.searchInput.focus({ preventScroll: true });
}

function formatDateLabel(iso) {
  if (!iso) return tr('common.select');
  return isoToLocalDate(iso) || tr('common.select');
}

function syncExportPreviewDateDisplays() {
  if (els.exportFilterFromDisplay) els.exportFilterFromDisplay.textContent = formatDateLabel(els.exportFilterFrom?.value || "");
  if (els.exportFilterToDisplay) els.exportFilterToDisplay.textContent = formatDateLabel(els.exportFilterTo?.value || "");
}

function syncAnalysisDateDisplays() {
  if (els.analysisStartDateDisplay) els.analysisStartDateDisplay.textContent = formatDateLabel(els.analysisStartDate?.value || analysisSelection.start || "");
  if (els.analysisEndDateDisplay) els.analysisEndDateDisplay.textContent = formatDateLabel(els.analysisEndDate?.value || analysisSelection.end || "");
}

function filteredRecordsBetween(from = "", to = "") {
  return sortRecords(state.records).filter(record => {
    return (!from || record.date >= from) && (!to || record.date <= to);
  });
}

function getExportPreviewRecords() {
  return filteredRecordsBetween(els.exportFilterFrom?.value || "", els.exportFilterTo?.value || "");
}

function renderExportPreview() {
  syncExportPreviewDateDisplays();
  const filtered = getExportPreviewRecords();

  els.confirmImageExportBtn.disabled = filtered.length === 0;
  els.confirmImageExportBtn.textContent = filtered.length === 1
    ? tr('export.oneAsImage')
    : tr('export.manyAsImage', { count:filtered.length });

  if (filtered.length === 0) {
    els.exportRecords.innerHTML = `<div class="panel empty-state"><h2>${escapeHtml(tr('history.noResult'))}</h2><p>${escapeHtml(tr('export.noPeriod'))}</p></div>`;
    return;
  }

  const grouped = new Map();
  for (const record of filtered) {
    if (!grouped.has(record.date)) grouped.set(record.date, []);
    grouped.get(record.date).push(record);
  }
  const dayHeading = iso => {
    const [year, month, day] = String(iso || "").split("-").map(Number);
    if (!validDateParts(year, month, day)) return iso;
    const label = new Intl.DateTimeFormat(I18N?.locale || 'pt-BR', { weekday:'long', day:'2-digit', month:'long' }).format(new Date(year, month - 1, day));
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  els.exportRecords.innerHTML = [...grouped.entries()].map(([date, rows]) => `
    <div class="history-day">${escapeHtml(dayHeading(date))}</div>
    <div class="history-day-card">${rows.map(record => {
      const undefinedRelief = normalizeKey(record.relief) === normalizeKey(DEFAULT_RELIEF);
      return `<div class="record-row export-record-row" data-id="${escapeHtml(record.id)}">
        <div class="record-icon" aria-hidden="true"><svg class="mm-icon" viewBox="0 0 24 24"><use href="mm-registro-icons.svg#medicine"></use></svg></div>
        <div class="record-main"><strong>${escapeHtml(record.medicine)}</strong><span class="${undefinedRelief ? "undefined" : ""}">${escapeHtml(tr('field.relief'))}: ${escapeHtml(localizedRelief(record.relief))}</span></div>
        <div class="record-time">${escapeHtml(formatTimeOnly(record))}<br>${escapeHtml(formatDateOnly(record).slice(0,5))}</div>
      </div>`;
    }).join("")}</div>`).join("");
}

function clearExportFilters() {
  if (els.exportFilterFrom) els.exportFilterFrom.value = "";
  if (els.exportFilterTo) els.exportFilterTo.value = "";
  exportDateRangeControl?.refresh();
  renderExportPreview();
}

function prepareExportFilters() {
  pruneFilterSelections();
  const selectedDates = [...filterSelections.history.dates].sort();
  if (els.exportFilterFrom) els.exportFilterFrom.value = selectedDates[0] || "";
  if (els.exportFilterTo) els.exportFilterTo.value = selectedDates[selectedDates.length - 1] || "";
  exportDateRangeControl?.refresh();
}

function openExportPreview() {
  prepareExportFilters();
  renderExportPreview();
  openSheet(els.exportSheet);
}


function isoToLocalDate(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!validDateParts(year, month, day)) return '';
  return I18N?.formatDate(new Date(year, month - 1, day), { day:'2-digit', month:'2-digit', year:'numeric' }) || `${pad2(day)}/${pad2(month)}/${year}`;
}

function addDaysToIso(iso, delta) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!validDateParts(year, month, day)) return localToday();
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  date.setDate(date.getDate() + Number(delta || 0));
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
}

function inclusiveDaysBetween(start, end) {
  const [y1,m1,d1] = String(start || "").split("-").map(Number);
  const [y2,m2,d2] = String(end || "").split("-").map(Number);
  if (!validDateParts(y1,m1,d1) || !validDateParts(y2,m2,d2)) return 1;
  const a = new Date(y1, m1 - 1, d1, 12, 0, 0, 0);
  const b = new Date(y2, m2 - 1, d2, 12, 0, 0, 0);
  const diff = Math.round((b - a) / 86400000);
  return Math.max(1, diff + 1);
}

function formatCountPerDay(value) {
  return `${I18N?.formatNumber(value, { minimumFractionDigits:1, maximumFractionDigits:1 }) ?? value}/` + tr('analysis.dayUnit');
}

function formatPercent(value) {
  return I18N?.formatPercent(value, 0) ?? `${value}%`;
}

function formatMinutesHuman(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}min`;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function getAvailableAnalysisRange() {
  const dates = state.records.map(record => record.date).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  if (!dates.length) {
    const today = localToday();
    return { min: today, max: today, hasRecords: false };
  }
  return { min: dates[0], max: dates[dates.length - 1], hasRecords: true };
}

function ensureAnalysisSelection() {
  const range = getAvailableAnalysisRange();
  if (!analysisSelection.start) analysisSelection.start = range.min;
  if (!analysisSelection.end) analysisSelection.end = range.max;
  if (analysisSelection.start > analysisSelection.end) [analysisSelection.start, analysisSelection.end] = [analysisSelection.end, analysisSelection.start];
  if (els.analysisStartDate) {
    els.analysisStartDate.value = analysisSelection.start;
    els.analysisStartDate.min = range.min;
    els.analysisStartDate.max = range.max;
  }
  if (els.analysisEndDate) {
    els.analysisEndDate.value = analysisSelection.end;
    els.analysisEndDate.min = range.min;
    els.analysisEndDate.max = range.max;
  }
  analysisDateRangeControl?.refresh();
  syncAnalysisDateDisplays();
}

function setAnalysisRangePreset(rangeValue) {
  analysisRangePreset = String(rangeValue || "all");
  const range = getAvailableAnalysisRange();
  if (rangeValue === "all") {
    analysisSelection = { start: range.min, end: range.max };
  } else {
    const days = Math.max(1, Number(rangeValue) || 30);
    analysisSelection.end = range.max;
    analysisSelection.start = addDaysToIso(range.max, -(days - 1));
    if (analysisSelection.start < range.min) analysisSelection.start = range.min;
  }
  ensureAnalysisSelection();
  highlightActiveAnalysisRange(analysisRangePreset);
  renderAnalysisPreview();
}

function highlightActiveAnalysisRange(activeValue = analysisRangePreset) {
  document.querySelectorAll("[data-analysis-range]").forEach(button => {
    const value = button.dataset.analysisRange;
    let isActive = value === activeValue;
    if (activeValue == null) {
      const range = getAvailableAnalysisRange();
      // When the available history is shorter than a preset, several presets can
      // resolve to the same dates. In that case the full-range state is the only
      // unambiguous inferred choice. Explicit taps are preserved by analysisRangePreset.
      if (analysisSelection.start === range.min && analysisSelection.end === range.max) {
        isActive = value === "all";
      } else if (value !== "all") {
        const days = Math.max(1, Number(value) || 0);
        const expectedStart = addDaysToIso(analysisSelection.end, -(days - 1));
        const clampedStart = expectedStart < range.min ? range.min : expectedStart;
        isActive = clampedStart === analysisSelection.start && analysisSelection.end === range.max;
      }
    }
    button.classList.toggle("is-active", !!isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function applyAnalysisInputValues() {
  const start = els.analysisStartDate?.value || analysisSelection.start || localToday();
  const end = els.analysisEndDate?.value || analysisSelection.end || localToday();
  analysisSelection.start = start;
  analysisSelection.end = end;
  if (analysisSelection.start > analysisSelection.end) [analysisSelection.start, analysisSelection.end] = [analysisSelection.end, analysisSelection.start];
  ensureAnalysisSelection();
  highlightActiveAnalysisRange();
}

function parseReliefInfo(text) {
  const raw = cleanField(text).toLowerCase();
  if (!raw || normalizeKey(raw) === normalizeKey(DEFAULT_RELIEF)) return { type: "undefined" };
  if (/sem\s+al[ií]vio|nenhum\s+al[ií]vio|n[aã]o\s+melhorou|nao\s+melhorou/.test(raw)) return { type: "no_relief" };

  let hours = 0;
  let minutes = 0;
  for (const match of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/g)) {
    hours += Number(String(match[1]).replace(",", ".")) || 0;
  }
  for (const match of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m|min|minuto|minutos)\b/g)) {
    minutes += Number(String(match[1]).replace(",", ".")) || 0;
  }

  const totalMinutes = Math.round(hours * 60 + minutes);
  if (totalMinutes > 0) return { type: "timed", minutes: totalMinutes };
  return { type: "text" };
}

function analyzeTimedTrend(timedEntries) {
  if (!Array.isArray(timedEntries) || timedEntries.length < 4) return { status: "insufficient" };
  const sorted = [...timedEntries].sort((a, b) => a.key.localeCompare(b.key));
  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint).map(entry => entry.minutes);
  const secondHalf = sorted.slice(midpoint).map(entry => entry.minutes);
  if (firstHalf.length < 2 || secondHalf.length < 2) return { status: "insufficient" };
  const before = average(firstHalf);
  const after = average(secondHalf);
  const delta = after - before;
  const threshold = Math.max(15, before * 0.15);
  if (delta <= -threshold) return { status: "improved", before, after, delta };
  if (delta >= threshold) return { status: "worsened", before, after, delta };
  return { status: "stable", before, after, delta };
}

function computeAnalysisData(recordsInput = state.records) {
  ensureAnalysisSelection();
  const start = analysisSelection.start;
  const end = analysisSelection.end;
  const records = sortRecordsAscending(recordsInput.filter(record => {
    if (!record.date) return false;
    if (start && record.date < start) return false;
    if (end && record.date > end) return false;
    return true;
  }));
  const periodDays = inclusiveDaysBetween(start, end);
  const activeDates = new Map();
  const medicines = new Map();
  let timedTotal = 0;
  let noReliefTotal = 0;
  let undefinedTotal = 0;
  let textOnlyTotal = 0;

  for (const record of records) {
    activeDates.set(record.date, (activeDates.get(record.date) || 0) + 1);
    const parsed = parseReliefInfo(record.relief);
    if (!medicines.has(record.medicine)) {
      medicines.set(record.medicine, {
        name: record.medicine,
        count: 0,
        timed: [],
        timedEntries: [],
        noReliefCount: 0,
        undefinedCount: 0,
        textOnlyCount: 0,
        activeDates: new Set()
      });
    }
    const entry = medicines.get(record.medicine);
    entry.count += 1;
    entry.activeDates.add(record.date);
    if (parsed.type === "timed") {
      entry.timed.push(parsed.minutes);
      entry.timedEntries.push({ minutes: parsed.minutes, key: `${record.date}T${record.time || "00:00"}` });
      timedTotal += 1;
    } else if (parsed.type === "no_relief") {
      entry.noReliefCount += 1;
      noReliefTotal += 1;
    } else if (parsed.type === "undefined") {
      entry.undefinedCount += 1;
      undefinedTotal += 1;
    } else {
      entry.textOnlyCount += 1;
      textOnlyTotal += 1;
    }
  }

  const medicinesData = [...medicines.values()].map(item => {
    const avgReliefMinutes = average(item.timed);
    const trend = analyzeTimedTrend(item.timedEntries);
    const measurableRate = item.count ? (item.timed.length / item.count) * 100 : 0;
    return {
      ...item,
      avgReliefMinutes,
      avgPerDay: item.count / periodDays,
      measurableRate,
      trend
    };
  }).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if ((a.avgReliefMinutes ?? Infinity) !== (b.avgReliefMinutes ?? Infinity)) return (a.avgReliefMinutes ?? Infinity) - (b.avgReliefMinutes ?? Infinity);
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const topMedicines = medicinesData.slice(0, 5);
  const fastest = medicinesData.filter(item => item.timed.length).sort((a, b) => a.avgReliefMinutes - b.avgReliefMinutes).slice(0, 3);
  const improved = medicinesData.filter(item => item.trend.status === "improved").sort((a, b) => a.trend.delta - b.trend.delta);
  const worsened = medicinesData.filter(item => item.trend.status === "worsened").sort((a, b) => b.trend.delta - a.trend.delta);
  const activeDays = activeDates.size;
  const sortedDailyUse = [...activeDates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const peakEntry = sortedDailyUse[0] || null;
  const peakEntries = peakEntry ? sortedDailyUse.filter(([, count]) => count === peakEntry[1]) : [];
  const multiUseDays = [...activeDates.values()].filter(count => count > 1).length;
  const totalRecords = records.length;

  const notes = [];
  if (!totalRecords) {
    notes.push(tr('analysis.noteNoRecords'));
  } else {
    const totalLabel = `${totalRecords} ${tr(totalRecords === 1 ? 'count.record.one' : 'count.record.other')}`;
    notes.push(tr('analysis.noteTimed', { timed:timedTotal, total:totalLabel, percent:formatPercent(totalRecords ? timedTotal / totalRecords * 100 : 0) }));
    if (noReliefTotal) notes.push(tr('analysis.noteNoRelief', { count:`${noReliefTotal} ${tr(noReliefTotal === 1 ? 'count.record.one' : 'count.record.other')}` }));
    if (textOnlyTotal) notes.push(tr('analysis.noteText', { count:`${textOnlyTotal} ${tr(textOnlyTotal === 1 ? 'count.record.one' : 'count.record.other')}` }));
    if (undefinedTotal) notes.push(tr('analysis.noteUndefined', { count:`${undefinedTotal} ${tr(undefinedTotal === 1 ? 'count.record.one' : 'count.record.other')}` }));
  }

  return {
    start,
    end,
    periodDays,
    totalRecords,
    activeDays,
    overallAvgPerDay: totalRecords / periodDays,
    peakEntry,
    peakEntries,
    multiUseDays,
    medicinesData,
    topMedicines,
    fastest,
    improved,
    worsened,
    timedTotal,
    noReliefTotal,
    undefinedTotal,
    textOnlyTotal,
    notes,
    periodLabel: tr('range.between',{start:isoToLocalDate(start),end:isoToLocalDate(end)})
  };
}

function analysisLines(summary) {
  const overview = [];
  if (!summary.totalRecords) {
    overview.push(tr('analysis.noPeriodToast'));
  } else {
    const days = `${summary.periodDays} ${tr(summary.periodDays === 1 ? 'analysis.days.one' : 'analysis.days.other')}`;
    overview.push(tr('analysis.periodAnalyzed', { period:summary.periodLabel, days }));
    const recordLabel = `${summary.totalRecords} ${tr(summary.totalRecords === 1 ? 'count.record.one' : 'count.record.other')}`;
    const activeLabel = `${summary.activeDays} ${tr(summary.activeDays === 1 ? 'analysis.dayWithUse' : 'analysis.daysWithUse')}`;
    overview.push(tr('analysis.recordsActiveDays', { records:recordLabel, days:activeLabel }));
    overview.push(tr('analysis.avgOverall', { value:formatCountPerDay(summary.overallAvgPerDay) }));
    if (summary.peakEntry) {
      const count = `${summary.peakEntry[1]} ${tr(summary.peakEntry[1] === 1 ? 'count.record.one' : 'count.record.other')}`;
      const dates = (summary.peakEntries?.length ? summary.peakEntries : [summary.peakEntry])
        .map(([date]) => isoToLocalDate(date)).join(', ');
      overview.push(tr('analysis.peakUse', { count, date:dates }));
    }
    if (summary.multiUseDays) {
      const count = `${summary.multiUseDays} ${tr(summary.multiUseDays === 1 ? 'analysis.days.one' : 'analysis.days.other')}`;
      overview.push(tr('analysis.multiUse', { count }));
    }
  }

  const top = summary.topMedicines.length
    ? summary.topMedicines.map(item => {
        const bits = [tr('analysis.uses', { count:item.count }), formatCountPerDay(item.avgPerDay)];
        if (item.timed.length) bits.push(tr('analysis.avgRelief', { value:formatMinutesHuman(item.avgReliefMinutes) }));
        else bits.push(tr('analysis.noQuantRelief'));
        return `${item.name}: ${bits.join(' • ')}.`;
      })
    : [tr('analysis.noMedicines')];

  const relief = [];
  if (summary.fastest.length) {
    relief.push(tr('analysis.fastestAvg', { value:summary.fastest.map(item => `${item.name} (${formatMinutesHuman(item.avgReliefMinutes)})`).join(', ') }));
  } else if (summary.totalRecords) {
    relief.push(tr('analysis.noSpeed'));
  }
  if (summary.totalRecords) {
    relief.push(tr('analysis.quantRate', { count:`${summary.timedTotal}/${summary.totalRecords}`, percent:formatPercent(summary.totalRecords ? summary.timedTotal / summary.totalRecords * 100 : 0) }));
    if (summary.noReliefTotal) relief.push(tr('analysis.noReliefCount', { count:`${summary.noReliefTotal} ${tr(summary.noReliefTotal === 1 ? 'count.record.one' : 'count.record.other')}` }));
  }

  const evolution = [];
  if (summary.improved.length) evolution.push(tr('analysis.improvement', { value:summary.improved.slice(0, 3).map(item => `${item.name} (${formatMinutesHuman(item.trend.before)} → ${formatMinutesHuman(item.trend.after)})`).join(', ') }));
  if (summary.worsened.length) evolution.push(tr('analysis.worsening', { value:summary.worsened.slice(0, 3).map(item => `${item.name} (${formatMinutesHuman(item.trend.before)} → ${formatMinutesHuman(item.trend.after)})`).join(', ') }));
  if (!evolution.length) evolution.push(summary.totalRecords ? tr('analysis.noTrend') : tr('analysis.noTrendData'));
  return { overview, top, relief, evolution, notes:summary.notes };
}

function renderAnalysisPreview() {
  if (!els.analysisPreview) return;
  applyAnalysisInputValues();
  const summary = computeAnalysisData();
  lastAnalysisSummary = summary;
  const lines = analysisLines(summary);

  if (!state.records.length) {
    els.analysisPreview.innerHTML = `<div class="analysis-card"><p class="analysis-empty">${escapeHtml(tr('analysis.empty'))}</p></div>`;
    if (els.analysisImageBtn) els.analysisImageBtn.disabled = true;
    return;
  }

  if (!summary.totalRecords) {
    els.analysisPreview.innerHTML = `
      <div class="analysis-card">
        <h4>${escapeHtml(tr('analysis.noRecordsPeriod'))}</h4>
        <p class="analysis-empty">${escapeHtml(tr('analysis.noRecordsBetween', { start:isoToLocalDate(summary.start), end:isoToLocalDate(summary.end) }))}</p>
      </div>`;
    if (els.analysisImageBtn) els.analysisImageBtn.disabled = true;
    return;
  }

  const sectionHtml = (title, items) => `
    <section class="analysis-card">
      <h4>${title}</h4>
      <ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>`;

  const fastest = summary.fastest[0] || null;
  els.analysisPreview.innerHTML = `
    <div class="analysis-summary-grid">
      <section class="analysis-stat-card">
        <span>${escapeHtml(tr('analysis.period'))}</span>
        <strong>${escapeHtml(`${summary.periodDays} ${tr(summary.periodDays === 1 ? 'analysis.days.one' : 'analysis.days.other')}`)}</strong>
        <small>${escapeHtml(summary.periodLabel)}</small>
      </section>
      <section class="analysis-stat-card">
        <span>${escapeHtml(tr('analysis.avgUse'))}</span>
        <strong>${escapeHtml(formatCountPerDay(summary.overallAvgPerDay))}</strong>
        <small>${summary.totalRecords} ${escapeHtml(tr(summary.totalRecords === 1 ? 'count.record.one' : 'count.record.other'))}</small>
      </section>
      <section class="analysis-stat-card">
        <span>${escapeHtml(tr('analysis.mostUsed'))}</span>
        <strong>${escapeHtml(summary.topMedicines[0]?.name || "—")}</strong>
        <small>${summary.topMedicines[0] ? tr('analysis.uses', { count:summary.topMedicines[0].count }) : tr('analysis.noDataShort')}</small>
      </section>
      <section class="analysis-stat-card">
        <span>${escapeHtml(tr('analysis.fastestRelief'))}</span>
        <strong>${escapeHtml(fastest?.name || "—")}</strong>
        <small>${escapeHtml(fastest ? formatMinutesHuman(fastest.avgReliefMinutes) : tr('analysis.noDataShort'))}</small>
      </section>
    </div>
    ${sectionHtml(tr('analysis.overview'), lines.overview)}
    ${sectionHtml(tr('analysis.topMedicines'), lines.top)}
    ${sectionHtml(tr('analysis.reliefQuality'), lines.relief)}
    ${sectionHtml(tr('analysis.evolution'), lines.evolution)}
    ${sectionHtml(tr('analysis.methodNotes'), lines.notes)}
  `;
  if (els.analysisImageBtn) els.analysisImageBtn.disabled = false;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = cleanField(text).split(/\s+/).filter(Boolean).flatMap(word => {
    const chunks = [];
    let chunk = '';
    for (const char of word) {
      if (chunk && ctx.measureText(chunk + char).width > maxWidth) { chunks.push(chunk); chunk = ''; }
      chunk += char;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  if (!words.length) return [""];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function makeAnalysisImageFile(summary = lastAnalysisSummary) {
  if (!summary || !summary.totalRecords) throw new Error(tr('analysis.noDataError'));
  const lines = analysisLines(summary);
  const width = 1080;
  const margin = 54;
  const cardGap = 18;
  const cardWidth = width - margin * 2;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const sections = [
    { title:tr('analysis.overview'), lines:lines.overview },
    { title:tr('analysis.topMedicines'), lines:lines.top },
    { title:tr('analysis.reliefQuality'), lines:lines.relief },
    { title:tr('analysis.evolution'), lines:lines.evolution },
    { title:tr('analysis.methodNotes'), lines:lines.notes }
  ].map(section => ({
    ...section,
    prepared: []
  }));

  ctx.font = `400 29px ${EXPORT_FONT_SERIF}`;
  for (const section of sections) {
    section.prepared = section.lines.map(line => wrapCanvasText(ctx, line, cardWidth - 100));
    section.height = 88 + section.prepared.reduce((sum, item) => sum + Math.max(1, item.length) * 40, 0);
  }

  const metrics = [
    { label:tr('analysis.period'), value: `${summary.periodDays} ${tr(summary.periodDays === 1 ? 'analysis.days.one' : 'analysis.days.other')}`, note: summary.periodLabel },
    { label:tr('analysis.avgUse'), value: formatCountPerDay(summary.overallAvgPerDay), note: `${summary.totalRecords} ${tr(summary.totalRecords === 1 ? 'count.record.one' : 'count.record.other')}` },
    { label:tr('analysis.mostUsed'), value: summary.topMedicines[0]?.name || "—", note: summary.topMedicines[0] ? tr('analysis.uses', { count:summary.topMedicines[0].count }) : tr('analysis.noDataShort') },
    { label:tr('analysis.fastestRelief'), value: summary.fastest[0] ? `${summary.fastest[0].name}` : tr('analysis.noDataShort'), note: summary.fastest[0] ? formatMinutesHuman(summary.fastest[0].avgReliefMinutes) : "" }
  ];

  const headerHeight = 210;
  const metricW = (cardWidth - 14) / 2;
  ctx.font = `700 31px ${EXPORT_FONT_SERIF}`;
  for (const metric of metrics) metric.valueLines = wrapCanvasText(ctx, metric.value, metricW - 48);
  const metricH = 98 + Math.max(...metrics.map(metric => metric.valueLines.length)) * 32;
  const metricsHeight = metricH * 2 + 14;
  const bodyHeight = sections.reduce((sum, section) => sum + section.height, 0) + cardGap * (sections.length - 1);
  const footerHeight = 84;
  const height = margin + headerHeight + 28 + metricsHeight + 26 + bodyHeight + footerHeight + margin;
  canvas.width = width;
  canvas.height = height;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#06111f");
  bg.addColorStop(.55, "#0c2541");
  bg.addColorStop(1, "#081423");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(157,193,245,.08)";
  ctx.beginPath(); ctx.arc(width - 90, 120, 124, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(70, height - 120, 134, 0, Math.PI * 2); ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(231,238,246,.74)";
  ctx.font = `700 20px ${EXPORT_FONT_SERIF}`;
  ctx.fillText(tr('analysis.exportKicker'), margin, margin + 8);

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 56px ${EXPORT_FONT_SERIF}`;
  ctx.fillText(tr('analysis.periodSummary'), margin, margin + 42);

  ctx.fillStyle = "rgba(231,238,246,.82)";
  ctx.font = `400 28px ${EXPORT_FONT_SERIF}`;
  ctx.fillText(`${summary.periodLabel} • ${tr('export.generated', { date:I18N?.formatDateTime(new Date()) || new Date().toLocaleString() })}`, margin, margin + 120);

  const metricsY = margin + headerHeight;
  metrics.forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + col * (metricW + 14);
    const y = metricsY + row * (metricH + 14);
    ctx.save();
    drawRoundedRect(ctx, x, y, metricW, metricH, 28);
    ctx.fillStyle = "rgba(7,18,34,.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(149,182,222,.24)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(231,238,246,.74)";
    ctx.font = `700 18px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(metric.label, x + 24, y + 20);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 31px ${EXPORT_FONT_SERIF}`;
    const valueLines = metric.valueLines;
    valueLines.forEach((line, i) => ctx.fillText(line, x + 24, y + 46 + i * 32));
    ctx.fillStyle = "rgba(231,238,246,.70)";
    ctx.font = `400 18px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(metric.note, x + 24, y + metricH - 28);
    ctx.restore();
  });

  let y = metricsY + metricsHeight + 26;
  for (const section of sections) {
    ctx.save();
    drawRoundedRect(ctx, margin, y, cardWidth, section.height, 28);
    ctx.fillStyle = "rgba(7,18,34,.84)";
    ctx.fill();
    ctx.strokeStyle = "rgba(149,182,222,.20)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 30px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(section.title, margin + 28, y + 24);
    ctx.fillStyle = "rgba(242,247,252,.92)";
    ctx.font = `400 28px ${EXPORT_FONT_SERIF}`;
    let lineY = y + 68;
    section.prepared.forEach(group => {
      group.forEach((line, index) => {
        const prefix = index === 0 ? "• " : "  ";
        ctx.fillText(`${prefix}${line}`, margin + 34, lineY);
        lineY += 40;
      });
    });
    ctx.restore();
    y += section.height + cardGap;
  }

  ctx.fillStyle = "rgba(231,238,246,.62)";
  ctx.font = `400 18px ${EXPORT_FONT_SERIF}`;
  const localizedName = tr('app.title');
  const reportName = localizedName === 'Medication Assistant' ? localizedName : `${localizedName} / Medication Assistant`;
  const generatedLabel = tr('export.generated', { date:I18N?.formatDateTime(new Date()) || new Date().toLocaleString() });
  const footerLines = wrapCanvasText(ctx, `${reportName} • v${APP_VERSION} • ${generatedLabel}`, cardWidth);
  footerLines.forEach((line, index) => ctx.fillText(line, margin, height - margin - 18 + index * 24));

  const blob = await canvasToBlob(canvas);
  const fileName = `Diario_Medicacao_Analise_${summary.start}_${summary.end}.png`;
  return new File([blob], fileName, { type: "image/png" });
}

async function exportAnalysisImage(button = null) {
  renderAnalysisPreview();
  const summary = lastAnalysisSummary;
  if (!summary?.totalRecords) {
    showToast(tr('analysis.noPeriodToast'));
    return;
  }
  const originalText = button?.textContent || "";
  try {
    if (button) {
      button.disabled = true;
      button.textContent = tr('analysis.generating');
    }
    const file = await makeAnalysisImageFile(summary);
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files:[file] });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    downloadBlob(file, file.name);
  } catch (error) {
    console.error(error);
    showToast(tr('analysis.imageError'));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || tr('analysis.generate');
    }
  }
}

function openAnalysisSheet() {
  ensureAnalysisSelection();
  renderAnalysisPreview();
  openSheet(els.analyticsSheet);
}

function renderMedicinesList() {
  els.medicinesList.innerHTML = state.medicines.map((medicine, index) => `
    <div class="manager-row" data-medicine="${escapeHtml(medicine)}">
      <div class="manager-weight" aria-label="${escapeHtml(tr('medicine.orderAria',{index:index + 1}))}"><strong>${index + 1}</strong><small>${escapeHtml(tr('medicine.order'))}</small></div>
      <div class="manager-label-wrap">
        <strong class="manager-label">${escapeHtml(medicine)}</strong>
        <button class="manager-rename" type="button" data-med-action="rename" aria-label="${escapeHtml(tr('medicine.renameAria',{name:medicine}))}"><span>✎</span> ${escapeHtml(tr('medicine.editName'))}</button>
      </div>
      <div class="manager-buttons" aria-label="${escapeHtml(tr('medicine.actionsAria',{name:medicine}))}">
        <button type="button" class="mini-button liquid-button med-move" data-med-action="up" aria-label="${escapeHtml(tr('medicine.moveUpAria',{name:medicine}))}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="mini-button liquid-button med-move" data-med-action="down" aria-label="${escapeHtml(tr('medicine.moveDownAria',{name:medicine}))}" ${index === state.medicines.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="mini-button liquid-button danger-mini med-delete" data-med-action="delete" aria-label="${escapeHtml(tr('medicine.deleteAria',{name:medicine}))}">×</button>
      </div>
    </div>`).join("");
}

function renderAll() {
  ensureAnalysisSelection();
  renderMedicineSelects();
  renderHistoryFilters();
  renderRecords();
  renderMedicinesList();
  renderAnalysisPreview();
  renderSchedules();
  renderReminderToggle();
  renderAdherenceAnalysis();
  updateStatus();
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2300);
}


async function openPrivacyPolicy() {
  if (!els.privacyPolicySheet || !els.privacyPolicyContent) return;
  const locale = I18N?.locale || "pt-BR";
  if (els.privacyPolicyContent.dataset.locale !== locale) {
    try {
      const response = await fetch("./privacy.html");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const article = doc.querySelector(`article[data-locale="${locale}"]`) || doc.querySelector('article[data-locale="pt-BR"]');
      if (!article) throw new Error("Conteúdo da política não encontrado");
      els.privacyPolicyContent.innerHTML = article.innerHTML;
      els.privacyPolicyContent.querySelector("h1")?.remove();
      els.privacyPolicyContent.dataset.locale = locale;
    } catch (error) {
      console.warn("Falha ao carregar Política de Privacidade:", error);
      els.privacyPolicyContent.innerHTML = `<p>${tr('privacy.loadError')}</p>`;
      els.privacyPolicyContent.dataset.locale = locale;
    }
  }
  openSheet(els.privacyPolicySheet);
}

function syncDiagnosticModeUI() {
  if (els.diagnosticModeToggle) els.diagnosticModeToggle.checked = diagnosticModeEnabled();
}

function setDiagnosticMode(enabled) {
  try {
    if (enabled) localStorage.setItem(DIAGNOSTIC_MODE_KEY, '1');
    else localStorage.removeItem(DIAGNOSTIC_MODE_KEY);
  } catch {}
  try { localStorage.removeItem(DIAGNOSTIC_TRACE_KEY); } catch {}
  if (enabled) diagnosticTrace('DIAGNOSTIC_MODE_ENABLED', { version:APP_VERSION });
  syncDiagnosticModeUI();
  showToast(enabled ? tr('support.diagnosticEnabledToast') : tr('support.diagnosticDisabledToast'));
}

function openSupport() {
  syncDiagnosticModeUI();
  openSheet(els.supportDialog);
}

function openSupportEmail() {
  const enabled = diagnosticModeEnabled();
  const subject = tr('support.emailSubject', { version:APP_VERSION });
  const body = [
    tr('support.emailIntro'),
    '',
    `${tr('support.emailVersion')}: ${APP_VERSION}`,
    `${tr('support.diagnosticMode')}: ${enabled ? tr('support.diagnosticOn') : tr('support.diagnosticOff')}`,
    '',
    tr('support.emailDescribe')
  ].join('\n');
  window.location.href = `mailto:developer.apps.mm@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function openSheet(sheet) {
  if (activeSheet && activeSheet !== sheet) closeSheet();
  activeSheet = sheet;
  if (sheet?.matches?.("[data-mm-secondary-layer]")) {
    els.overlay.hidden = true;
    window.MMRegistro?.openSecondarySheet?.(sheet);
    return;
  }
  els.overlay.hidden = false;
  sheet.inert = false;
  sheet.removeAttribute("inert");
  sheet.setAttribute("aria-hidden", "false");
  try { sheet.scrollTop = 0; } catch (_) {}
  setTabbarSuspended(true);
  requestAnimationFrame(() => {
    try { sheet.scrollTop = 0; } catch (_) {}
    sheet.classList.add("open");
  });
}

function closeSheet() {
  if (!activeSheet) return;
  const sheet = activeSheet;
  if (sheet?.matches?.("[data-mm-secondary-layer]")) {
    window.MMRegistro?.closeSecondarySheet?.(sheet);
    activeSheet = null;
    els.overlay.hidden = true;
    return;
  }
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  sheet.inert = true;
  sheet.setAttribute("inert", "");
  activeSheet = null;
  setTabbarSuspended(false);
  setTimeout(() => { if (!activeSheet) els.overlay.hidden = true; }, 230);
}

function openMedicineManager() {
  const keepParentSheet = activeSheet === els.scheduleDialog;
  if (activeSheet && !keepParentSheet) closeSheet();
  renderMedicinesList();
  const dialog = els.medicinesSheet;
  if (!dialog) return;
  setTabbarSuspended(true);
  try { dialog.scrollTop = 0; } catch (_) {}
  const panel = dialog.querySelector('.mm-manager-shell');
  try { if (panel) panel.scrollTop = 0; } catch (_) {}
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeMedicineManager() {
  const dialog = els.medicinesSheet;
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
  setTabbarSuspended(Boolean(activeSheet));
}

function confirmAction(title, text, options = {}) {
  return window.MMRegistro.confirmAction({ dialog:els.confirmDialog, title, text, ...options });
}

function isReliefPreset(value) {
  const key = normalizeKey(value);
  return RELIEF_PRESET_VALUES.some(item => normalizeKey(item) === key);
}

function askReliefUpdateMode(preset, current) {
  els.reliefChoiceText.textContent = tr('relief.replaceChoice',{current,preset});
  return new Promise(resolve => {
    const handler = () => {
      els.reliefChoiceDialog.removeEventListener("close", handler);
      resolve(els.reliefChoiceDialog.returnValue || "cancel");
    };
    els.reliefChoiceDialog.addEventListener("close", handler);
    els.reliefChoiceDialog.showModal();
  });
}

async function applyReliefPreset(preset) {
  const selected = cleanField(preset);
  const current = cleanField(els.editRelief.value);

  if (!current || isReliefPreset(current)) {
    els.editRelief.value = selected;
    return;
  }

  const mode = await askReliefUpdateMode(selected, current);
  if (mode === "replace") {
    els.editRelief.value = selected;
    return;
  }
  if (mode === "prepend") {
    const suffix = current.replace(/^[.\s]+/, "");
    els.editRelief.value = `${selected}. ${suffix}`;
  }
}

async function resolveRecordScheduleAssociation(record, { promptFuture = true, excludeRecordId = '' } = {}) {
  annotateRecordWithSchedule(record, { excludeRecordId });
  if (record.scheduleId && record.scheduledAt) return { linked:true, prompted:false, occurrenceAt:record.scheduledAt };
  if (!promptFuture) return { linked:false, prompted:false };

  const actual=recordDateObject(record);
  if (!actual) return { linked:false, prompted:false };
  const next=nextOpenScheduledOccurrence(record.medicine, actual, { excludeRecordId });
  if (!next) return { linked:false, prompted:false };
  const deltaMs=next.at.getTime()-actual.getTime();
  if (deltaMs<=60000) {
    record.scheduleId=next.scheduleId;
    record.scheduledAt=next.at.toISOString();
    return { linked:true, prompted:false, occurrenceAt:record.scheduledAt };
  }

  const cancelButton=els.confirmDialog?.querySelector?.('[value="cancel"]');
  const previousCancel=cancelButton?.textContent || '';
  if (cancelButton) cancelButton.textContent=tr('assistant.keepEventual');
  let confirmed=false;
  try {
    confirmed=await confirmAction(
      tr('assistant.linkScheduleTitle'),
      tr('assistant.linkScheduleCopy',{medicine:record.medicine,time:formatScheduleDate(next.at)}),
      { confirmLabel:tr('assistant.linkScheduleConfirm') }
    );
  } finally {
    if (cancelButton) cancelButton.textContent=previousCancel;
  }
  if (confirmed) {
    record.scheduleId=next.scheduleId;
    record.scheduledAt=next.at.toISOString();
    return { linked:true, prompted:true, occurrenceAt:record.scheduledAt };
  }
  return { linked:false, prompted:true };
}

function showRecordSavedConfirmation(medicine, date, time) {
  if (!els.recordSavedDialog) {
    showToast(tr('status.recorded'));
    return;
  }
  const [year, month, day] = String(date || "").split("-").map(Number);
  const [hour, minute] = String(time || "").split(":").map(Number);
  const localDate = validDateParts(year, month, day) && Number.isFinite(hour) && Number.isFinite(minute)
    ? new Date(year, month - 1, day, hour, minute) : null;
  const dateLabel = localDate ? I18N.formatDateTime(localDate) : "";
  const details = [cleanField(medicine), dateLabel].filter(Boolean).join(" • ");
  els.recordSavedText.textContent = details
    ? tr('record.savedDetails',{details})
    : tr('record.savedDevice');
  if (!els.recordSavedDialog.open) els.recordSavedDialog.showModal();
}

async function addRecord() {
  if (recordSaveInProgress) return;
  if (entryDateTimeAuto) refreshEntryDateTimeNow();
  const { date, time } = splitLocalDateTime(els.entryDateTime.value);
  const medicine = cleanField(els.entryMedicine.value);
  if (!date || !time || !medicine) {
    showToast(tr('error.fillRecord'));
    return;
  }

  recordSaveInProgress = true;
  const originalButtonText = els.addBtn.textContent;
  els.addBtn.disabled = true;
  els.addBtn.textContent = tr('status.recording');

  const now = new Date().toISOString();
  const newRecord = { id: makeId(), date, time, rawDate:"", medicine, relief:DEFAULT_RELIEF, scheduleId:"", scheduledAt:"", createdAt:now, updatedAt:now };
  diagnosticTrace('IPHONE_RECORD_BEGIN', { eventId:newRecord.id, medicine:newRecord.medicine, date, time });

  try {
    let association;
    const notificationOccurrence=scheduledOccurrenceFromNotificationContext();
    if (notificationOccurrence && normalizeKey(notificationOccurrence.medicine)===normalizeKey(newRecord.medicine) && !isOccurrenceConsumed(notificationOccurrence)) {
      newRecord.scheduleId=notificationOccurrence.scheduleId;
      newRecord.scheduledAt=notificationOccurrence.at.toISOString();
      association={linked:true,prompted:false,occurrenceAt:newRecord.scheduledAt,source:'notification'};
    } else {
      association=await resolveRecordScheduleAssociation(newRecord,{promptFuture:true});
    }
    state.records.push(newRecord);
    await saveState({ reason:'iphone-add-record' });
    diagnosticTrace('IPHONE_RECORD_PERSISTED', { eventId:newRecord.id, medicine:newRecord.medicine, scheduleId:newRecord.scheduleId||null, scheduledAt:newRecord.scheduledAt||null, prompted:Boolean(association.prompted) });
    renderAll();
    if (typeof reconcileMedicationNotifications === 'function') { try { await reconcileMedicationNotifications(); } catch (notificationError) { console.warn('Falha ao reconciliar lembretes após registro:', notificationError); } }
    clearScheduledNotificationContext();
    setNow();
    showRecordSavedConfirmation(medicine, date, time);
  } catch (error) {
    state.records = state.records.filter(record => record.id !== newRecord.id);
    diagnosticTrace('IPHONE_RECORD_PERSIST_ERROR', { eventId:newRecord.id, message:String(error?.message || error) });
    console.error("Falha ao salvar registro:", error);
    showToast(tr('error.recordSave'));
  } finally {
    recordSaveInProgress = false;
    els.addBtn.disabled = false;
    els.addBtn.textContent = originalButtonText || tr('action.register');
  }
}

function openEdit(recordId, focusRelief = false) {
  const record = state.records.find(r => r.id === recordId);
  if (!record) return;
  els.editId.value = record.id;
  els.editDateTime.value = joinLocalDateTime(record.date || "", record.time || "");
  syncDateTimeDisplay(els.editDateTime, els.editDateTimeDisplay);
  fillMedicineSelect(els.editMedicine, record.medicine);
  els.editRelief.value = record.relief || DEFAULT_RELIEF;
  openSheet(els.editSheet);
  if (focusRelief) setTimeout(() => { els.editRelief.focus(); els.editRelief.select(); }, 250);
}

async function saveEdit() {
  const record = state.records.find(r => r.id === els.editId.value);
  if (!record) return;
  const { date, time } = splitLocalDateTime(els.editDateTime.value);
  if (!date || !time || !cleanField(els.editMedicine.value)) {
    showToast(tr('error.fillRecord'));
    return;
  }
  record.date = date;
  record.time = time;
  record.rawDate = "";
  record.medicine = cleanField(els.editMedicine.value);
  record.relief = cleanField(els.editRelief.value) || DEFAULT_RELIEF;
  record.updatedAt = new Date().toISOString();
  await resolveRecordScheduleAssociation(record,{promptFuture:true,excludeRecordId:record.id});
  state.medicines = uniqueMedicines([...state.medicines, record.medicine]);
  await saveState({ reason:'edit-record' });
  diagnosticTrace('RECORD_EDITED', { eventId:record.id, scheduleId:record.scheduleId||null, scheduledAt:record.scheduledAt||null });
  closeSheet();
  renderAll();
  await reconcileMedicationNotifications();
  showToast(tr('status.updated'));
}

async function deleteCurrentRecord() {
  const record = state.records.find(r => r.id === els.editId.value);
  if (!record) return;
  const ok = await confirmAction(tr('confirm.deleteRecord'), `${formatDisplayDate(record)} • ${record.medicine}`, { destructive:true, confirmLabel:tr('confirm.delete') });
  if (!ok) return;
  if (window.MMNative?.isIOS && typeof window.MMNative?.discardWatchMedicationEvent === 'function') {
    const discarded = await window.MMNative.discardWatchMedicationEvent(record.id);
    diagnosticTrace('RECORD_DELETE_NATIVE_CONSUME', { eventId:record.id, discarded:Boolean(discarded?.discarded) });
    if (discarded?.discarded !== true) {
      throw new Error('Não foi possível proteger a exclusão contra uma retransmissão pendente do Apple Watch.');
    }
  }

  state.records = state.records.filter(r => r.id !== record.id);
  await saveState({ reason:'delete-record' });
  diagnosticTrace('RECORD_DELETED', { eventId:record.id });
  closeSheet();
  renderAll();
  if (typeof reconcileMedicationNotifications === 'function') { try { await reconcileMedicationNotifications(); } catch (notificationError) { console.warn('Falha ao reconciliar lembretes após exclusão:', notificationError); } }
  showToast(tr('status.deleted'));
}

async function moveMedicine(medicine, direction) {
  const index = state.medicines.findIndex(item => normalizeKey(item) === normalizeKey(medicine));
  if (index < 0) return;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.medicines.length) return;

  const next = [...state.medicines];
  [next[index], next[target]] = [next[target], next[index]];
  state.medicines = next;
  await saveState({ reason:'move-medicine' });
  refreshEntryMedicineDefault();
  const currentEdit = els.editMedicine.value;
  fillMedicineSelect(els.editMedicine, currentEdit || state.medicines[0]);
  if (els.scheduleMedicine) fillMedicineSelect(els.scheduleMedicine, els.scheduleMedicine.value || state.medicines[0]);
  renderMedicinesList();
  showToast(tr('status.orderUpdated'));
}

async function addMedicine() {
  const suggested = prompt(tr('medicine.addPrompt'), '');
  if (suggested == null) return;
  const medicine = cleanField(suggested).slice(0, 80);
  if (!medicine) return showToast(tr('medicine.typeName'));
  if (state.medicines.some(m => normalizeKey(m) === normalizeKey(medicine))) {
    showToast(tr('medicine.duplicate'));
    return;
  }
  state.medicines.push(medicine);
  state.medicines = uniqueMedicines(state.medicines);
  await saveState({ reason:'add-medicine' });
  renderAll();
  showToast(tr('medicine.added'));
}

async function renameMedicine(oldName) {
  const suggested = prompt(tr('medicine.renamePrompt'), oldName);
  if (suggested == null) return;
  const newName = cleanField(suggested).slice(0, 80);
  if (!newName || normalizeKey(newName) === normalizeKey(oldName)) return;
  if (state.medicines.some(m => normalizeKey(m) === normalizeKey(newName))) {
    showToast(tr('medicine.renameDuplicate'));
    return;
  }
  state.medicines = state.medicines.map(m => normalizeKey(m) === normalizeKey(oldName) ? newName : m);
  for (const record of state.records) {
    if (normalizeKey(record.medicine) === normalizeKey(oldName)) {
      record.medicine = newName;
      record.updatedAt = new Date().toISOString();
    }
  }
  await saveState({ reason:'rename-medicine' });
  renderAll();
  showToast(tr('medicine.historyRenamed'));
}

async function deleteMedicine(medicine) {
  if (state.medicines.length <= 1) {
    showToast(tr('medicine.keepOne'));
    return;
  }
  const used = state.records.filter(r => normalizeKey(r.medicine) === normalizeKey(medicine)).length;
  const text = used
    ? tr('medicine.removeUsed',{name:medicine,count:used})
    : tr('medicine.removeUnused',{name:medicine});
  const ok = await confirmAction(tr('confirm.deleteList'), text, { destructive:true, confirmLabel:tr('confirm.delete') });
  if (!ok) return;
  state.medicines = state.medicines.filter(m => normalizeKey(m) !== normalizeKey(medicine));
  await saveState({ reason:'delete-medicine' });
  renderAll();
  showToast(tr('medicine.removed'));
}

function parseDelimitedLine(line, delimiter) {
  const result = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      result.push(value.trim()); value = "";
    } else value += ch;
  }
  result.push(value.trim());
  return result;
}

function looksLikeHeader(fields) {
  const joined = normalizeKey(fields.slice(0,3).join(" "));
  const hasDate = /\b(data|date|fecha)\b/.test(joined);
  const hasMedicine = /\b(remedio|medicamento|medicine|medication)\b/.test(joined);
  const hasRelief = /\b(alivio|relief)\b/.test(joined);
  return hasDate && hasMedicine && hasRelief;
}

function parseTextHistory(text) {
  const lines = String(text ?? "").replace(/\r\n?/g,"\n").split("\n").map(s => s.trim()).filter(Boolean);
  const records = [];
  const rejected = [];
  for (const line of lines) {
    const delimiter = line.includes("|") ? "|" : ",";
    const fields = parseDelimitedLine(line, delimiter);
    if (looksLikeHeader(fields)) continue;
    const rawDate = cleanField(fields[0]);
    const medicine = cleanField(fields[1]);
    const relief = canonicalRelief(fields[2]);
    if (!rawDate && !medicine) continue;
    const parsed = parseDateTimeText(rawDate);
    if (!parsed || !medicine) {
      rejected.push(line);
      continue;
    }
    records.push({
      id: makeId(), date: parsed.date, time: parsed.time, rawDate:"", medicine,
      relief, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
    });
  }
  return { records, medicines: uniqueMedicines(records.map(r => r.medicine)), rejected };
}

function parseBackupJson(text) {
  const parsed = JSON.parse(text);
  const source = parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed;
  const validated = validateState(source);
  if (!Array.isArray(source.records)) throw new Error(tr('error.backupNoRecords'));
  return { records: validated.records, medicines: validated.medicines, rejected: [] };
}

function recordFingerprint(record) {
  return [record.date, record.time, normalizeKey(record.medicine), normalizeKey(record.relief)].join("|");
}

function mergeRecords(existing, incoming) {
  const seen = new Set(existing.map(recordFingerprint));
  const merged = [...existing];
  let added = 0;
  for (const record of incoming) {
    const key = recordFingerprint(record);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(record);
    added++;
  }
  return { records: sortRecords(merged), added };
}

async function handleFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith(".json") ? parseBackupJson(text) : parseTextHistory(text);
    if (!parsed.records.length && parsed.rejected.length) throw new Error(tr('error.noValidLines'));
    pendingImport = parsed;
    els.importSummary.textContent = `${parsed.records.length === 1 ? tr('import.recognizedOne') : tr('import.recognizedMany',{count:parsed.records.length})}${parsed.rejected.length ? tr('import.ignored',{count:parsed.rejected.length}) : ''}.`;
    els.importDialog.showModal();
  } catch (error) {
    console.error(error);
    const message = tr('import.failed',{error:error.message || error});
    showToast(message);
    window.alert(`${message}\n\n${tr('import.invalidNotice')}`);
  } finally {
    els.fileInput.value = "";
  }
}

function buildImportedMedicineList(mode, importData, currentMedicines = state.medicines) {
  const importedMedicines = [
    ...(Array.isArray(importData?.medicines) ? importData.medicines : []),
    ...(Array.isArray(importData?.records) ? importData.records.map(record => record.medicine) : [])
  ];

  // Em "substituir", o backup é a fonte de verdade: preserva exatamente
  // a ordem configurada nele e apenas acrescenta remédios usados em registros
  // que, por algum motivo, não estejam na lista do backup.
  if (mode === "replace") return uniqueMedicines(importedMedicines);

  // Em "acrescentar", a ordem atual permanece e novos itens entram ao final.
  return uniqueMedicines([...(Array.isArray(currentMedicines) ? currentMedicines : []), ...importedMedicines]);
}

async function applyPendingImport() {
  if (!pendingImport) return;
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || "merge";
  let added = pendingImport.records.length;

  if (mode === "replace") {
    dataResetInProgress = true;
    diagnosticTrace('IMPORT_REPLACE_BEGIN');
    try {
      if (watchEventSyncPromise) await watchEventSyncPromise.catch(() => {});
      await stateWriteTail.catch(() => {});
      await nativeMedicineSyncTail.catch(() => {});
      const resetAt = new Date().toISOString();
      if (window.MMNative?.isIOS && typeof window.MMNative?.resetWatchSynchronizationState === 'function') {
        const reset = await window.MMNative.resetWatchSynchronizationState(resetAt);
        if (reset?.reset !== true) throw new Error('Falha ao redefinir a fila nativa antes da importação por substituição.');
      }
      state.records = pendingImport.records;
      state.medicines = buildImportedMedicineList("replace", pendingImport);
      await saveState({ reason:'import-replace' });
      await nativeMedicineSyncTail.catch(() => {});
      diagnosticTrace('IMPORT_REPLACE_END', { resetAt, importedRecordCount:state.records.length });
    } finally {
      dataResetInProgress = false;
    }
  } else {
    const merged = mergeRecords(state.records, pendingImport.records);
    state.records = merged.records;
    added = merged.added;
    state.medicines = buildImportedMedicineList("merge", pendingImport, state.medicines);
    await saveState({ reason:'import-merge' });
  }
  pendingImport = null;
  renderAll();
  closeSheet();
  if (watchEventSyncRequested) {
    watchEventSyncRequested = false;
    queueMicrotask(() => syncWatchMedicationEventsFromNative().catch(console.warn));
  }
  showToast(mode === 'replace' ? tr('import.replaced') : tr('import.added',{count:added}));
}

function csvEscape(value) {
  const text = cleanField(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}

function toCsv(records) {
  const rows = sortRecords(records).map(r => [formatShortcutDate(r), r.medicine, localizedRelief(r.relief)].map(csvEscape).join(","));
  return `${[tr('export.csvHeaderDate'),tr('export.csvHeaderMedicine'),tr('export.csvHeaderRelief')].map(csvEscape).join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function toTxt(records) {
  const rows = sortRecords(records).map(r => [formatShortcutDate(r), r.medicine, localizedRelief(r.relief)].map(csvEscape).join(","));
  return `${[tr('export.csvHeaderDate'),tr('export.csvHeaderMedicine'),tr('export.csvHeaderRelief')].map(csvEscape).join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function backupJson() {
  const backup = {
    app:"Assistente de Medicação",
    appEnglishName:"Medication Assistant",
    version:APP_VERSION,
    exportedAt:new Date().toISOString(),
    locale:I18N?.locale || null,
    timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    runtime:window.MMNative?.platform || 'web',
    state:validateState(state)
  };
  if (diagnosticModeEnabled()) {
    backup.diagnostics = {
      revision:DIAGNOSTIC_REVISION,
      current:diagnosticStateSnapshot(),
      trace:readDiagnosticTrace()
    };
  }
  return JSON.stringify(backup, null, 2);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportSingleFile(content, filename, mime, button = null) {
  if (singleFileExportInProgress) {
    showToast(tr('error.exportBusy'));
    return;
  }

  singleFileExportInProgress = true;
  const previousDisabled = button?.disabled ?? false;
  if (button) button.disabled = true;

  try {
    const blob = new Blob([content], { type:mime });
    const file = new File([blob], filename, { type:mime });

    // Fecha o menu antes de abrir a folha de compartilhamento do iOS.
    // Isso também evita que um segundo toque no mesmo botão seja processado.
    if (activeSheet) closeSheet();
    await new Promise(resolve => setTimeout(resolve, 80));

    // No iOS/Safari, se o Web Share com arquivo estiver disponível, usamos
    // somente esse caminho. Não fazemos fallback automático depois de uma
    // tentativa de share, para impedir que o mesmo toque gere dois arquivos.
    if (navigator.canShare?.({ files:[file] }) && typeof navigator.share === "function") {
      try {
        await navigator.share({ files:[file] });
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Falha ao compartilhar arquivo:", error);
          showToast(tr('error.share'));
        }
      }
      return;
    }

    // Navegadores sem compartilhamento de arquivos recebem exatamente um download.
    downloadBlob(blob, filename);
  } finally {
    singleFileExportInProgress = false;
    if (button) button.disabled = previousDisabled;
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Falha ao gerar a imagem.")), "image/png", 0.95));
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  let value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0,-1);
  return `${value}…`;
}

const EXPORT_FONT_SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const EXPORT_FONT_SANS = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

function wrapTextLines(ctx, text, maxWidth, maxLines = 3) {
  const normalized = cleanField(text);
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.length) {
    const rebuilt = lines.join(" ");
    if (rebuilt.length < normalized.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}…`;
    }
  }
  return lines.slice(0, maxLines);
}

function paginateExportRows(records, config) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `400 ${config.bodyFont}px ${EXPORT_FONT_SERIF}`;
  const pages = [];
  let currentPage = [];
  let usedHeight = 0;
  for (const record of records) {
    const prepared = {
      record,
      dateLines: wrapTextLines(ctx, formatDisplayDate(record), config.colWidths[0] - config.cellPad * 2, 3),
      medicineLines: wrapTextLines(ctx, record.medicine, config.colWidths[1] - config.cellPad * 2, 3),
      reliefLines: wrapTextLines(ctx, record.relief, config.colWidths[2] - config.cellPad * 2, 7)
    };
    const maxLines = Math.max(prepared.dateLines.length, prepared.medicineLines.length, prepared.reliefLines.length);
    prepared.rowHeight = Math.max(config.minRowHeight, config.cellPad * 2 + maxLines * config.lineHeight);
    if (currentPage.length && usedHeight + prepared.rowHeight > config.maxBodyHeight) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }
    currentPage.push(prepared);
    usedHeight += prepared.rowHeight;
  }
  if (!pages.length && !currentPage.length) {
    const prepared = { record:{date:"", time:"", medicine:"Nenhum registro", relief:""}, dateLines:[""], medicineLines:["Nenhum registro"], reliefLines:[""], rowHeight:config.minRowHeight };
    currentPage.push(prepared);
  }
  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function drawTableCell(ctx, x, y, w, h, lines, options = {}) {
  const {
    fill = "#ffffff",
    stroke = "#c7d1da",
    color = "#243342",
    font = `400 30px ${EXPORT_FONT_SERIF}`,
    lineHeight = 36,
    textAlign = "left",
    padX = 18,
    padY = 18
  } = options;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y, w, h);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = textAlign;
  ctx.textBaseline = "top";
  let drawX = x + padX;
  if (textAlign === "center") drawX = x + w / 2;
  if (textAlign === "right") drawX = x + w - padX;
  let drawY = y + padY;
  for (const line of lines) {
    ctx.fillText(line, drawX, drawY);
    drawY += lineHeight;
  }
}

async function makeTableFiles(recordsInput = state.records) {
  const records = sortRecords(recordsInput);
  if (!records.length) return [];

  const width = 1080;
  const height = 1920;
  const pagePadX = 72;
  const topY = 66;
  const footerY = height - 94;
  const contentTopY = 310;
  const contentBottomY = footerY - 32;
  const contentHeight = contentBottomY - contentTopY;
  const cardWidth = width - pagePadX * 2;
  const dayHeaderHeight = 48;
  const daySpacingAfter = 16;
  const cardGap = 18;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  const periodStart = formatDateOnly(records[records.length - 1]);
  const periodEnd = formatDateOnly(records[0]);
  const periodLabel = tr('range.between',{start:periodStart,end:periodEnd});
  const generatedAt = new Date();

  const grouped = new Map();
  records.forEach(record => {
    const key = record.date || "";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });

  const shortDateLabel = date => {
    const [year, month, day] = String(date || "").split("-").map(Number);
    if (!validDateParts(year, month, day)) return cleanField(date || "");
    return I18N?.formatDate(new Date(year, month - 1, day), { day:'2-digit', month:'2-digit', year:'numeric' }) || `${pad2(day)}/${pad2(month)}/${year}`;
  };

  const measureLines = (text, maxWidth, font, maxLines = 4) => {
    measureCtx.font = font;
    return wrapTextLines(measureCtx, text, maxWidth, maxLines);
  };

  const estimateCard = record => {
    const medicineLines = measureLines(cleanField(record.medicine), 480, `700 33px ${EXPORT_FONT_SERIF}`, 2);
    const reliefLines = measureLines(`${tr('field.relief')}: ${localizedRelief(record.relief)}`, 510, `400 29px ${EXPORT_FONT_SERIF}`, 4);
    const cardHeight = Math.max(118, 34 + medicineLines.length * 40 + reliefLines.length * 32);
    return { record, medicineLines, reliefLines, cardHeight };
  };

  const pages = [];
  let page = [];
  let usedHeight = 0;
  for (const [date, dateRecords] of grouped.entries()) {
    let needsHeader = true;
    for (const record of dateRecords) {
      const prepared = estimateCard(record);
      const headerBlock = needsHeader ? dayHeaderHeight + daySpacingAfter : 0;
      const gapBefore = usedHeight > 0 ? 10 : 0;
      const needed = gapBefore + headerBlock + prepared.cardHeight + cardGap;
      if (page.length && usedHeight + needed > contentHeight) {
        pages.push(page);
        page = [];
        usedHeight = 0;
        needsHeader = true;
      }
      if (needsHeader) {
        page.push({ type: "day", date, label: shortDateLabel(date) });
        usedHeight += (usedHeight > 0 ? 10 : 0) + dayHeaderHeight + daySpacingAfter;
        needsHeader = false;
      }
      page.push({ type: "record", ...prepared });
      usedHeight += prepared.cardHeight + cardGap;
    }
  }
  if (page.length) pages.push(page);

  const drawRoundedCard = (ctx, x, y, w, h, radius, fill) => {
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.10)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  };

  const drawCalendarIcon = (ctx, x, y) => {
    ctx.save();
    ctx.translate(x, y);
    drawRoundedRect(ctx, 0, 6, 26, 24, 7);
    ctx.fillStyle = "#2b5fb0";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 11, 26, 3);
    ctx.fillRect(6, 0, 4, 9);
    ctx.fillRect(16, 0, 4, 9);
    ctx.restore();
  };

  const drawClockIcon = (ctx, x, y) => {
    ctx.save();
    ctx.strokeStyle = "#2b5fb0";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y + 2);
    ctx.stroke();
    ctx.restore();
  };

  const files = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#f7fbff");
    bg.addColorStop(1, "#eef3f8");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(56, 107, 174, .06)";
    ctx.beginPath(); ctx.arc(40, 58, 82, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(width - 88, 84, 70, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(width - 146, 152, 24, 0, Math.PI * 2); ctx.fill();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.beginPath();
        ctx.arc(width - 112 + col * 17, 198 + row * 17, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = "#163d73";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 58px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(tr('app.title'), width / 2, topY + 42);

    ctx.fillStyle = "#5a6f8d";
    ctx.font = `400 21px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(`${periodLabel} • ${records.length} ${tr(records.length === 1 ? 'count.record.one' : 'count.record.other')}`, width / 2, topY + 88);

    drawRoundedRect(ctx, width / 2 - 270, topY + 110, 540, 54, 26);
    ctx.fillStyle = "#e9f0fa";
    ctx.fill();
    ctx.fillStyle = "#2956a6";
    ctx.font = `700 17px ${EXPORT_FONT_SANS}`;
    ctx.textAlign = "center";
    ctx.fillText(tr('export.cardLabel'), width / 2, topY + 144);

    let y = contentTopY;
    ctx.textAlign = "left";
    for (const item of pages[pageIndex]) {
      if (item.type === "day") {
        drawCalendarIcon(ctx, pagePadX, y + 3);
        ctx.fillStyle = "#163d73";
        ctx.font = `700 32px ${EXPORT_FONT_SERIF}`;
        ctx.fillText(item.label, pagePadX + 42, y + 28);
        y += dayHeaderHeight + daySpacingAfter;
        continue;
      }

      drawRoundedCard(ctx, pagePadX, y, cardWidth, item.cardHeight, 24, "#ffffff");
      const pillX = pagePadX + 22;
      const pillY = y + 24;
      const pillW = 168;
      const pillH = Math.min(60, item.cardHeight - 34);
      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 18);
      ctx.fillStyle = "#f2f7ff";
      ctx.fill();
      drawClockIcon(ctx, pillX + 34, pillY + pillH / 2);
      ctx.fillStyle = "#234d95";
      ctx.font = `700 26px ${EXPORT_FONT_SERIF}`;
      ctx.textBaseline = "middle";
      ctx.fillText(formatTimeOnly(item.record), pillX + 58, pillY + pillH / 2 + 1);

      ctx.strokeStyle = "rgba(22,61,115,.10)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(pagePadX + 222, y + 22);
      ctx.lineTo(pagePadX + 222, y + item.cardHeight - 22);
      ctx.stroke();

      const textX = pagePadX + 256;
      let textY = y + 42;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#173b74";
      ctx.font = `700 34px ${EXPORT_FONT_SERIF}`;
      item.medicineLines.forEach(line => {
        ctx.fillText(line, textX, textY);
        textY += 39;
      });
      ctx.fillStyle = normalizeKey(item.record.relief) === normalizeKey(DEFAULT_RELIEF) ? "#b47317" : "#344b68";
      ctx.font = `400 28px ${EXPORT_FONT_SERIF}`;
      item.reliefLines.forEach(line => {
        ctx.fillText(line, textX, textY + 6);
        textY += 31;
      });
      y += item.cardHeight + cardGap;
    }

    ctx.fillStyle = "rgba(56, 107, 174, .05)";
    ctx.beginPath();
    ctx.moveTo(0, height - 130);
    ctx.bezierCurveTo(210, height - 175, 360, height - 90, 560, height - 120);
    ctx.bezierCurveTo(760, height - 150, 880, height - 95, width, height - 132);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#244f97";
    drawRoundedRect(ctx, pagePadX - 6, height - 122, 50, 76, 14);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(pagePadX + 8, height - 106, 22, 3);
    ctx.fillRect(pagePadX + 8, height - 95, 22, 3);
    ctx.fillRect(pagePadX + 8, height - 84, 22, 3);
    ctx.beginPath(); ctx.arc(pagePadX + 19, height - 65, 8, 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pagePadX + 14, height - 60); ctx.lineTo(pagePadX + 24, height - 70); ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#163d73";
    ctx.font = `700 18px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(tr('app.title'), pagePadX + 58, height - 86);
    ctx.fillStyle = "#5a6f8d";
    ctx.font = `400 14px ${EXPORT_FONT_SANS}`;
    ctx.fillText(tr('export.generated', { date:I18N?.formatDateTime(generatedAt) || generatedAt.toLocaleString() }), pagePadX + 58, height - 58);
    ctx.textAlign = "right";
    ctx.fillStyle = "#244f97";
    ctx.font = `400 18px ${EXPORT_FONT_SERIF}`;
    ctx.fillText(tr('export.page', { page:pageIndex + 1, pages:pages.length }), width - pagePadX, height - 74);

    const blob = await canvasToBlob(canvas);
    files.push(new File([blob], `Diario_Medicacao_${pageIndex + 1}.png`, { type: "image/png" }));
  }
  return files;
}


async function exportVisibleHistory() {
  const records = getFilteredRecords("history");
  if (!records.length) {
    showToast(tr('export.noVisible'));
    return;
  }
  const quantity = `${records.length} ${tr(records.length === 1 ? 'count.record.one' : 'count.record.other')}`;
  const ok = await confirmAction(
    tr('export.filtered.title'),
    tr('export.filteredCopy',{count:quantity})
  );
  if (!ok) return;
  await exportImages(records, els.historyExportBtn);
}

async function exportImages(recordsInput = state.records, sourceButton = null) {
  const records = sortRecords(recordsInput);
  if (!records.length) {
    showToast(tr('export.noRecords'));
    return;
  }
  const originalText = sourceButton?.textContent || "";
  try {
    if (sourceButton) {
      sourceButton.disabled = true;
      sourceButton.textContent = tr('export.generating');
    }
    showToast(tr('export.generating'));
    const files = await makeTableFiles(records);
    if (navigator.canShare?.({files})) {
      try { await navigator.share({files,title:tr('app.title')}); return; }
      catch (error) { if (error?.name === "AbortError") return; }
    }
    files.forEach(file => downloadBlob(file, file.name));
  } catch (error) {
    console.error(error);
    showToast(tr('error.exportImage'));
  } finally {
    if (sourceButton) {
      sourceButton.disabled = false;
      if (sourceButton === els.confirmImageExportBtn) renderExportPreview();
      else if (originalText) sourceButton.textContent = originalText;
    }
  }
}

async function clearAllData() {
  const ok = await confirmAction(tr('confirm.clearAllTitle'), tr('confirm.clearAllCopy'), { destructive:true, confirmLabel:tr('confirm.erase') });
  if (!ok) return;

  dataResetInProgress = true;
  const resetAt = new Date().toISOString();
  diagnosticTrace('CLEAR_ALL_BEGIN', { resetAt });
  try {
    if (watchEventSyncPromise) await watchEventSyncPromise.catch(() => {});
    await stateWriteTail.catch(() => {});
    await nativeMedicineSyncTail.catch(() => {});

    if (window.MMNative?.isIOS && typeof window.MMNative?.resetWatchSynchronizationState === 'function') {
      const reset = await window.MMNative.resetWatchSynchronizationState(resetAt);
      if (reset?.reset !== true) throw new Error('Falha ao redefinir a sincronização nativa antes de apagar os dados.');
    }

    state = { version:2, records:[], medicines:[...DEFAULT_MEDICINES], schedules:[], remindersEnabled:true };
    await saveState({ reason:'clear-all' });
    await nativeMedicineSyncTail.catch(() => {});
    diagnosticTrace('CLEAR_ALL_END', { resetAt });
    closeSheet();
    renderAll();
    showToast(tr('status.allCleared'));
  } catch (error) {
    diagnosticTrace('CLEAR_ALL_ERROR', { resetAt, message:String(error?.message || error) });
    console.error('Falha ao apagar todos os dados:', error);
    showToast(error.message || tr('error.save'));
  } finally {
    dataResetInProgress = false;
    if (watchEventSyncRequested) {
      watchEventSyncRequested = false;
      queueMicrotask(() => syncWatchMedicationEventsFromNative().catch(console.warn));
    }
  }
}


function isEditingControl(element) {
  if (!element || element === document.body) return false;
  if (element.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName || "");
}

function isKeyboardEditingControl(element) {
  if (!element || element === document.body) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  const type = String(element.type || "text").toLowerCase();
  return ["text", "search", "email", "tel", "url", "number", "password"].includes(type);
}

function isMobileLikeViewport() {
  return window.matchMedia?.("(pointer: coarse)")?.matches || window.innerWidth <= 900;
}

function setTabbarSuspended(suspended, holdMs = 0) {
  if (suspended && holdMs > 0) tabbarSuspendUntil = Math.max(tabbarSuspendUntil, Date.now() + holdMs);
  if (!suspended) tabbarSuspendUntil = 0;
  document.body.classList.toggle("tabbar-suspended", !!suspended && isMobileLikeViewport());
}

function isMedicineManagerOpen() {
  return Boolean(els.medicinesSheet?.open);
}

function syncTabbarForEditingState() {
  setTabbarSuspended(Boolean(activeSheet) || isMedicineManagerOpen() || isKeyboardEditingControl(document.activeElement));
}

function installTabbarViewportProtection() {
  /* Hide before the iOS keyboard starts resizing the visual viewport. */
  const preemptKeyboardShift = event => {
    if (!isKeyboardEditingControl(event.target)) return;
    setTabbarSuspended(true, 700);
    /* If a pointer/touch does not actually give focus (cancelled gesture,
       disabled control, etc.), never leave the bar hidden indefinitely. */
    window.setTimeout(() => {
      if (!isKeyboardEditingControl(document.activeElement)) {
        tabbarSuspendUntil = 0;
        setTabbarSuspended(false);
      }
    }, 850);
  };

  document.addEventListener("pointerdown", preemptKeyboardShift, { capture: true, passive: true });
  document.addEventListener("touchstart", preemptKeyboardShift, { capture: true, passive: true });

  document.addEventListener("focusin", event => {
    if (isKeyboardEditingControl(event.target)) setTabbarSuspended(true, 700);
  });

  document.addEventListener("focusout", () => {
    tabbarSuspendUntil = 0;
    window.setTimeout(syncTabbarForEditingState, 120);
  });

  const restoreTabbar = () => {
    if (activeSheet || isMedicineManagerOpen()) { setTabbarSuspended(true); return; }
    if (isKeyboardEditingControl(document.activeElement)) return;
    if (Date.now() < tabbarSuspendUntil) return;
    setTabbarSuspended(false);
  };

  window.addEventListener("pageshow", () => {
    tabbarSuspendUntil = 0;
    restoreTabbar();
  });
  window.addEventListener("orientationchange", () => window.setTimeout(restoreTabbar, 180));
  window.addEventListener("resize", () => window.setTimeout(restoreTabbar, 80), { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (isEditingControl(document.activeElement) && window.visualViewport.height < window.innerHeight * 0.92) {
        setTabbarSuspended(true);
      } else if (!isKeyboardEditingControl(document.activeElement)) {
        window.setTimeout(restoreTabbar, 100);
      }
    }, { passive: true });
    window.visualViewport.addEventListener("scroll", () => {
      if (!isKeyboardEditingControl(document.activeElement)) window.setTimeout(restoreTabbar, 80);
    }, { passive: true });
  }
}


function formatScheduleDate(date) { return I18N?.formatDateTime(date) || date.toLocaleString(); }
function scheduleFormValues() {
  const medicine=cleanField(els.scheduleMedicine?.value); const intervalHours=Number(els.scheduleIntervalHours?.value); const days=Number(els.scheduleDurationDays?.value); const start=new Date(els.scheduleStartAt?.value||'');
  if(!medicine || !Number.isFinite(intervalHours) || intervalHours<1 || intervalHours>248 || !Number.isFinite(days) || days<1 || Number.isNaN(start.getTime())) return null;
  const end=new Date(start.getTime()+days*86400000); return {medicine, intervalMinutes:Math.round(intervalHours*60), start, end, days};
}
function renderSchedulePreview() {
  if(!els.schedulePreview) return;
  const v=scheduleFormValues();
  if(!v){
    els.schedulePreview.innerHTML=`<div class="assistente-form-section__heading"><strong>${escapeHtml(tr('assistant.summary'))}</strong><small>${escapeHtml(tr('assistant.previewFill'))}</small></div>`;
    return;
  }
  const count=Math.max(0,Math.ceil((v.end-v.start)/(v.intervalMinutes*60000)));
  const last=count?new Date(v.start.getTime()+(count-1)*v.intervalMinutes*60000):null;
  const times=[]; const seen=new Set();
  for(let i=0;i<Math.min(count,24);i++){
    const d=new Date(v.start.getTime()+i*v.intervalMinutes*60000);
    const key=`${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if(!seen.has(key)){seen.add(key);times.push(key)}
    if(seen.size>=Math.ceil(1440/Math.min(v.intervalMinutes,1440))) break;
  }
  els.schedulePreview.innerHTML=`
    <div class="assistente-form-section__heading"><strong>${escapeHtml(tr('assistant.summary'))}</strong><small>${escapeHtml(tr('assistant.summaryHelp'))}</small></div>
    <div class="assistente-preview-times" aria-label="${escapeHtml(tr('assistant.dailyTimes'))}">${times.map(t=>`<span class="assistente-preview-time">${escapeHtml(t)}</span>`).join('')}</div>
    <div class="assistente-preview-list">
      <div><span>${escapeHtml(tr('assistant.totalDoses'))}</span><strong>${escapeHtml(tr('assistant.doseCount',{count}))}</strong></div>
      <div><span>${escapeHtml(tr('assistant.lastDose'))}</span><strong>${last?escapeHtml(formatScheduleDate(last)):'—'}</strong></div>
      <div><span>${escapeHtml(tr('assistant.endsAt'))}</span><strong>${escapeHtml(formatScheduleDate(v.end))}</strong></div>
    </div>`;
}
function closeScheduleSheet() {
  if (activeSheet === els.scheduleDialog) closeSheet();
  else if (els.scheduleDialog?.matches?.('[data-mm-secondary-layer]')) window.MMRegistro?.closeSecondarySheet?.(els.scheduleDialog);
}
function openScheduleDialog(scheduleId='') {
  if(!els.scheduleDialog) return;
  renderMedicineSelects();
  const schedule=state.schedules.find(s=>s.id===scheduleId);
  const revision=schedule?currentScheduleRevision(schedule):null;
  els.scheduleId.value=schedule?.id||'';
  els.scheduleDialogTitle.textContent=schedule?tr('assistant.editSchedule'):tr('assistant.newSchedule');
  els.scheduleDeleteBtn.hidden=!schedule;
  if(revision){
    els.scheduleMedicine.value=revision.medicine;
    els.scheduleIntervalHours.value=String(revision.intervalMinutes/60);
    const d=new Date(revision.planStartAt);
    els.scheduleStartAt.value=`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    els.scheduleDurationDays.value=String(Math.max(1,Math.round((new Date(revision.endAt)-d)/86400000)));
  } else {
    const d=new Date(); d.setSeconds(0,0);
    els.scheduleStartAt.value=`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    els.scheduleIntervalHours.value='8';
    els.scheduleDurationDays.value='7';
    if(state.medicines[0])els.scheduleMedicine.value=state.medicines[0];
  }
  renderSchedulePreview();
  openSheet(els.scheduleDialog);
}
async function saveScheduleFromForm(event) {
  event?.preventDefault?.();
  const v=scheduleFormValues();
  if(!v)return showToast(tr('assistant.invalidSchedule'));
  const now=new Date().toISOString();
  const existing=state.schedules.find(s=>s.id===els.scheduleId.value);
  const revision={id:makeId(),effectiveFrom:existing?now:v.start.toISOString(),medicine:v.medicine,intervalMinutes:v.intervalMinutes,planStartAt:v.start.toISOString(),endAt:v.end.toISOString()};
  if(existing){existing.revisions.push(revision);existing.updatedAt=now;existing.status='active';}
  else state.schedules.push({id:makeId(),status:'active',createdAt:now,updatedAt:now,revisions:[revision]});
  state.medicines=uniqueMedicines([...state.medicines,v.medicine]);
  await saveState({reason:existing?'edit-schedule':'add-schedule'});
  closeScheduleSheet();
  renderAll();
  await reconcileMedicationNotifications();
  showToast(existing?tr('assistant.scheduleUpdated'):tr('assistant.scheduleCreated'));
}
async function deleteCurrentSchedule() {
  const schedule=state.schedules.find(s=>s.id===els.scheduleId.value);
  if(!schedule)return;
  const ok=confirm(tr('assistant.deleteConfirm'));
  if(!ok)return;
  schedule.status='cancelled';
  schedule.updatedAt=new Date().toISOString();
  await saveState({reason:'cancel-schedule'});
  closeScheduleSheet();
  renderAll();
  await reconcileMedicationNotifications();
  showToast(tr('assistant.scheduleDeleted'));
}
function scheduleProgress(schedule) {
  if(!schedule || schedule.status==='cancelled') return {planned:0,taken:0};
  const occurrences=scheduleOccurrences(schedule);
  const plannedKeys=new Set(occurrences.map(o=>scheduledOccurrenceKey(o.scheduleId,o.at)).filter(Boolean));
  const takenKeys=new Set(
    state.records
      .filter(r=>r.scheduleId===schedule.id)
      .map(recordScheduledOccurrenceKey)
      .filter(key=>key&&plannedKeys.has(key))
  );
  return {planned:plannedKeys.size,taken:takenKeys.size};
}
function nextPendingScheduleOccurrence(schedule, now = new Date()) {
  if(!schedule || schedule.status==='cancelled') return null;
  const used=usedScheduledOccurrenceKeys();
  return scheduleOccurrences(schedule,new Date(now.getTime()-1),new Date(8640000000000000))
    .find(o=>o.at>=now && !used.has(scheduledOccurrenceKey(o.scheduleId,o.at))) || null;
}
function renderSchedules() {
  if(!els.schedulesList)return;
  const query=normalizeKey(els.scheduleSearchInput?.value);
  const now=new Date();
  const groups={active:[],upcoming:[],done:[]};
  for(const schedule of state.schedules.filter(s=>s.status!=='cancelled')){
    const r=currentScheduleRevision(schedule,now)||schedule.revisions.at(-1);
    if(!r)continue;
    if(query&&!normalizeKey(r.medicine).includes(query))continue;
    const start=new Date(r.planStartAt),end=new Date(r.endAt);
    (start>now?groups.upcoming:end<=now?groups.done:groups.active).push({schedule,r});
  }
  const labels={active:tr('assistant.active'),upcoming:tr('assistant.upcoming'),done:tr('assistant.completed')};
  els.schedulesList.innerHTML=Object.entries(groups).filter(([,items])=>items.length).map(([key,items])=>`
    <section class="assistente-schedule-section">
      <div class="history-day">${escapeHtml(labels[key])}</div>
      <div class="history-day-card">${items.map(({schedule,r})=>{
        const p=scheduleProgress(schedule);
        const next=nextPendingScheduleOccurrence(schedule,now);
        const nextValue=next ? formatScheduleDate(next.at) : '';
        return `<button class="record-row assistente-schedule-row" type="button" data-schedule-id="${escapeHtml(schedule.id)}">
          <span class="record-icon" aria-hidden="true"><svg class="mm-icon" viewBox="0 0 24 24"><use href="mm-registro-icons.svg#clock"></use></svg></span>
          <span class="record-main"><strong class="assistente-schedule-title">${escapeHtml(r.medicine)} <span class="assistente-schedule-interval">· ${escapeHtml(tr('assistant.everyHours',{hours:r.intervalMinutes/60}).toLowerCase())}</span></strong><span class="assistente-schedule-period-line"><strong class="assistente-schedule-meta-label">${escapeHtml(tr('assistant.fromLabel'))}</strong>: ${escapeHtml(formatScheduleDate(new Date(r.planStartAt)))}</span><span class="assistente-schedule-period-line"><strong class="assistente-schedule-meta-label">${escapeHtml(tr('assistant.untilLabel'))}</strong>: ${escapeHtml(formatScheduleDate(new Date(r.endAt)))}</span>${nextValue?`<span class="assistente-schedule-next"><strong class="assistente-schedule-meta-label">${escapeHtml(tr('assistant.nextDoseLabel'))}</strong>: ${escapeHtml(nextValue)}</span>`:(key==='done'?`<span class="assistente-schedule-next">${escapeHtml(tr('assistant.noNextDose'))}</span>`:'')}</span>
          <span class="assistente-schedule-progress"><strong>${p.taken}/${p.planned}</strong></span>
        </button>`;
      }).join('')}</div>
    </section>`).join('') || `<div class="panel empty-state mm-card"><h2>${escapeHtml(tr('assistant.noSchedules'))}</h2><p>${escapeHtml(tr('assistant.noSchedulesHelp'))}</p></div>`;
}
function renderReminderToggle(){if(els.remindersToggle)els.remindersToggle.checked=state.remindersEnabled!==false;}
async function reconcileMedicationNotifications(){
  if(!window.MMNative?.isIOS||typeof window.MMNative?.reconcileMedicationNotifications!=='function')return;
  const now=new Date();
  const occurrences=state.remindersEnabled===false?[]:allScheduleOccurrences(now,new Date(now.getTime()+60*24*3600000)).filter(o=>o.at>now&&!isOccurrenceConsumed(o)).slice(0,60);
  await window.MMNative.reconcileMedicationNotifications(occurrences.map(o=>({
    id:`medsched.${o.scheduleId}.${o.at.getTime()}`,
    title:o.medicine,
    body:tr('assistant.notificationBody'),
    at:o.at.toISOString(),
    medicine:o.medicine,
    scheduleId:o.scheduleId,
    scheduledAt:o.at.toISOString()
  })),state.remindersEnabled!==false);
}
function renderAdherenceAnalysis(){
  if(!els.analysisPreview||!els.analysisPreview.isConnected)return;
  els.analysisPreview.querySelector('.assistente-analysis-adherence')?.remove();
  const start=analysisSelection.start?new Date(`${analysisSelection.start}T00:00:00`):new Date(0);
  const end=analysisSelection.end?new Date(`${analysisSelection.end}T23:59:59`):new Date();
  const stats=scheduledDoseStats(start,end);
  if(!stats.planned)return;
  const box=document.createElement('section');
  box.className='analysis-card assistente-analysis-adherence';
  box.innerHTML=`<h4>${escapeHtml(tr('assistant.scheduledAnalysis'))}</h4><div class="assistente-analysis-grid"><div><span>${escapeHtml(tr('assistant.plannedDoses'))}</span><strong>${stats.planned}</strong></div><div><span>${escapeHtml(tr('assistant.recordedDoses'))}</span><strong>${stats.taken}</strong></div><div><span>${escapeHtml(tr('assistant.adherence'))}</span><strong>${stats.adherence}%</strong></div><div><span>${escapeHtml(tr('assistant.onTime'))}</span><strong>${stats.punctuality}%</strong></div></div><p class="analysis-empty">${escapeHtml(tr('assistant.analysisHelp'))}</p>`;
  els.analysisPreview.appendChild(box);
}
function bindEvents() {
  els.homeScheduleBtn?.addEventListener('click',()=>openScheduleDialog());
  els.homeMedicinesBtn?.addEventListener('click',openMedicineManager);
  els.newScheduleBtn?.addEventListener('click',()=>openScheduleDialog());
  els.scheduleSearchInput?.addEventListener('input',renderSchedules);
  els.schedulesList?.addEventListener('click',e=>{const b=e.target.closest('[data-schedule-id]');if(b)openScheduleDialog(b.dataset.scheduleId);});
  ['scheduleMedicine','scheduleIntervalHours','scheduleStartAt','scheduleDurationDays'].forEach(id=>els[id]?.addEventListener('input',renderSchedulePreview));
  els.scheduleForm?.addEventListener('submit',saveScheduleFromForm);
  els.scheduleCancelBtn?.addEventListener('click',closeScheduleSheet);
  els.scheduleDeleteBtn?.addEventListener('click',deleteCurrentSchedule);
  els.scheduleManageMedicinesBtn?.addEventListener('click',openMedicineManager);
  els.remindersToggle?.addEventListener('change',async e=>{state.remindersEnabled=Boolean(e.target.checked);await saveState({reason:'reminders-toggle'});await reconcileMedicationNotifications();});
  els.overlay.addEventListener("click", closeSheet);
  document.querySelectorAll("[data-close-sheet]").forEach(button => button.addEventListener("click", closeSheet));
  els.nowBtn.addEventListener("click", setNow);
  els.entryDateTime.addEventListener("pointerdown", () => { entryDateTimeAuto = false; }, { passive: true });
  els.entryDateTime.addEventListener("keydown", () => { entryDateTimeAuto = false; });
  els.entryDateTime.addEventListener("input", () => {
    entryDateTimeAuto = false;
    syncDateTimeDisplay(els.entryDateTime, els.entryDateTimeDisplay);
  });
  els.entryDateTime.addEventListener("change", () => {
    entryDateTimeAuto = false;
    syncDateTimeDisplay(els.entryDateTime, els.entryDateTimeDisplay);
  });
  els.editDateTime.addEventListener("input", () => syncDateTimeDisplay(els.editDateTime, els.editDateTimeDisplay));
  els.editDateTime.addEventListener("change", () => syncDateTimeDisplay(els.editDateTime, els.editDateTimeDisplay));
  document.addEventListener("visibilitychange", () => {
    if (entryDateTimeAuto && document.visibilityState === "visible") refreshEntryDateTimeNow();
  });
  els.addBtn.addEventListener("click", addRecord);
  els.entryMedicine?.addEventListener('change',()=>{
    if (pendingScheduledNotificationContext && normalizeKey(els.entryMedicine.value)!==normalizeKey(pendingScheduledNotificationContext.medicine)) {
      clearScheduledNotificationContext();
    }
  });
  els.searchInput.addEventListener("input", () => { historyRenderLimit = HISTORY_RENDER_BATCH; renderRecords(); });
  els.dateFilterBtn.addEventListener("click", () => openMultiFilterDialog("history", "dates"));
  els.medicineFilterBtn.addEventListener("click", () => openMultiFilterDialog("history", "medicines"));
  els.clearFiltersBtn.addEventListener("click", clearHistoryFilters);
  els.records.addEventListener("click", event => {
    const action = event.target.closest("button[data-action]");
    if (action?.dataset.action === "load-more") {
      historyRenderLimit += HISTORY_RENDER_BATCH;
      renderRecords();
      return;
    }
    const record = event.target.closest(".assistente-history-row");
    if (!record) return;
    openEdit(record.dataset.id, action?.dataset.action === "relief");
  });
  els.records.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const record = event.target.closest(".assistente-history-row");
    if (!record) return;
    event.preventDefault();
    openEdit(record.dataset.id, false);
  });
  document.querySelectorAll("[data-relief]").forEach(button => button.addEventListener("click", () => { applyReliefPreset(button.dataset.relief).catch(console.error); }));
  els.saveEditBtn.addEventListener("click", saveEdit);
  els.deleteRecordBtn.addEventListener("click", deleteCurrentRecord);
  els.addMedicineBtn.addEventListener("click", addMedicine);
  els.medicineManagerDoneBtn?.addEventListener("click", closeMedicineManager);
  document.querySelectorAll("[data-close-medicine-manager]").forEach(button => button.addEventListener("click", closeMedicineManager));
  els.medicinesSheet?.addEventListener("close", () => setTabbarSuspended(false));
  els.medicinesList.addEventListener("click", event => {
    const button = event.target.closest("button[data-med-action]");
    if (!button) return;
    const row = button.closest(".manager-row");
    if (!row) return;
    if (button.dataset.medAction === "up") moveMedicine(row.dataset.medicine, "up");
    if (button.dataset.medAction === "down") moveMedicine(row.dataset.medicine, "down");
    if (button.dataset.medAction === "rename") renameMedicine(row.dataset.medicine);
    if (button.dataset.medAction === "delete") deleteMedicine(row.dataset.medicine);
  });
  document.querySelectorAll("[data-more-action]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.moreAction;
    if (action === "analytics") return openAnalysisSheet();
    if (action === "import") return els.fileInput.click();
    if (action === "csv") return exportSingleFile(toCsv(state.records), "Assistente_Medicacao_Historico.csv", "text/csv;charset=utf-8", button);
    if (action === "txt") return exportSingleFile(toTxt(state.records), "Assistente_Medicacao_Historico.txt", "text/plain;charset=utf-8", button);
    if (action === "backup") return exportSingleFile(backupJson(), "Assistente_Medicacao_Backup.json", "application/json", button);
    if (action === "image") return openExportPreview();
    if (action === "medicines") return openMedicineManager();
    if (action === "schedule") return openScheduleDialog();
    if (action === "install") return window.MMNative?.isNative ? undefined : openSheet(els.installSheet);
  }));
  els.moreClearBtn?.addEventListener("click", clearAllData);
  els.privacyPolicyBtn?.addEventListener("click", openPrivacyPolicy);
  els.supportBtn?.addEventListener("click", openSupport);
  els.supportEmailBtn?.addEventListener("click", openSupportEmail);
  els.diagnosticModeToggle?.addEventListener("change", event => setDiagnosticMode(Boolean(event.target.checked)));
  analysisDateRangeControl = window.MMRegistro.bindDateRange(els.analysisStartDate, els.analysisEndDate, {
    onChange: () => { analysisRangePreset = null; applyAnalysisInputValues(); renderAnalysisPreview(); }
  });
  els.analysisRefreshBtn?.addEventListener("click", () => { applyAnalysisInputValues(); renderAnalysisPreview(); });
  els.analysisImageBtn?.addEventListener("click", () => exportAnalysisImage(els.analysisImageBtn));
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-analysis-range]");
    if (!button) return;
    event.preventDefault();
    setAnalysisRangePreset(button.dataset.analysisRange);
  });
  els.fileInput.addEventListener("change", () => handleFile(els.fileInput.files?.[0]));
  els.importDialog.addEventListener("close", () => {
    if (els.importDialog.returnValue === "confirm") applyPendingImport().catch(console.error);
    else pendingImport = null;
  });
  els.historyExportBtn?.addEventListener("click", exportVisibleHistory);
  exportDateRangeControl = window.MMRegistro.bindDateRange(els.exportFilterFrom, els.exportFilterTo, {
    onChange: renderExportPreview
  });
  els.exportPreviewClearBtn?.addEventListener("click", clearExportFilters);
  els.multiFilterOptions.addEventListener("change", event => {
    const input = event.target.closest("input[data-filter-value]");
    if (!input) return;
    toggleMultiFilterValue(input.dataset.filterValue, input.checked);
  });
  els.multiFilterClearBtn.addEventListener("click", clearCurrentMultiFilterSelection);
  els.confirmImageExportBtn.addEventListener("click", () => exportImages(getExportPreviewRecords(), els.confirmImageExportBtn));
  window.addEventListener("keydown", event => { if (event.key === "Escape" && activeSheet) closeSheet(); });
}

async function registerServiceWorker() {
  // The PWA keeps its Service Worker exactly as before. In the Capacitor app,
  // the application shell is bundled locally and must not be controlled by it.
  if (window.MMNative?.isNative) return;
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js?v=1.0", {
      updateViaCache: "none"
    });
    try { await registration.update(); } catch (_) {}
  }
  catch (error) { console.warn("Service Worker não registrado:", error); }
}

async function init() {
  cacheElements();
  I18N?.init({ app:'diario' });
  initializeDiagnosticMode();
  diagnosticTrace('APP_INIT_BEGIN', { version:APP_VERSION });
  I18N?.bindLanguageSelector({ trigger:els.languageBtn, dialog:els.languageDialog });
  document.addEventListener('mm:localechange', () => {
    renderAll();
    syncAllDateTimeDisplays();
    renderAnalysisPreview();
    I18N?.apply(document);
    if (activeSheet === els.scheduleDialog) {
      els.scheduleDialogTitle.textContent = els.scheduleId?.value ? tr('assistant.editSchedule') : tr('assistant.newSchedule');
      renderSchedulePreview();
    }
    syncMedicinesToNative({ force: true });
    showToast(tr('language.changed'));
  });
  initMMAppShell();
  bindEvents();
  installTabbarViewportProtection();
  setNow();
  startEntryDateTimeClock();
  try {
    if (!("indexedDB" in window)) throw new Error(tr('error.indexedDB'));
    db = await openDatabase();
    diagnosticTrace('INDEXEDDB_OPENED');
    await loadState();
    diagnosticTrace('STATE_LOADED');
    bindNativeWatchEventRecovery();
    bindNativeScheduledNotificationRecovery();
    await window.MMNative?.watchEventsReady?.catch?.(error => {
      diagnosticTrace('WATCH_LISTENER_READY_ERROR', { message:String(error?.message || error) });
    });
    await window.MMNative?.notificationEventsReady?.catch?.(error => {
      diagnosticTrace('NOTIFICATION_LISTENER_READY_ERROR', { message:String(error?.message || error) });
    });
    await syncWatchMedicationEventsFromNative({ render: false });
    renderAll();
    // Establish the ordinary Home default first; notification recovery, when present,
    // must be the final authority over the medication shown to the user.
    refreshEntryMedicineDefault();
    setActiveTab("register");
    await recoverScheduledMedicationNotificationContext({ retry:true });
    await reconcileMedicationNotifications();
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch (_) {}
    }
    await registerServiceWorker();
    diagnosticTrace('APP_INIT_END');
  } catch (error) {
    diagnosticTrace('APP_INIT_ERROR', { message:String(error?.message || error) });
    console.error(error);
    els.statusLine.textContent = tr('error.storageOpen');
    showToast(error.message || tr('error.startup'));
  }
}

document.addEventListener("DOMContentLoaded", init);
