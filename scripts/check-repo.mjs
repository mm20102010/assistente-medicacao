import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/sw.js',
  'public/manifest.webmanifest',
  'public/native-runtime.js',
  'package.json',
  'capacitor.config.ts',
  'scripts/build-native.mjs',
  'scripts/package-web.mjs',
  'native-assets/ios/icon-1024.png',
];

for (const rel of required) {
  await access(path.join(root, rel));
}

for (const duplicate of ['index.html', 'app.js', 'styles.css', 'sw.js']) {
  const exists = await stat(path.join(root, duplicate)).catch(() => null);
  if (exists) throw new Error(`Arquivo web duplicado na raiz: ${duplicate}. A fonte oficial deve ficar em public/.`);
}

const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8');
for (const pattern of ['node_modules/', 'native-web/', 'dist/', 'xcuserdata/']) {
  if (!gitignore.includes(pattern)) throw new Error(`.gitignore precisa conter: ${pattern}`);
}

console.log('Estrutura-base GitHub/Capacitor validada: public/ é a única fonte web; infraestrutura web e camada nativa estão separadas.');
