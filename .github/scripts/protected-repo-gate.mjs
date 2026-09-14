import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const required = [
  'package.json','package-lock.json','capacitor.config.ts','public/app.js','public/index.html',
  'scripts/validate-pwa.mjs','scripts/validate-release.mjs','scripts/native-validate.mjs',
  'ios/App/App/WatchSessionManager.swift','ios/App/Assistente Watch Watch App/WatchSessionManager.swift'
];
for (const rel of required) if (!fs.existsSync(path.join(root, rel))) errors.push(`ausente: ${rel}`);

const forbiddenNames = new Set(['__MACOSX']);
const forbiddenFiles = [/^\.env(?:\.|$)/, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.log$/i, /\.DS_Store$/];
function walk(dir, rel='') {
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (['.git','updates','node_modules','native-web','dist'].some(name => childRel === name || childRel.startsWith(`${name}/`))) continue;
    if (forbiddenNames.has(ent.name)) { errors.push(`conteúdo local proibido: ${childRel}`); continue; }
    if (forbiddenFiles.some(re => re.test(ent.name))) errors.push(`arquivo sensível/temporário: ${childRel}`);
    if (ent.isSymbolicLink()) errors.push(`symlink não permitido: ${childRel}`);
    else if (ent.isDirectory()) walk(path.join(dir, ent.name), childRel);
  }
}
walk(root);

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  for (const name of ['test','web:validate','validate:repo','validate:artifact','native:verify-sync','native:validate','repo:gate']) {
    if (!pkg.scripts?.[name]) errors.push(`script obrigatório ausente: ${name}`);
  }
} catch (error) { errors.push(`package.json inválido: ${error.message}`); }

if (fs.existsSync(path.join(root,'ios/App/App/WatchSessionManager.swift'))) {
  const swift = fs.readFileSync(path.join(root,'ios/App/App/WatchSessionManager.swift'),'utf8');
  if (!/string\(forKey: key\) == value \? value : ""/.test(swift)) errors.push('stateSourceID não é fail-closed');
  if (!/guard !Self\.stateSourceID\.isEmpty/.test(swift)) errors.push('envio de estado não bloqueia source ID efêmero');
}
if (fs.existsSync(path.join(root,'public/app.js'))) {
  const app = fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  if (!/persistedRecordIDSet/.test(app) || !/acknowledgeWatchMedicationEvent/.test(app)) errors.push('readback/ACK Watch ausente');
}

if (errors.length) {
  console.error(`Protected repository gate failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('protected repository gate: OK');
