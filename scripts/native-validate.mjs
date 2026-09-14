import fs from 'node:fs';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const exists = rel => fs.existsSync(new URL(`../${rel}`, import.meta.url));
const pkg = JSON.parse(read('package.json'));
const releaseVersion = String(pkg.version || '').trim();
const marketingVersion = String(pkg.marketingVersion || releaseVersion).trim();
const displayVersion = releaseVersion.endsWith('.0') ? releaseVersion.slice(0, -2) : releaseVersion;
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const info = read('ios/App/App/Info.plist');
const config = read('capacitor.config.ts');
const packageSwift = read('ios/App/CapApp-SPM/Package.swift');
const app = read('public/app.js');
const index = read('public/index.html');
const sw = read('public/sw.js');
const errors = [];

if (!releaseVersion) errors.push('package.json sem versão');
if (!marketingVersion) errors.push('package.json sem Marketing Version');
if (marketingVersion !== releaseVersion) errors.push('Marketing Version técnico deve coincidir com package.json version');
if ((pbx.match(new RegExp(`MARKETING_VERSION = ${marketingVersion.replace(/\./g,'\\.')};`, 'g')) || []).length !== 6) errors.push('MARKETING_VERSION deve coincidir em iPhone + Watch + complication, Debug + Release');
if (!config.match(/contentInset:\s*['"]never['"]/)) errors.push('Capacitor iOS deve usar contentInset=never');
if (!/<key>CFBundleDevelopmentRegion<\/key>\s*<string>en<\/string>/.test(info)) errors.push('CFBundleDevelopmentRegion deve ser en');
if (!/developmentRegion = en;/.test(pbx)) errors.push('developmentRegion do Xcode deve ser en');
if (!packageSwift.includes('exact: "8.5.0"')) errors.push('Capacitor SPM deve estar fixado em 8.5.0');
if (/config\.xml/.test(pbx)) errors.push('project.pbxproj não pode referenciar config.xml legado/inexistente; Capacitor 8 usa capacitor.config.json');
if (!pbx.includes('capacitor.config.json in Resources')) errors.push('capacitor.config.json deve estar em Resources');
if (!exists('ios/App/App/capacitor.config.json')) errors.push('capacitor.config.json nativo ausente; execute native:sync');
if (!/TARGETED_DEVICE_FAMILY = 1;/.test(pbx)) errors.push('target iPhone deve excluir iPad');
if ((pbx.match(/TARGETED_DEVICE_FAMILY = 4;/g) || []).length !== 4) errors.push('Watch e complication devem usar device family 4 em Debug + Release');
if ((pbx.match(/WATCHOS_DEPLOYMENT_TARGET = 10\.0;/g) || []).length !== 4) errors.push('Watch e complication devem usar watchOS 10.0 em Debug + Release');
if (/<string>armv7<\/string>/.test(info)) errors.push('Info.plist não pode declarar armv7 legado');
if (!/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(info)) errors.push('ITSAppUsesNonExemptEncryption=false ausente');
for (const rel of ['ios/App/App/PrivacyInfo.xcprivacy','ios/App/Assistente Watch Watch App/PrivacyInfo.xcprivacy']) {
  if (!exists(rel)) { errors.push(`Privacy Manifest ausente: ${rel}`); continue; }
  const privacy = read(rel);
  if (!privacy.includes('NSPrivacyAccessedAPICategoryUserDefaults') || !privacy.includes('CA92.1')) errors.push(`Privacy Manifest incompleto: ${rel}`);
}
if (!pbx.includes('PrivacyInfo.xcprivacy in Resources')) errors.push('Privacy Manifest iPhone deve estar em Resources');
if (!exists('ios/App/Assistente Watch Complications/PrivacyInfo.xcprivacy')) errors.push('Privacy Manifest da complication ausente');
if (!pbx.includes('Assistente Watch Complications.appex in Embed Watch Extensions')) errors.push('complication deve estar embutida no app do Watch');
if (!pbx.includes('br.com.mmregistro.assistentemedicacao.watchkitapp.complications')) errors.push('Bundle Identifier da complication ausente');
if (!exists('ios/App/Assistente Watch Complications/AssistenteComplications.swift')) errors.push('fonte WidgetKit da complication ausente');
if (!exists('ios/App/Assistente Watch Complications/Localizable.xcstrings')) errors.push('localização da complication ausente');
for (const lang of ['en','pt','es']) {
  for (const rel of [`ios/App/App/${lang}.lproj/InfoPlist.strings`,`ios/App/Assistente Watch Watch App/${lang}.lproj/InfoPlist.strings`]) {
    if (!exists(rel)) errors.push(`localização nativa ausente: ${rel}`);
  }
}
if (!pbx.includes('InfoPlist.strings in Resources')) errors.push('InfoPlist.strings localizado do iPhone deve estar em Resources');
if (!app.includes(`const APP_VERSION = "${displayVersion}"`) && !app.includes(`const APP_VERSION = '${displayVersion}'`)) errors.push('APP_VERSION web deve coincidir com a versão visual da release');
if (!app.includes(`const DIAGNOSTIC_REVISION = '${displayVersion}'`) && !app.includes(`const DIAGNOSTIC_REVISION = "${displayVersion}"`)) errors.push('DIAGNOSTIC_REVISION deve coincidir com a versão visual da release');
if (!index.includes(`v${displayVersion}`)) errors.push('index.html deve expor a versão visual atual');
if (!sw.includes(displayVersion)) errors.push('service worker deve referenciar a versão visual atual');

if (errors.length) { console.error(`native validation failed:\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('native shell validation: OK');
