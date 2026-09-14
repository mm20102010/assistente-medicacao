import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('public');
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
};
const ok = (message) => console.log(`OK: ${message}`);

const requiredFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'mm-registro.css',
  'mm-registro-icons.svg',
  'sw.js',
  'manifest.webmanifest',
  '_headers',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

for (const rel of requiredFiles) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(`arquivo obrigatório ausente: ${rel}`);
  }
}
if (process.exitCode) process.exit(process.exitCode);
ok('arquivos essenciais presentes');

for (const rel of ['app.js', 'sw.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' });
    ok(`sintaxe JavaScript válida: ${rel}`);
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error.message;
    fail(`sintaxe JavaScript inválida em ${rel}: ${detail}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  ok('manifest.webmanifest é JSON válido');
} catch (error) {
  fail(`manifest.webmanifest inválido: ${error.message}`);
}

if (manifest) {
  if (manifest.start_url !== './') fail(`manifest start_url deve ser "./"; atual: ${JSON.stringify(manifest.start_url)}`);
  else ok('manifest start_url usa ./');

  if (manifest.scope !== './') fail(`manifest scope deve ser "./"; atual: ${JSON.stringify(manifest.scope)}`);
  else ok('manifest scope usa ./');

  if (manifest.display !== 'standalone') fail(`manifest display deve ser "standalone"; atual: ${JSON.stringify(manifest.display)}`);
  else ok('manifest display standalone');

  for (const icon of manifest.icons || []) {
    const src = String(icon.src || '').split(/[?#]/)[0];
    if (!src || !fs.existsSync(path.join(root, src))) fail(`ícone do manifest não encontrado: ${icon.src}`);
  }
}

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
if (!/const\s+APP_SHELL\s*=\s*["']\.\/["']\s*;/.test(sw)) {
  fail('sw.js deve definir APP_SHELL como "./"');
} else {
  ok('service worker usa APP_SHELL ./');
}

if (/APP_SHELL\s*=\s*["']\.\/index\.html["']/.test(sw)) {
  fail('sw.js não deve usar ./index.html como app shell');
}

const assetMatches = [...sw.matchAll(/["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
for (const asset of assetMatches) {
  if (asset === './') continue;
  const rel = asset.replace(/^\.\//, '').split(/[?#]/)[0];
  if (!rel || rel.includes('${')) continue;
  if (!fs.existsSync(path.join(root, rel))) fail(`asset referenciado pelo sw.js não encontrado: ${asset}`);
}
ok('assets estáticos do service worker verificados');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]);
for (const ref of refs) {
  if (/^(?:https?:|data:|mailto:|tel:|#)/i.test(ref)) continue;
  const local = ref.split('#')[0].split('?')[0];
  if (!local) continue;
  const rel = local.replace(/^\.\//, '').replace(/^\//, '');
  if (!fs.existsSync(path.join(root, rel))) fail(`recurso local de index.html não encontrado: ${ref}`);
}
ok('referências locais de index.html verificadas');

const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
for (const expected of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', '/sw.js']) {
  if (!headers.includes(expected)) fail(`_headers não contém regra esperada: ${expected}`);
}
ok('_headers verificado');

if (process.exitCode) process.exit(process.exitCode);
console.log('PWA validation tests: OK');
