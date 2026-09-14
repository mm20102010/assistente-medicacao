import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const repoMode = args.includes('--repo');
const rootArg = args.find(arg => arg !== '--repo') || '.';
const root = path.resolve(rootArg);

const localOnlyNames = new Set(['node_modules', '.git', 'native-web', 'dist']);
const alwaysForbiddenNames = new Set(['__MACOSX']);
const forbiddenFiles = [/^\.env(?:\.|$)/, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.log$/i, /\.DS_Store$/];
const required = [
  'package.json', 'package-lock.json', 'public/index.html', 'public/app.js',
  'ios/App/App.xcodeproj/project.pbxproj', '.github/workflows/deploy.yml',
  '.github/workflows/apply-zip-update.yml'
];
const errors = [];

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) errors.push(`ausente: ${rel}`);
}

function walk(dir, rel = '') {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (alwaysForbiddenNames.has(ent.name)) { errors.push(`proibido: ${childRel}`); continue; }
    if (localOnlyNames.has(ent.name)) { if (!repoMode) errors.push(`proibido: ${childRel}`); continue; }
    if (forbiddenFiles.some(re => re.test(ent.name))) errors.push(`arquivo sensível/temporário: ${childRel}`);
    if (ent.isSymbolicLink()) errors.push(`symlink não permitido: ${childRel}`);
    else if (ent.isDirectory()) walk(path.join(dir, ent.name), childRel);
  }
}

walk(root);

// Generated Capacitor payloads belong to the build workspace, never to the release ZIP.
for (const rel of ['ios/App/App/public', 'ios/App/App/capacitor.config.json']) {
  if (!repoMode && fs.existsSync(path.join(root, rel))) errors.push(`gerado não permitido no release: ${rel}`);
}

if (errors.length) {
  console.error(`${repoMode ? 'Repositório inválido' : 'Release inválido'}:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(repoMode ? 'repository validation: OK' : 'release artifact validation: OK');
