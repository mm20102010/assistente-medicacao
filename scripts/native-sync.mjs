import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'native-web');
const iosPublic = path.join(root, 'ios', 'App', 'App', 'public');
const iosConfig = path.join(root, 'ios', 'App', 'App', 'capacitor.config.json');

await fs.access(path.join(source, 'index.html'));
await fs.rm(iosPublic, { recursive: true, force: true });
await fs.cp(source, iosPublic, { recursive: true });

const config = {
  appId: 'br.com.mmregistro.assistentemedicacao',
  appName: 'Assistente de Medicação',
  webDir: 'native-web',
  ios: { contentInset: 'never' }
};
await fs.writeFile(iosConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log('native:sync OK — native-web/ -> ios/App/App/public/');
