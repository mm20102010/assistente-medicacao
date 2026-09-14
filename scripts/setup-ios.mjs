import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npm', ['run', 'native:build']);
if (!(await exists('ios'))) {
  console.log('Criando o projeto iOS do Capacitor...');
  run('npx', ['cap', 'add', 'ios']);
}
run('npx', ['cap', 'sync', 'ios']);
run('node', ['scripts/apply-ios-assets.mjs']);
console.log('\nProjeto iOS preparado, sincronizado e com o ícone do Diário. Próximo passo: npm run native:open');
