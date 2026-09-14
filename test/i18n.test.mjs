import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const store=new Map();
const ctx={
  console, Intl, Date, crypto:webcrypto, URL, URLSearchParams, Blob, File:globalThis.File,
  navigator:{languages:['pt-BR'],language:'pt-BR'},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
  document:{addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,documentElement:{},body:null},
  window:null, MutationObserver:undefined, CustomEvent:globalThis.CustomEvent,
  setTimeout,clearTimeout
};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../public/mm-registro-i18n.js',import.meta.url),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('../public/i18n.js',import.meta.url),'utf8'),ctx);
ctx.MMI18n.init({app:'diario'});
assert.equal(ctx.MMI18n.validateCatalog('diario').ok,true);
assert.ok(ctx.MMI18n.validateCatalog('diario').keys > 180);
assert.equal(ctx.MMI18n.t('app.title'),'Assistente de Medicação');
assert.equal(ctx.MMI18n.setMode('en-US',{emit:false}),true);
assert.equal(ctx.MMI18n.t('app.title'),'Medication Assistant');
assert.equal(ctx.MMI18n.t('range.between',{start:'08/01',end:'08/10'}),'08/01 to 08/10');
assert.equal(ctx.MMI18n.translateSource('Sumax Pro'),'Sumax Pro');
assert.equal(store.get('mm.locale.mode'),'en-US');
assert.equal(ctx.MMI18n.setMode('es-ES',{emit:false}),true);
assert.equal(ctx.MMI18n.t('app.title'),'Asistente de Medicación');
ctx.MMI18n.setMode('pt-BR',{emit:false});

let app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/document\.addEventListener\("DOMContentLoaded", init\);\s*$/,'');
app += '\nglobalThis.__parseDateTimeText=parseDateTimeText;globalThis.__parseTextHistory=parseTextHistory;globalThis.__toCsv=toCsv;globalThis.__canonicalRelief=canonicalRelief;globalThis.__validateState=validateState;globalThis.__buildImportedMedicineList=buildImportedMedicineList;globalThis.__watchMedicationEventToRecord=watchMedicationEventToRecord;';
vm.runInContext(app,ctx);
let parsed=ctx.__parseDateTimeText('08/10/2026 at 4:30 PM');
assert.deepEqual(JSON.parse(JSON.stringify(parsed)),{date:'2026-08-10',time:'16:30'});
parsed=ctx.__parseDateTimeText('10/08/2026 a las 16:30');
assert.deepEqual(JSON.parse(JSON.stringify(parsed)),{date:'2026-08-10',time:'16:30'});
parsed=ctx.__parseDateTimeText('10/Aug/2026 at 4:30 PM');
assert.deepEqual(JSON.parse(JSON.stringify(parsed)),{date:'2026-08-10',time:'16:30'});
assert.equal(ctx.__canonicalRelief('Not defined'),'Não definido');
assert.equal(ctx.__canonicalRelief('Sin alivio'),'Sem alívio');
const orderedState=ctx.__validateState({version:1,records:[],medicines:['Dipirona','Sumax Pro','Dorflex']});
assert.equal(orderedState.medicines[0],'Dipirona','validateState deve preservar a ordem configurada dos remédios');
const backupOrder=['Dorflex','Sumax Pro','Dipirona'];
const importData={medicines:backupOrder,records:[{medicine:'Sumax Pro'},{medicine:'Allegra D'}]};
assert.deepEqual(JSON.parse(JSON.stringify(ctx.__buildImportedMedicineList('replace',importData,['Dipirona','Dorflex']))),['Dorflex','Sumax Pro','Dipirona','Allegra D'],'importação JSON em substituir deve reconstruir a ordem salva no backup');
assert.deepEqual(JSON.parse(JSON.stringify(ctx.__buildImportedMedicineList('merge',importData,['Dipirona','Dorflex']))),['Dipirona','Dorflex','Sumax Pro','Allegra D'],'importação em acrescentar deve preservar a ordem atual e anexar novos remédios');
const watchRecord=ctx.__watchMedicationEventToRecord({id:'B1E8906D-3E1B-4F7B-9D6E-A6B4B1F0830B',medicine:'  Dipirona  ',occurredAt:'2026-08-11T19:30:00Z',localDate:'2026-08-11',localTime:'16:30'});
assert.equal(watchRecord.id,'B1E8906D-3E1B-4F7B-9D6E-A6B4B1F0830B');
assert.equal(watchRecord.medicine,'Dipirona');
assert.equal(watchRecord.date,'2026-08-11');
assert.equal(watchRecord.time,'16:30');
assert.equal(watchRecord.relief,'Não definido');
assert.equal(watchRecord.createdAt,'2026-08-11T19:30:00.000Z');
let history=ctx.__parseTextHistory('Date,Medication,Relief\n08/10/2026 at 4:30 PM,Sumax Pro,2 hours');
assert.equal(history.records.length,1);assert.equal(history.records[0].date,'2026-08-10');assert.equal(history.records[0].relief,'2 horas');
history=ctx.__parseTextHistory('Fecha,Medicamento,Alivio\n10/08/2026 a las 16:30,Sumax Pro,No definido');
assert.equal(history.records.length,1);assert.equal(history.records[0].relief,'Não definido');
ctx.MMI18n.setMode('en-US',{emit:false});
const csv=ctx.__toCsv([{id:'1',date:'2026-08-10',time:'16:30',medicine:'Sumax Pro',relief:'2 horas'}]);
assert.match(csv,/Date,Medication,Relief/);assert.match(csv,/2 hours/);assert.match(csv,/08\/10\/2026 at 4:30 PM/);
ctx.MMI18n.setMode('es-ES',{emit:false});
const csvEs=ctx.__toCsv([{id:'1',date:'2026-08-10',time:'16:30',medicine:'Sumax Pro',relief:'Não definido'}]);
assert.match(csvEs,/Fecha,Medicamento,Alivio/);assert.match(csvEs,/No definido/);assert.match(csvEs,/10\/08\/2026 a las 16:30/);

const appSource=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.match(appSource,/await loadState\(\);[\s\S]*?renderAll\(\);[\s\S]*?refreshEntryMedicineDefault\(\);[\s\S]*?setActiveTab\(\"register\"\)/,'inicialização deve aplicar o primeiro remédio somente depois de carregar a ordem persistida');
assert.match(appSource,/function refreshEntryMedicineDefault\(\)[\s\S]*?state\.medicines\[0\]/,'remédio padrão da Home deve ser sempre o primeiro item da lista persistida');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const appVersion=index.match(/manifest\.webmanifest\?v=([0-9.]+)/)?.[1];assert.ok(appVersion,'versão do app deve estar presente no index');assert.match(index,/mm-registro-i18n\.js\?v=4\.0/);assert.ok(index.includes(`src="i18n.js?v=${appVersion}"`));assert.match(index,/id="languageBtn"/);assert.equal((index.match(/data-locale-mode=/g)||[]).length,4);
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');assert.match(sw,/mm-registro-i18n\.js\?v=4\.0/);assert.ok(sw.includes(`"./i18n.js?v=${appVersion}"`));
const mmCss=fs.readFileSync(new URL('../public/mm-registro.css',import.meta.url),'utf8');
assert.match(mmCss,/body\.mm-registro \.mm-primary-header\{[\s\S]*?position:sticky;[\s\S]*?top:0;/,'header de Início deve permanecer ancorado');
assert.match(mmCss,/body\.mm-registro \.mm-secondary-header\{[\s\S]*?position:sticky;[\s\S]*?top:0;/,'header de Ferramentas/Histórico deve permanecer ancorado');
const cleaned=index.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<svg[\s\S]*?<\/svg>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
const texts=[...cleaned.matchAll(/>([^<>]+)</g)].map(m=>m[1].replace(/\s+/g,' ').trim()).filter(t=>/[A-Za-zÀ-ÿ]/.test(t));
const missing=[...new Set(texts.filter(t=>!/^v\d+(?:\.\d+){1,2}$/.test(t)&&!ctx.MMI18n.hasSource(t)))];
assert.deepEqual(missing,[],'todo texto estático significativo deve possuir tradução');
console.log('diario i18n/import-export tests: OK');
