import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');
const stageDir = path.join(distDir, 'web-package');
const zipPath = path.join(distDir, 'Assistente_Medicacao_WEB_1.0.zip');

if (!(await stat(path.join(publicDir, 'index.html')).catch(() => null))?.isFile()) {
  throw new Error('public/index.html não encontrado.');
}

await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });
await cp(publicDir, stageDir, { recursive: true });

// public/ é o artefato web completo; nenhuma pasta nativa entra no ZIP.

await rm(zipPath, { force: true });
const result = spawnSync('zip', ['-qry', zipPath, '.'], { cwd: stageDir, stdio: 'inherit' });
if (result.status !== 0) {
  throw new Error('Não foi possível criar o ZIP web. O comando zip precisa estar disponível.');
}

console.log(`ZIP exclusivo do WebApp gerado em: ${zipPath}`);
console.log('Este é o artefato destinado ao fluxo Google Drive → GitHub → Cloudflare Pages.');
