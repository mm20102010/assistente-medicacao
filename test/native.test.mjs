import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const json = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('configuração Capacitor B2 é reproduzível', async () => {
  assert.equal(json.type, 'module');
  assert.ok(json.devDependencies?.typescript, 'typescript deve estar em devDependencies');
  assert.match(json.scripts?.['native:sync'] || '', /native-sync\.mjs/);
  assert.match(json.scripts?.['native:sync'] || '', /apply-ios-assets\.mjs/);
  assert.doesNotMatch(json.scripts?.['native:sync'] || '', /cap sync ios/, 'sync rotineiro não deve depender do Capacitor CLI');
  const icon = await stat(new URL('../native-assets/ios/icon-1024.png', import.meta.url));
  assert.ok(icon.size > 0, 'ícone iOS 1024 deve existir');

  const capacitorConfig = await readFile(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
  assert.match(capacitorConfig, /contentInset:\s*['"]never['"]/, 'WKWebView não deve duplicar a safe area do CSS');
  assert.doesNotMatch(capacitorConfig, /contentInset:\s*['"]automatic['"]/, 'contentInset automatic reintroduz divergência visual com o PWA');

  const infoPlist = await readFile(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
  assert.match(infoPlist, /<key>CFBundleDisplayName<\/key>\s*<string>Diario<\/string>/, 'nome na Home Screen deve ser Diario');

  const watchContentsUrl = new URL('../ios/App/Assistente Watch Watch App/Assets.xcassets/AppIcon.appiconset/Contents.json', import.meta.url);
  const watchContents = JSON.parse(await readFile(watchContentsUrl, 'utf8'));
  const watchImage = watchContents.images?.find(item => item.platform === 'watchos');
  assert.ok(watchImage?.filename, 'catálogo watchOS deve apontar para um arquivo de ícone');
  const watchIconPath = path.join(path.dirname(fileURLToPath(watchContentsUrl)), watchImage.filename);
  const watchIcon = await stat(watchIconPath);
  assert.ok(watchIcon.size > 0, 'ícone watchOS deve existir');
});

test('PWA continua usando o runtime web compartilhado', async () => {
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const nativeRuntime = await readFile(new URL('../public/native-runtime.js', import.meta.url), 'utf8');

  assert.match(index, /native-runtime\.js/);
  assert.match(sw, /native-runtime\.js/);

  // A opção continua no HTML/PWA, mas o runtime nativo a remove da experiência iOS.
  assert.match(index, /class="settings-group install-group"/);
  assert.match(styles, /html\[data-mm-runtime="native"\]\s+\.install-group/);
  assert.match(app, /action === "install"[\s\S]{0,120}MMNative\?\.isNative/);
  assert.match(nativeRuntime, /nativeProtocol[\s\S]{0,180}capacitor/);
  assert.match(nativeRuntime, /querySelectorAll\?\.\(['"]\.install-group, #installSheet['"]\)\?\.[\s\S]{0,80}remove\(\)/);
});
