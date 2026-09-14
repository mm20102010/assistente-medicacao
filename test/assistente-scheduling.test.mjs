import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function makeContext() {
  const window = { MMI18n:null, MMNative:{isIOS:false} };
  const document = { addEventListener(){}, getElementById(){return null}, visibilityState:'visible' };
  const ctx = vm.createContext({window,document,console,Date,Intl,Math,Set,Map,JSON,Promise,structuredClone,crypto:{randomUUID:()=>`id-${Math.random()}`},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask});
  vm.runInContext(source, ctx);
  return ctx;
}
function setState(ctx, value) { ctx.__state = value; vm.runInContext('state = __state', ctx); }
function val(ctx, expr) { return vm.runInContext(expr, ctx); }

const rev = ({id='r1', medicine='Amoxil 500', start='2026-09-17T10:00:00-03:00', end='2026-09-24T10:00:00-03:00', effective=start, interval=480}={}) => ({id,effectiveFrom:effective,medicine,intervalMinutes:interval,planStartAt:start,endAt:end});
const schedule = revisions => ({id:'s1',status:'active',createdAt:'2026-09-17T10:00:00-03:00',updatedAt:'2026-09-17T10:00:00-03:00',revisions});

test('8 em 8 horas por 7 dias produz 21 doses e última às 02h', () => {
  const ctx=makeContext(); setState(ctx,{records:[],medicines:['Amoxil 500'],schedules:[schedule([rev()])],remindersEnabled:true});
  const out=val(ctx, `scheduleOccurrences(state.schedules[0], new Date('2026-09-17T00:00:00-03:00'), new Date('2026-09-25T00:00:00-03:00')).map(o=>o.at.toISOString())`);
  assert.equal(out.length,21);
  assert.equal(out[0],'2026-09-17T13:00:00.000Z'); // 10:00 BRT representado como instante UTC
  assert.equal(out.at(-1),'2026-09-24T05:00:00.000Z');
});

test('edição cria nova vigência sem reescrever horários históricos', () => {
  const ctx=makeContext();
  const old=rev({end:'2026-09-24T10:00:00-03:00'});
  const newer=rev({id:'r2',start:'2026-09-19T11:00:00-03:00',end:'2026-09-26T11:00:00-03:00',effective:'2026-09-19T09:00:00-03:00'});
  setState(ctx,{records:[],medicines:['Amoxil 500'],schedules:[schedule([old,newer])],remindersEnabled:true});
  const out=val(ctx, `scheduleOccurrences(state.schedules[0], new Date('2026-09-18T00:00:00-03:00'), new Date('2026-09-20T23:59:59-03:00')).map(o=>o.at.toISOString())`);
  assert.ok(out.includes('2026-09-18T13:00:00.000Z')); // antigo 10h
  assert.ok(out.includes('2026-09-19T14:00:00.000Z')); // novo 11h
  assert.ok(!out.includes('2026-09-19T13:00:00.000Z')); // antigo 10h não sobrevive após vigência
});

test('registro eventual permanece sem scheduleId; agendado é associado automaticamente', () => {
  const ctx=makeContext(); setState(ctx,{records:[],medicines:['Amoxil 500','Dipirona'],schedules:[schedule([rev()])],remindersEnabled:true});
  const scheduled=val(ctx, `annotateRecordWithSchedule(sanitizeRecord({id:'a',medicine:'Amoxil 500',date:'2026-09-17',time:'10:12',relief:'Não definido'}))`);
  const eventual=val(ctx, `annotateRecordWithSchedule(sanitizeRecord({id:'b',medicine:'Dipirona',date:'2026-09-17',time:'15:00',relief:'Não definido'}))`);
  assert.equal(scheduled.scheduleId,'s1'); assert.ok(scheduled.scheduledAt);
  assert.equal(eventual.scheduleId,''); assert.equal(eventual.scheduledAt,'');
});

test('adesão e pontualidade são calculadas separadamente para doses agendadas', () => {
  const ctx=makeContext();
  const localFields = iso => {
    const d=new Date(iso);
    const pad=n=>String(n).padStart(2,'0');
    return {date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`};
  };
  const first=localFields('2026-09-17T13:05:00Z');
  const second=localFields('2026-09-17T21:45:00Z');
  const eventual=localFields('2026-09-17T18:00:00Z');
  const records=[
    {id:'a',medicine:'Amoxil 500',...first,relief:'Não definido',scheduleId:'s1',scheduledAt:'2026-09-17T13:00:00.000Z'},
    {id:'b',medicine:'Amoxil 500',...second,relief:'Não definido',scheduleId:'s1',scheduledAt:'2026-09-17T21:00:00.000Z'},
    {id:'c',medicine:'Dipirona',...eventual,relief:'Não definido',scheduleId:'',scheduledAt:''}
  ];
  setState(ctx,{records,medicines:['Amoxil 500','Dipirona'],schedules:[schedule([rev({start:'2026-09-17T13:00:00Z',end:'2026-09-18T13:00:00Z',effective:'2026-09-17T13:00:00Z'})])],remindersEnabled:true});
  const stats=val(ctx, `scheduledDoseStats(new Date('2026-09-17T00:00:00Z'), new Date('2026-09-17T23:59:59Z'))`);
  assert.deepEqual(JSON.parse(JSON.stringify(stats)),{planned:2,taken:2,onTime:1,adherence:100,punctuality:50});
});

test('projeção do Watch contém apenas a agenda e mantém próximos horários independentes de eventual', () => {
  const ctx=makeContext();
  const now=new Date(); const start=new Date(now.getTime()+3600000); const end=new Date(start.getTime()+24*3600000);
  const r=rev({start:start.toISOString(),end:end.toISOString(),effective:start.toISOString(),interval:480});
  setState(ctx,{records:[{id:'e',medicine:'Dipirona',date:'2026-09-14',time:'12:00',relief:'Não definido',scheduleId:'',scheduledAt:''}],medicines:['Amoxil 500','Dipirona'],schedules:[schedule([r])],remindersEnabled:true});
  const projection=val(ctx,'medicationProjectionForWatch()');
  assert.ok(projection.occurrences.length>=1);
  assert.ok(projection.occurrences.every(o=>o.medicine==='Amoxil 500'));
  assert.ok(projection.nextScheduledAt);
});
