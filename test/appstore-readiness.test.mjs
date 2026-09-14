import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('versão técnica está preparada para distribuição iPhone + Watch + complication', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const pbx = await read('ios/App/App.xcodeproj/project.pbxproj');
  const plist = await read('ios/App/App/Info.plist');
  const technicalVersion = String(pkg.version);
  const escapedVersion = technicalVersion.replace(/\./g, '\\.');
  assert.match(technicalVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.marketingVersion, technicalVersion);
  assert.equal((pbx.match(new RegExp(`MARKETING_VERSION = ${escapedVersion};`, 'g')) || []).length, 6);
  assert.equal((pbx.match(/MARKETING_VERSION = \d+(?:\.\d+){1,2};/g) || []).length, 6);
  const buildNumbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map(match => Number(match[1]));
  assert.equal(buildNumbers.length, 6);
  assert.ok(buildNumbers.every(Number.isInteger));
  assert.ok(buildNumbers.every(build => build > 0));
  assert.ok(buildNumbers.every(build => build === buildNumbers[0]));
  assert.doesNotMatch(pbx, /TARGETED_DEVICE_FAMILY = "1,2";/);
  assert.match(pbx, /TARGETED_DEVICE_FAMILY = 1;/);
  assert.match(pbx, /WATCHOS_DEPLOYMENT_TARGET = 10\.0;/);
  assert.doesNotMatch(plist, /<string>armv7<\/string>/);
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test('Privacy Manifest existe no iPhone e Watch com UserDefaults CA92.1', async () => {
  for (const path of ['ios/App/App/PrivacyInfo.xcprivacy','ios/App/Assistente Watch Watch App/PrivacyInfo.xcprivacy']) {
    const text = await read(path);
    assert.match(text, /NSPrivacyAccessedAPICategoryUserDefaults/);
    assert.match(text, /CA92\.1/);
  }
  const pbx = await read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /PrivacyInfo\.xcprivacy in Resources/);
});

test('Privacidade e suporte ficam acessíveis no app e no PWA', async () => {
  const html = await read('public/index.html');
  const sw = await read('public/sw.js');
  assert.match(html, /privacy-support-group/);
  assert.match(html, /id="privacyPolicyBtn"/);
  assert.match(html, /id="supportBtn"/);
  assert.match(html, /id="privacyPolicySheet"[\s\S]*?data-mm-secondary-layer="privacy-policy"/);
  assert.doesNotMatch(html, /target="_blank"[\s\S]*?privacy\.html/);
  assert.match(sw, /privacy\.html/);
  assert.match(sw, /support\.html/);

  const app = await read('public/app.js');
  const privacy = await read('public/privacy.html');
  const support = await read('public/support.html');
  assert.match(app, /function openPrivacyPolicy\(\)/);
  assert.match(app, /fetch\("\.\/privacy\.html"\)/);
  assert.match(html, /id="supportDialog"[\s\S]*?id="supportEmailBtn"[\s\S]*?id="diagnosticModeToggle"/);
  assert.match(app, /function openSupport\(\)/);
  assert.match(app, /developer\.apps\.mm@outlook\.com/);
  assert.match(privacy, /developer\.apps\.mm@outlook\.com/);

  assert.match(privacy, /article data-locale="pt-BR"/);
  assert.match(privacy, /article data-locale="en-US"/);
  assert.match(privacy, /article data-locale="es-ES"/);
  assert.match(app, /const locale = I18N\?\.locale \|\| "pt-BR"/);
  assert.match(app, /article\[data-locale="\$\{locale\}"\]/);
  assert.match(app, /dataset\.locale !== locale/);
  assert.match(support, /developer\.apps\.mm@outlook\.com/);
  for (const path of ['public/privacy.html','public/support.html']) {
    const info = await stat(new URL(`../${path}`, import.meta.url));
    assert.ok(info.isFile());
  }
});

test('idioma selecionado no Diário sincroniza toda a interface nativa do Watch', async () => {
  const app = await read('public/app.js');
  const runtime = await read('public/native-runtime.js');
  const phone = await read('ios/App/App/WatchSessionManager.swift');
  const watch = await read('ios/App/Assistente Watch Watch App/WatchSessionManager.swift');
  const content = await read('ios/App/Assistente Watch Watch App/ContentView.swift');
  const i18n = await read('public/i18n.js');
  assert.match(app, /function watchTextsForNative/);
  assert.match(app, /syncMedicines\(medicines, \{ locale, texts, projection \}\)/);
  assert.match(app, /mm:localechange[\s\S]*?syncMedicinesToNative\(\{ force: true \}\)/);
  assert.match(runtime, /payload\.locale = locale/);
  assert.match(runtime, /payload\.texts = texts/);
  assert.match(phone, /"schemaVersion": 4/);
  assert.match(phone, /"locale": snapshot.locale/);
  assert.match(phone, /"texts": snapshot.texts/);
  assert.match(watch, /func text\(_ key: String, fallback: String\)/);
  assert.match(content, /watch\.text\("title"/);
  assert.match(content, /watch\.text\("waitingPhone"/);
  for (const key of ['watch.title','watch.waitingPhone','watch.sending','watch.waitingPhoneShort','watch.queued','watch.saveFailed']) {
    assert.ok(i18n.includes(`"${key}"`), `catálogo deve conter ${key}`);
  }
});
