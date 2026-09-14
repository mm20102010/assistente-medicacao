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

test('registro eventual permanece sem scheduleId; dose atrasada do agendado é associada automaticamente', () => {
  const ctx=makeContext(); setState(ctx,{records:[],medicines:['Amoxil 500','Dipirona'],schedules:[schedule([rev()])],remindersEnabled:true});
  const scheduled=val(ctx, `(()=>{ const d=new Date('2026-09-17T13:12:00Z'); const pad=n=>String(n).padStart(2,'0'); return annotateRecordWithSchedule(sanitizeRecord({id:'a',medicine:'Amoxil 500',date:d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()),time:pad(d.getHours())+':'+pad(d.getMinutes()),relief:'Não definido'})); })()`);
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


test('sanitizeRecord preserva scheduleId e scheduledAt válidos', () => {
  const ctx=makeContext();
  const record=val(ctx, `sanitizeRecord({id:'a',medicine:'Amoxil 500',date:'2026-09-17',time:'10:00',relief:'Não definido',scheduleId:'s1',scheduledAt:'2026-09-17T13:00:00.000Z'})`);
  assert.equal(record.scheduleId,'s1');
  assert.equal(record.scheduledAt,'2026-09-17T13:00:00.000Z');
});

test('dose futura até 1 minuto é baixada automaticamente; acima disso exige decisão do usuário', () => {
  const ctx=makeContext();
  const start=new Date(2026,8,17,10,0,45), end=new Date(start.getTime()+24*3600000);
  setState(ctx,{records:[],medicines:['Amoxil 500'],schedules:[schedule([rev({start:start.toISOString(),end:end.toISOString(),effective:start.toISOString(),interval:480})])],remindersEnabled:true});
  const near=val(ctx, `annotateRecordWithSchedule(sanitizeRecord({id:'near',medicine:'Amoxil 500',date:'2026-09-17',time:'10:00',relief:'Não definido'}))`);
  assert.equal(near.scheduleId,'s1');

  const future=new Date(2026,8,17,10,10,0), futureEnd=new Date(future.getTime()+24*3600000);
  setState(ctx,{records:[],medicines:['Amoxil 500'],schedules:[schedule([rev({start:future.toISOString(),end:futureEnd.toISOString(),effective:future.toISOString(),interval:480})])],remindersEnabled:true});
  const early=val(ctx, `annotateRecordWithSchedule(sanitizeRecord({id:'early',medicine:'Amoxil 500',date:'2026-09-17',time:'10:05',relief:'Não definido'}))`);
  assert.equal(early.scheduleId,'');
  const next=val(ctx, `nextOpenScheduledOccurrence('Amoxil 500', recordDateObject(sanitizeRecord({id:'early',medicine:'Amoxil 500',date:'2026-09-17',time:'10:05',relief:'Não definido'})))`);
  assert.equal(next.scheduleId,'s1');
});

test('reparo de migração associa registro existente praticamente no horário sem reclassificar eventual distante', () => {
  const ctx=makeContext();
  const start='2026-09-14T17:05:00.000Z', end='2026-09-21T17:05:00.000Z';
  const d=new Date(start); const pad=n=>String(n).padStart(2,'0');
  const same={id:'dip',medicine:'Dipirona',date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`,relief:'Não definido',scheduleId:'',scheduledAt:''};
  const farDate=new Date(d.getTime()-2*3600000);
  const far={id:'far',medicine:'Dipirona',date:`${farDate.getFullYear()}-${pad(farDate.getMonth()+1)}-${pad(farDate.getDate())}`,time:`${pad(farDate.getHours())}:${pad(farDate.getMinutes())}`,relief:'Não definido',scheduleId:'',scheduledAt:''};
  setState(ctx,{records:[same,far],medicines:['Dipirona'],schedules:[schedule([rev({medicine:'Dipirona',start,end,effective:start,interval:360})])],remindersEnabled:true});
  const changed=val(ctx,'repairNearScheduleAssociations()');
  assert.equal(changed,1);
  assert.equal(val(ctx,"state.records.find(r=>r.id==='dip').scheduleId"),'s1');
  assert.equal(val(ctx,"state.records.find(r=>r.id==='far').scheduleId"),'');
});

test('progresso do agendamento usa tratamento completo, não apenas doses vencidas', () => {
  const ctx=makeContext();
  const start=new Date(Date.now()+60*60_000), end=new Date(start.getTime()+24*3600000);
  const r=rev({start:start.toISOString(),end:end.toISOString(),effective:start.toISOString(),interval:480});
  const linked={id:'a',medicine:'Amoxil 500',date:'2026-09-14',time:'12:00',relief:'Não definido',scheduleId:'s1',scheduledAt:start.toISOString()};
  setState(ctx,{records:[linked],medicines:['Amoxil 500'],schedules:[schedule([r])],remindersEnabled:true});
  const progress=val(ctx,'scheduleProgress(state.schedules[0])');
  assert.deepEqual(JSON.parse(JSON.stringify(progress)),{planned:3,taken:1});
});

test('Kaloba de 1 em 1 hora por 7 dias mostra 1/168 e próxima dose pendente', () => {
  const ctx=makeContext();
  const start=new Date('2026-09-14T19:05:00.000Z');
  const end=new Date('2026-09-21T19:05:00.000Z');
  const r=rev({medicine:'Kaloba',start:start.toISOString(),end:end.toISOString(),effective:start.toISOString(),interval:60});
  const linked={id:'k1',medicine:'Kaloba',date:'2026-09-14',time:'16:05',relief:'Não definido',scheduleId:'s1',scheduledAt:start.toISOString()};
  setState(ctx,{records:[linked],medicines:['Kaloba'],schedules:[schedule([r])],remindersEnabled:true});
  const progress=val(ctx,'scheduleProgress(state.schedules[0])');
  assert.deepEqual(JSON.parse(JSON.stringify(progress)),{planned:168,taken:1});
  const next=val(ctx,"nextPendingScheduleOccurrence(state.schedules[0], new Date('2026-09-14T19:05:30.000Z')).at.toISOString()");
  assert.equal(next,'2026-09-14T20:05:00.000Z');
});

test('intervalo do agendamento aceita até 248 horas e rejeita 249', () => {
  const ctx=makeContext();
  const base={id:'r',effectiveFrom:'2026-09-14T10:00:00Z',medicine:'X',planStartAt:'2026-09-14T10:00:00Z',endAt:'2026-10-14T10:00:00Z'};
  ctx.__ok={...base,intervalMinutes:248*60};
  ctx.__bad={...base,intervalMinutes:249*60};
  assert.ok(val(ctx,'sanitizeScheduleRevision(__ok)'));
  assert.equal(val(ctx,'sanitizeScheduleRevision(__bad)'),null);
});

test('contexto exato da notificação de Kaloba substitui Dipirona que estava como default na Home', async () => {
  const ctx=makeContext();
  ctx.document.createElement=()=>({value:'',textContent:''});
  const at='2026-09-14T19:05:00.000Z';
  const end='2026-09-14T22:05:00.000Z';
  const r=rev({medicine:'Kaloba',start:at,end,effective:at,interval:60});
  setState(ctx,{records:[],medicines:['Dipirona','Kaloba'],schedules:[schedule([r])],remindersEnabled:true});
  const select={innerHTML:'',value:'Dipirona',children:[],appendChild(option){this.children.push(option)}};
  ctx.__select=select;
  vm.runInContext('els.entryMedicine=__select; els.entryDateTime=null;',ctx);
  const applied=await val(ctx,`applyScheduledNotificationContext({medicine:'Kaloba',scheduleId:'s1',scheduledAt:'${at}'})`);
  assert.equal(applied,true);
  assert.equal(select.value,'Kaloba');
  assert.equal(val(ctx,'pendingScheduledNotificationContext.medicine'),'Kaloba');
  assert.equal(val(ctx,'pendingScheduledNotificationContext.scheduleId'),'s1');
});

test('análise agendada separa previstas, vencidas, adesão, prazo, adiantadas, atrasadas e futuras', () => {
  const ctx=makeContext();
  const start='2026-09-14T10:00:00.000Z';
  const end='2026-09-14T16:00:00.000Z';
  const localFields = iso => {
    const d=new Date(iso); const pad=n=>String(n).padStart(2,'0');
    return {date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`};
  };
  const records=[
    {id:'on',medicine:'Kaloba',...localFields('2026-09-14T10:05:00.000Z'),relief:'Não definido',scheduleId:'s1',scheduledAt:'2026-09-14T10:00:00.000Z'},
    {id:'early',medicine:'Kaloba',...localFields('2026-09-14T10:20:00.000Z'),relief:'Não definido',scheduleId:'s1',scheduledAt:'2026-09-14T11:00:00.000Z'},
    {id:'late',medicine:'Kaloba',...localFields('2026-09-14T12:45:00.000Z'),relief:'Não definido',scheduleId:'s1',scheduledAt:'2026-09-14T12:00:00.000Z'}
  ];
  setState(ctx,{records,medicines:['Kaloba'],schedules:[schedule([rev({medicine:'Kaloba',start,end,effective:start,interval:60})])],remindersEnabled:true});
  const stats=JSON.parse(JSON.stringify(val(ctx,`scheduledDoseDetailedStats(new Date('2026-09-14T09:59:59.000Z'),new Date('2026-09-14T16:00:00.000Z'),new Date('2026-09-14T13:30:00.000Z'))`)));
  assert.equal(stats.medicineCount,1);
  assert.equal(stats.planned,6);
  assert.equal(stats.due,4);
  assert.equal(stats.taken,3);
  assert.equal(stats.takenDue,3);
  assert.equal(stats.onTime,1);
  assert.equal(stats.early,1);
  assert.equal(stats.late,1);
  assert.equal(stats.missed,1);
  assert.equal(stats.futurePending,2);
  assert.equal(stats.adherence,75);
  assert.equal(stats.punctuality,33);
  assert.equal(Math.round(stats.avgDeviationMinutes),30);
  assert.equal(stats.medicines[0].name,'Kaloba');
});

test('detalhamento dos planejados está localizado em português, inglês e espanhol e entra na exportação', () => {
  const i18n=fs.readFileSync(new URL('../public/i18n.js', import.meta.url),'utf8');
  for (const key of ['assistant.scheduledMedicines','assistant.dueDoses','assistant.overdueUnrecorded','assistant.pendingFutureDoses','assistant.earlyDoses','assistant.lateDoses','assistant.punctuality','assistant.avgDeviation','assistant.scheduledBreakdown','assistant.scheduledMethodNote']) {
    assert.ok((i18n.match(new RegExp(`"${key.replaceAll('.', '\\.') }"`,'g'))||[]).length>=3,`${key} deve existir nos três idiomas`);
  }
  assert.match(source,/function scheduledAnalysisHtml\(stats\)/);
  assert.match(source,/assistant\.scheduledBreakdown/);
  assert.match(source,/makeAnalysisImageFile[\s\S]*?assistant\.plannedDoses[\s\S]*?assistant\.punctuality/);
});

test('Análise dos agendados considera o tratamento completo, inclusive doses futuras', () => {
  const ctx=makeContext();
  const start='2026-09-14T19:05:00.000Z';
  const end='2026-09-21T19:05:00.000Z';
  const r=rev({medicine:'Kaloba',start,end,effective:start,interval:60});
  const d=new Date(start); const pad=n=>String(n).padStart(2,'0');
  const record={id:'k1',medicine:'Kaloba',date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`,relief:'Não definido',scheduleId:'s1',scheduledAt:start};
  setState(ctx,{records:[record],medicines:['Kaloba'],schedules:[schedule([r])],remindersEnabled:true});
  const bounds=val(ctx,'scheduledTreatmentBounds()');
  assert.equal(bounds.start.toISOString(),start);
  assert.equal(bounds.end.toISOString(),end);
  const stats=JSON.parse(JSON.stringify(val(ctx,`scheduledDoseDetailedStats(scheduledTreatmentBounds().start, scheduledTreatmentBounds().end, new Date('2026-09-14T19:05:30.000Z'))`)));
  assert.equal(stats.planned,168);
  assert.equal(stats.due,1);
  assert.equal(stats.taken,1);
  assert.equal(stats.futurePending,167);
  assert.equal(stats.adherence,100);
  assert.equal(stats.punctuality,100);
});
