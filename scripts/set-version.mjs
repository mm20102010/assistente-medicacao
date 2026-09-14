import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (process.argv[2] || '').trim().replace(/^v/i, '');

if (!/^\d+\.\d+(?:\.\d+)?$/.test(arg)) {
  console.error('Uso: npm run version:set -- 3.1');
  console.error('Formatos aceitos: 3.1, 3.1.0 ou 3.1.2');
  process.exit(1);
}

const parts = arg.split('.');
const displayVersion = parts.length === 3 && parts[2] === '0' ? `${parts[0]}.${parts[1]}` : arg;
const packageVersion = parts.length === 2 ? `${arg}.0` : arg;

const read = rel => readFile(path.join(root, rel), 'utf8');
const write = (rel, text) => writeFile(path.join(root, rel), text);
const exists = async rel => Boolean(await stat(path.join(root, rel)).catch(() => null));
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let app = await read('public/app.js');
const currentMatch = app.match(/const APP_VERSION = "([^"]+)";/);
if (!currentMatch) throw new Error('APP_VERSION não encontrado em public/app.js.');
const currentVersion = currentMatch[1];

const currentPkg = JSON.parse(await read('package.json'));
let technicalVersionAlreadyAligned = currentPkg.version === packageVersion && currentPkg.marketingVersion === packageVersion;
if (technicalVersionAlreadyAligned && await exists('ios/App/App.xcodeproj/project.pbxproj')) {
  const currentPbx = await read('ios/App/App.xcodeproj/project.pbxproj');
  const expected = `MARKETING_VERSION = ${packageVersion};`;
  technicalVersionAlreadyAligned = currentPbx.split(expected).length - 1 === 6;
}

if (currentVersion === displayVersion && technicalVersionAlreadyAligned) {
  console.log(`O Assistente já está na versão visual ${displayVersion} / técnica ${packageVersion}. Nenhuma alteração necessária.`);
  process.exit(0);
}


const appOwnedAssets = [
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'styles.css',
  'i18n.js',
  'native-runtime.js',
  'app.js'
];

function replaceRequired(text, search, replacement, label) {
  const next = text.replace(search, replacement);
  if (next === text) throw new Error(`Não foi possível atualizar ${label}. Estrutura inesperada.`);
  return next;
}

function replaceAssetVersion(text, asset, nextVersion) {
  const escaped = escapeRegExp(asset);
  const re = new RegExp(`(^|["'/(])${escaped}\\?v=\\d+(?:\\.\\d+){1,2}`, 'gm');
  return text.replace(re, `$1${asset}?v=${nextVersion}`);
}

// package.json e package-lock.json.
const pkg = JSON.parse(await read('package.json'));
pkg.version = packageVersion;
pkg.marketingVersion = packageVersion;
await write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

if (await exists('package-lock.json')) {
  const lock = JSON.parse(await read('package-lock.json'));
  lock.version = packageVersion;
  if (lock.packages?.['']) lock.packages[''].version = packageVersion;
  await write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
} else {
  console.warn('AVISO: package-lock.json não encontrado; execute npm install antes do gate.');
}

// app.js: versão exibida e URL do service worker.
app = replaceRequired(app, /const APP_VERSION = "[^"]+";/, `const APP_VERSION = "${displayVersion}";`, 'APP_VERSION');
app = replaceRequired(app, /const DIAGNOSTIC_REVISION = '[^']+';/, `const DIAGNOSTIC_REVISION = '${displayVersion}';`, 'DIAGNOSTIC_REVISION');
app = app.replace(/\.\/sw\.js\?v=\d+(?:\.\d+){1,2}/g, `./sw.js?v=${displayVersion}`);
await write('public/app.js', app);


// Xcode/App Store: Marketing Version usa a versão técnica SemVer completa.
if (await exists('ios/App/App.xcodeproj/project.pbxproj')) {
  let pbx = await read('ios/App/App.xcodeproj/project.pbxproj');
  const marketingMatches = pbx.match(/MARKETING_VERSION = \d+(?:\.\d+){1,2};/g) || [];
  if (!marketingMatches.length) throw new Error('MARKETING_VERSION não encontrado no projeto Xcode.');
  pbx = pbx.replace(/MARKETING_VERSION = \d+(?:\.\d+){1,2};/g, `MARKETING_VERSION = ${packageVersion};`);
  await write('ios/App/App.xcodeproj/project.pbxproj', pbx);
}

// index.html: só assets do Assistente. mm-registro.* mantém a própria versão do Core.
let index = await read('public/index.html');
for (const asset of appOwnedAssets) index = replaceAssetVersion(index, asset, displayVersion);
index = replaceRequired(index, />v\d+(?:\.\d+){1,2}</, `>v${displayVersion}<`, 'versão visível em public/index.html');
await write('public/index.html', index);

// Service Worker: cache e assets do Assistente. Não toca em mm-registro.*.
let sw = await read('public/sw.js');
sw = replaceRequired(sw, /assistente-medicacao-v\d+(?:\.\d+){1,2}-cf/, `assistente-medicacao-v${displayVersion}-cf`, 'nome do cache');
for (const asset of appOwnedAssets) sw = replaceAssetVersion(sw, asset, displayVersion);
await write('public/sw.js', sw);

// Comentário do catálogo específico do app.
if (await exists('public/i18n.js')) {
  let i18n = await read('public/i18n.js');
  i18n = i18n.replace(/\/\* App translations \d+(?:\.\d+){1,2} \*\//, `/* App translations ${displayVersion} */`);
  await write('public/i18n.js', i18n);
}

// Nome do ZIP web.
let pack = await read('scripts/package-web.mjs');
pack = replaceRequired(pack, /Assistente_Medicacao_WEB_\d+(?:\.\d+){1,2}\.zip/, `Assistente_Medicacao_WEB_${displayVersion}.zip`, 'nome do ZIP web');
await write('scripts/package-web.mjs', pack);

// Os testes descobrem a versão corrente a partir dos arquivos do app e não
// precisam mais ser reescritos a cada release.

// README corrente. Documentos históricos de migração não são renumerados.
if (await exists('README.md')) {
  let doc = await read('README.md');
  doc = doc.replace(/Repositório unificado do \*\*Assistente de Medicação \d+(?:\.\d+){1,2}\*\*/, `Repositório unificado do **Assistente de Medicação ${displayVersion}**`);
  doc = doc.replace(/dist\/Assistente_Medicacao_WEB_\d+(?:\.\d+){1,2}\.zip/g, `dist/Diario_Medicacao_WEB_${displayVersion}.zip`);
  await write('README.md', doc);
}

console.log(`Versão do Diário atualizada: ${currentVersion} → ${displayVersion}`);
console.log(`Versão npm: ${packageVersion}`);
console.log('MM Registro Core foi preservado sem alteração.');
console.log('Agora execute: npm run repo:gate && npm run native:sync');
