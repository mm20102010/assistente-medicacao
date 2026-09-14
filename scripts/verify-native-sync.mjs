import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'diario-native-sync-'));

async function digestTree(base) {
  const result = new Map();
  async function walk(dir, rel='') {
    const entries = await fs.readdir(dir, {withFileTypes:true});
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const ent of entries) {
      const nextRel = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, nextRel);
      else if (ent.isFile()) {
        const data = await fs.readFile(full);
        result.set(nextRel, crypto.createHash('sha256').update(data).digest('hex'));
      } else throw new Error(`tipo não suportado no bundle: ${nextRel}`);
    }
  }
  await walk(base);
  return result;
}

function assertSame(a,b,label) {
  if (a.size !== b.size) throw new Error(`${label}: quantidade de arquivos diverge (${a.size} != ${b.size})`);
  for (const [rel,hash] of a) if (b.get(rel) !== hash) throw new Error(`${label}: divergência em ${rel}`);
}

try {
  await fs.mkdir(path.join(temp,'scripts'), {recursive:true});
  await fs.mkdir(path.join(temp,'ios/App/App'), {recursive:true});
  await fs.cp(path.join(root,'public'), path.join(temp,'public'), {recursive:true});
  for (const name of ['build-native.mjs','native-sync.mjs']) {
    await fs.copyFile(path.join(root,'scripts',name), path.join(temp,'scripts',name));
  }
  for (const script of ['build-native.mjs','native-sync.mjs']) {
    const result = spawnSync(process.execPath, [path.join(temp,'scripts',script)], {cwd:temp,encoding:'utf8'});
    if (result.status !== 0) throw new Error(`${script} falhou: ${result.stderr || result.stdout}`);
  }
  const [publicTree,nativeTree,iosTree] = await Promise.all([
    digestTree(path.join(temp,'public')),
    digestTree(path.join(temp,'native-web')),
    digestTree(path.join(temp,'ios/App/App/public'))
  ]);
  assertSame(publicTree,nativeTree,'public ↔ native-web');
  assertSame(publicTree,iosTree,'public ↔ ios/App/App/public');
  const config = JSON.parse(await fs.readFile(path.join(temp,'ios/App/App/capacitor.config.json'),'utf8'));
  if (config.appId !== 'br.com.mmregistro.assistentemedicacao' || config.webDir !== 'native-web' || config.ios?.contentInset !== 'never') {
    throw new Error('capacitor.config.json gerado não corresponde ao contrato nativo');
  }
  console.log(`native sync verification: OK (${publicTree.size} arquivos, byte a byte)`);
} finally {
  await fs.rm(temp,{recursive:true,force:true});
}
