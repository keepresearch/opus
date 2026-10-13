const { spawnSync } = require('node:child_process');
const { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');
const reference = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(reference || '')) throw new Error('Pass the full published commit SHA');
const directory = mkdtempSync(join(tmpdir(), 'opus-git-consumer-'));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: directory, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed: ${result.status}`);
}
try {
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify(
      {
        private: true,
        dependencies: { '@discordjs/opus': `git+https://github.com/keepresearch/opus.git#${reference}` },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(directory, 'pnpm-workspace.yaml'),
    'allowBuilds:\n  "@discordjs/opus@git+https://github.com/keepresearch/opus.git": true\n',
  );
  // Any accidental source build fails even on a runner that has a compiler installed.
  run('pnpm', ['install'], {
    ...process.env,
    CC: '/compiler-is-not-available',
    CXX: '/compiler-is-not-available',
    PYTHON: '/python-is-not-available',
    OPUS_BUILD_FROM_SOURCE: '0',
  });
  mkdirSync(join(directory, 'tests'));
  for (const file of ['codec.test.js', 'frame.opus']) cpSync(join(root, 'tests', file), join(directory, 'tests', file));
  run(process.execPath, ['--expose-gc', '--test', 'tests/codec.test.js'], {
    ...process.env,
    OPUS_TEST_MODULE: '@discordjs/opus',
  });
  run('pnpm', ['install', '--frozen-lockfile'], {
    ...process.env,
    CC: '/compiler-is-not-available',
    CXX: '/compiler-is-not-available',
    PYTHON: '/python-is-not-available',
    OPUS_BUILD_FROM_SOURCE: '0',
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
