import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appIconDir = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const contentsPath = path.join(appIconDir, 'Contents.json');
const watchAppIconDir = path.join(root, 'ios', 'App', 'Assistente Watch Watch App', 'Assets.xcassets', 'AppIcon.appiconset');
const watchContentsPath = path.join(watchAppIconDir, 'Contents.json');
const sourceDir = path.join(root, 'native-assets', 'ios');

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

if (!(await exists(contentsPath))) {
  console.log('Ícone iOS: projeto ios/ ainda não existe; nada a aplicar.');
  process.exit(0);
}

const contents = JSON.parse(await readFile(contentsPath, 'utf8'));
const images = Array.isArray(contents.images) ? contents.images : [];
let applied = 0;

await mkdir(appIconDir, { recursive: true });

for (let index = 0; index < images.length; index += 1) {
  const item = images[index];
  const sizeText = String(item.size || '').split('x')[0];
  const scaleText = String(item.scale || '1x').replace('x', '');
  const size = Number.parseFloat(sizeText);
  const scale = Number.parseFloat(scaleText) || 1;
  if (!Number.isFinite(size) || size <= 0) continue;

  const pixels = Math.round(size * scale);
  const source = path.join(sourceDir, `icon-${pixels}.png`);
  if (!(await exists(source))) {
    throw new Error(`Ícone iOS ${pixels}x${pixels} ausente em native-assets/ios/.`);
  }

  const filename = item.filename || `MM-AppIcon-${pixels}-${index}.png`;
  item.filename = filename;
  await copyFile(source, path.join(appIconDir, filename));
  applied += 1;
}

// Xcode 26/asset catalogs novos podem conter um slot universal sem size explícito.
// Nesse caso, usamos um catálogo mínimo moderno com o ícone 1024x1024.
if (applied === 0) {
  for (const entry of await Promise.resolve([])) void entry;
  const filename = 'MM-AppIcon-1024.png';
  await copyFile(path.join(sourceDir, 'icon-1024.png'), path.join(appIconDir, filename));
  contents.images = [{
    filename,
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024'
  }];
  applied = 1;
}

contents.info = contents.info || { author: 'xcode', version: 1 };
await writeFile(contentsPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
console.log(`Ícone nativo do Assistente aplicado ao catálogo iOS (${applied} slot${applied === 1 ? '' : 's'}).`);

// O Watch usa o mesmo ícone-fonte do Assistente para manter a identidade visual
// e para que native:sync também restaure o asset em clones novos do repositório.
if (await exists(watchContentsPath)) {
  const watchContents = JSON.parse(await readFile(watchContentsPath, 'utf8'));
  const watchFilename = 'MM-Watch-AppIcon-1024.png';
  await mkdir(watchAppIconDir, { recursive: true });
  await copyFile(path.join(sourceDir, 'icon-1024.png'), path.join(watchAppIconDir, watchFilename));
  watchContents.images = [{
    filename: watchFilename,
    idiom: 'universal',
    platform: 'watchos',
    size: '1024x1024'
  }];
  watchContents.info = watchContents.info || { author: 'xcode', version: 1 };
  await writeFile(watchContentsPath, `${JSON.stringify(watchContents, null, 2)}\n`, 'utf8');
  console.log('Ícone nativo do Assistente aplicado ao catálogo watchOS.');
}
