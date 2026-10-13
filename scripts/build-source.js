const { spawnSync } = require('node:child_process');
const { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { availableParallelism, tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const tar = require('tar');
const { checksum, download, targetFor } = require('../lib/distribution');
const root = resolve(__dirname, '..');
function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited with ${result.status}`);
}
function output(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || new Error(`${program} failed`);
  return result.stdout.trim();
}
async function buildSource() {
  const target = targetFor();
  const source = JSON.parse(readFileSync(join(root, 'vendor/source.json')));
  const temporary = mkdtempSync(join(tmpdir(), 'keepresearch-opus-'));
  try {
    const archive = await download(source.url);
    if (checksum(archive) !== source.sha256) throw new Error('libopus source checksum mismatch');
    const archivePath = join(temporary, 'source.tar.gz');
    writeFileSync(archivePath, archive);
    await tar.x({ file: archivePath, cwd: temporary, strict: true });
    const opusSource = join(temporary, `opus-${source.version}`);
    const opusBuild = join(temporary, 'opus-build');
    const prefix = join(temporary, 'installed');
    const options = {
      CMAKE_BUILD_TYPE: 'Release',
      CMAKE_POSITION_INDEPENDENT_CODE: 'ON',
      CMAKE_INSTALL_PREFIX: prefix,
      CMAKE_INSTALL_LIBDIR: 'lib',
      CMAKE_DISABLE_FIND_PACKAGE_Git: 'ON',
      BUILD_SHARED_LIBS: 'OFF',
      OPUS_BUILD_SHARED_LIBRARY: 'OFF',
      OPUS_BUILD_TESTING: 'OFF',
      OPUS_BUILD_PROGRAMS: 'OFF',
      OPUS_FIXED_POINT: 'OFF',
      OPUS_DISABLE_INTRINSICS: 'OFF',
      OPUS_FLOAT_APPROX: 'OFF',
      OPUS_FAST_MATH: 'OFF',
      OPUS_DRED: 'OFF',
      OPUS_OSCE: 'OFF',
      OPUS_X86_PRESUME_SSE4_1: 'OFF',
      OPUS_X86_PRESUME_AVX2: 'OFF',
    };
    if (process.platform === 'darwin') options.CMAKE_OSX_DEPLOYMENT_TARGET = '11.0';
    run(
      'cmake',
      ['-S', opusSource, '-B', opusBuild, ...Object.entries(options).map(([key, value]) => `-D${key}=${value}`)],
      temporary,
    );
    const parallel = process.env.OPUS_BUILD_JOBS || String(Math.min(4, availableParallelism()));
    if (!/^[1-9][0-9]*$/.test(parallel)) throw new Error('OPUS_BUILD_JOBS must be a positive integer');
    run('cmake', ['--build', opusBuild, '--config', 'Release', '--parallel', parallel], temporary);
    run('cmake', ['--install', opusBuild, '--config', 'Release'], temporary);
    const addonRoot = join(temporary, 'addon');
    mkdirSync(join(addonRoot, 'node_modules'), { recursive: true });
    cpSync(join(root, 'src'), join(addonRoot, 'src'), { recursive: true });
    cpSync(join(root, 'binding.gyp'), join(addonRoot, 'binding.gyp'));
    symlinkSync(
      dirname(require.resolve('node-addon-api/package.json')),
      join(addonRoot, 'node_modules/node-addon-api'),
      'junction',
    );
    const args = [
      require.resolve('node-gyp/bin/node-gyp.js'),
      'rebuild',
      '--release',
      `--opus_include_dir=${join(prefix, 'include/opus')}`,
      `--opus_library=${join(prefix, 'lib/libopus.a')}`,
    ];
    if (process.env.OPUS_NODE_HEADERS) args.push(`--nodedir=${resolve(process.env.OPUS_NODE_HEADERS)}`);
    run(process.execPath, args, addonRoot);
    const built = join(addonRoot, 'build/Release/opus.node');
    const api = require(built);
    if (api.getLibopusVersion() !== `libopus ${source.version}`) throw new Error('Built libopus version mismatch');
    const cache = readFileSync(join(opusBuild, 'CMakeCache.txt'), 'utf8');
    const compileFlags = readFileSync(join(opusBuild, 'CMakeFiles/opus.dir/flags.make'), 'utf8');
    const simdDefines = compileFlags.match(/-DOPUS_(?:X86|ARM|HAVE_RTCD)[^\s]*/g) || [];
    const simd = cache
      .split('\n')
      .filter((line) => /^OPUS_(X86_|ARM_|DISABLE_INTRINSICS:|FIXED_POINT:|DRED:|OSCE:|FAST_MATH:)/.test(line));
    const simdEnabled =
      process.arch === 'x64'
        ? simdDefines.some((value) => value === '-DOPUS_X86_MAY_HAVE_AVX2')
        : simdDefines.some((value) => /^-DOPUS_ARM_(MAY_HAVE_NEON_INTR|PRESUME_(?:AARCH64_)?NEON_INTR)$/.test(value));
    if (!simdEnabled) throw new Error('Expected x64 AVX2 or ARM64 NEON build support is absent');
    const info = {
      target,
      napiVersion: 3,
      libopusVersion: api.getLibopusVersion(),
      source,
      commit: process.env.GITHUB_SHA || output('git', ['-C', root, 'rev-parse', 'HEAD']),
      compiler: output(process.env.CXX || 'c++', ['--version']).split('\n')[0],
      node: process.version,
      image: process.env.OPUS_BUILD_IMAGE || null,
      glibc: process.report.getReport().header.glibcVersionRuntime || null,
      options,
      simd,
      simdDefines,
      minimumRuntime: target.endsWith('glibc')
        ? 'glibc >= 2.28'
        : target.endsWith('musl')
          ? 'musl >= 1.2.5'
          : 'macOS >= 11.0',
    };
    // Temporary absolute paths are not meaningful build identities.
    info.options = Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'CMAKE_INSTALL_PREFIX'));
    const destination = join(root, 'prebuild');
    mkdirSync(destination, { recursive: true });
    cpSync(built, join(destination, 'opus.node'));
    writeFileSync(join(destination, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
    console.log(`Built ${info.libopusVersion}, ${target}, N-API v3 with SIMD`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module)
  buildSource().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { buildSource };
