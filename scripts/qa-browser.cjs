// Run with PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE pointing to an installed
// Playwright module and Chromium binary. Artifacts default to /tmp/mm-qa.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../public');
const out=process.env.QA_OUTPUT || '/tmp/mm-qa';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/blank'){res.end('<html></html>');return}
  const file=path.join(root,name==='/'?'index.html':name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  try {res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-gpu']});
  try {
    const page=await browser.newPage({viewport:{width:430,height:932},serviceWorkers:'block'});
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin+'/blank');
    await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('diario_medicacao',1);r.onupgradeneeded=()=>r.result.createObjectStore('app_state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      await new Promise((resolve,reject)=>{const tx=db.transaction('app_state','readwrite');tx.objectStore('app_state').put({version:1,medicines:['Teste'],records:Array.from({length:10001},(_,i)=>({id:`row-${i}`,medicine:'Teste',date:'2026-09-01',time:'12:00',relief:'1 hora',createdAt:'2026-09-01T12:00:00Z',updatedAt:'2026-09-01T12:00:00Z'}))},'main');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();
    });
    await page.goto(origin);await page.waitForFunction(()=>document.querySelectorAll('#records .record').length===250);
    assert.equal(await page.evaluate(()=>state.records.length),10001);
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#records .record').length===250);
    assert.equal(await page.evaluate(()=>state.records.length),10001);
    await page.evaluate(()=>setActiveTab('history'));
    await page.locator('button[data-action="load-more"]').click();
    assert.equal(await page.locator('#records .record').count(),500);
    const mutations=await page.evaluate(async()=>{
      let puts=0;const original=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='records')puts++;return original.apply(this,args)};
      try{state.records.push({...state.records[0],id:'added'});await saveState();return {puts,count:(await dbGet(STATE_KEY)).records.length}}finally{IDBObjectStore.prototype.put=original}
    });assert.deepEqual(mutations,{puts:1,count:10002});
    const failure=await page.evaluate(async()=>{
      const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='records'){this.transaction.abort();throw new Error('quota simulada')}return original.apply(this,args)};
      let rejected=false;state.records.push({...state.records[0],id:'failed'});
      try{await saveState()}catch{rejected=true}finally{IDBObjectStore.prototype.put=original}
      const before=(await dbGet(STATE_KEY)).records.length;await saveState();return {rejected,before,after:(await dbGet(STATE_KEY)).records.length};
    });assert.deepEqual(failure,{rejected:true,before:10002,after:10003});
    const restored=await page.evaluate(async()=>{
      const backup=backupJson();
      confirmAction=async()=>true;
      await clearAllData();
      const empty=(await dbGet(STATE_KEY)).records.length;
      pendingImport=parseBackupJson(backup);
      document.querySelector('input[name="importMode"][value="replace"]').checked=true;
      await applyPendingImport();
      const restored=(await dbGet(STATE_KEY)).records.length;
      return {empty,restored};
    });assert.deepEqual(restored,{empty:0,restored:10003});
    for(const locale of ['pt-BR','en-US','es-ES']) {
      const image=await page.evaluate(async locale=>{
        MMI18n.setMode(locale,{emit:false});
        const longName='Medicamento personalizado com nome longo para teste de relatório e legibilidade';
        state.records=Array.from({length:120},(_,i)=>({id:`fixture-${i}`,medicine:longName,date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),time:'12:00',relief:'1 hora',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-01-01T12:00:00Z'}));
        state.medicines=[longName];analysisSelection={start:'2026-01-01',end:'2026-04-30'};
        const summary=computeAnalysisData();
        const overflow=[];const original=CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
          const w=this.measureText(text).width;let left=this.textAlign==='right'?x-w:this.textAlign==='center'?x-w/2:x;
          if(left<0||left+w>this.canvas.width+1||y<0||y>this.canvas.height)overflow.push({text,x,y,w});
          return original.call(this,text,x,y,...rest);
        };
        try {const file=await makeAnalysisImageFile(summary);const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(file)});return {base64,overflow};}
        finally{CanvasRenderingContext2D.prototype.fillText=original}
      },locale);
      assert.deepEqual(image.overflow,[],`${locale}: texto fora do canvas`);
      fs.writeFileSync(path.join(out,`diario-${locale}.png`),Buffer.from(image.base64,'base64'));
    }
    console.log('Chromium: migração 10.001, reload, paginação, gravação incremental, aborto/retry, clear-all/restore e PNG pt/en/es aprovados.');
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>server.close());
