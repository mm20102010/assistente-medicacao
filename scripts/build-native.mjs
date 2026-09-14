import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public');
const out = path.join(root, 'native-web');

const sourceStat = await stat(source).catch(() => null);
if (!sourceStat?.isDirectory()) throw new Error('A pasta public/ não foi encontrada.');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(source, out, { recursive: true });

const indexStat = await stat(path.join(out, 'index.html')).catch(() => null);
if (!indexStat?.isFile()) throw new Error('native-web/index.html não foi gerado.');
console.log(`Native web bundle gerado a partir de public/ em ${out}`);
