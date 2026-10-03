import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [22, 13];

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < REQUIRED[0] || (major === REQUIRED[0] && minor < REQUIRED[1])) {
  console.error(
    `\nFunnel Runtime needs Node.js ${REQUIRED.join('.')} or newer (built-in SQLite). ` +
      `You are running ${process.versions.node}.\nInstall Node 24 (https://nodejs.org or "nvm install 24") and run the command again.\n`,
  );
  process.exit(1);
}

if (!existsSync(resolve(root, 'node_modules', 'fastify'))) {
  console.error('\nDependencies are not installed. Run "npm install" in the repository root first.\n');
  process.exit(1);
}

if (process.argv.includes('--web') && !existsSync(resolve(root, 'apps/web/dist/index.html'))) {
  console.log('\nWeb client is not built yet — building it once (about 20 seconds)...\n');
  const build = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    console.error('\nWeb build failed. Fix the error above and run "npm start" again.\n');
    process.exit(build.status ?? 1);
  }
}
