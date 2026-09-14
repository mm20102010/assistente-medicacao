import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'package-lock.json',
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/Info.plist',
  'ios/App/CapApp-SPM/Package.swift',
];

for (const rel of required) {
  const file = path.join(root, rel);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`Repositório completo ainda não está pronto: ausente ${rel}`);
}

const project = await readFile(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
if (!project.includes('br.com.mmregistro.assistentemedicacao')) {
  console.warn('Aviso: Bundle Identifier não foi localizado literalmente no project.pbxproj; confirme Signing & Capabilities no Xcode.');
}

for (const rel of ['.github/workflows/deploy.yml', '.github/workflows/apply-zip-update.yml', '.github/workflows/restore-stable.yml']) {
  await access(path.join(root, rel));
}

console.log('Gate completo aprovado: Web + infraestrutura GitHub + package-lock + projeto iOS estão presentes.');
