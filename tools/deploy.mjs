// Rebuild keys, check, test, commit and push. Flags: --no-push, --dump <path>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noPush = args.includes('--no-push');
const di = args.indexOf('--dump');
const dumpArgs = di >= 0 ? ['--dump', args[di + 1]] : [];

function run(cmd, a) {
  console.log(`\n> ${[cmd, ...a].join(' ')}`);
  const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`failed: ${cmd} (exit ${r.status})`); process.exit(r.status || 1); }
}
const node = process.execPath;
run(node, ['tools/build-keys.mjs', ...dumpArgs]);
run(node, ['tools/check-commands.mjs']);
run(node, ['--test']);
run('git', ['add', '-A']);
const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root });
if (staged.status === 0) console.log('\nnothing to commit');
else {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'keys', 'meta.json'), 'utf8'));
  run('git', ['commit', '-m', `Update site (keys from WH3-Dump ${meta.dumpCommit.slice(0, 7)})`]);
}
if (noPush) console.log('\n--no-push: skipping push');
else {
  // first push has no upstream yet; -u sets it and is harmless afterwards
  const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root, stdio: 'ignore' });
  run('git', upstream.status === 0 ? ['push'] : ['push', '-u', 'origin', 'HEAD']);
}
