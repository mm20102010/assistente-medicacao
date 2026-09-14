import { access, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error('Uso: npm run native:adopt-existing -- "/caminho/para/Diario_Medicacao_2.47_Capacitor_B1"');
  process.exit(1);
}

const sourceRoot = path.resolve(sourceArg);
const sourceIos = path.join(sourceRoot, 'ios');
const targetIos = path.join(root, 'ios');

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

if (!(await exists(sourceIos))) {
  console.error(`A pasta ios/ não foi encontrada em: ${sourceRoot}`);
  process.exit(1);
}
if (await exists(targetIos)) {
  console.error('A B2 já possui ios/. Para evitar sobrescrever configurações do Xcode, a adoção foi cancelada.');
  process.exit(1);
}

console.log('Copiando o projeto iOS já validado na B1...');
await cp(sourceIos, targetIos, { recursive: true });

const sourceLock = path.join(sourceRoot, 'package-lock.json');
if (await exists(sourceLock)) {
  await copyFile(sourceLock, path.join(root, 'package-lock.json'));
  console.log('package-lock.json da B1 copiado; npm install irá atualizá-lo para a B1.');
}

console.log('Projeto iOS adotado sem alterar Signing/Team. Agora execute: npm install && npm run native:sync');
