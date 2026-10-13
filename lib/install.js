const { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { assetName, checksum, download, targetFor } = require('./distribution');

async function install({ root = resolve(__dirname, '..'), fetchFile = download, target = targetFor() } = {}) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json')));
  const tag = `rolling-${version}`;
  const base = `https://github.com/keepresearch/opus/releases/download/${tag}`;
  const manifest = JSON.parse((await fetchFile(`${base}/manifest.json`, 1024 * 1024)).toString());
  if (
    manifest.version !== version ||
    manifest.tag !== tag ||
    manifest.napiVersion !== 3 ||
    !/^[a-f0-9]{40}$/.test(manifest.commit)
  )
    throw new Error('Release manifest identity mismatch');
  const asset = manifest.assets?.find((entry) => entry.target === target);
  const name = assetName(version, target);
  if (
    !asset ||
    asset.name !== name ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes <= 0 ||
    asset.bytes > 32 * 1024 * 1024
  )
    throw new Error(`Missing or invalid prebuild: ${target}`);
  const directory = join(root, 'prebuild');
  const destination = join(directory, 'opus.node');
  if (checksumIfExists(destination) === asset.sha256) return;
  const binary = await fetchFile(`${base}/${name}`, 32 * 1024 * 1024);
  if (binary.length !== asset.bytes || checksum(binary) !== asset.sha256) throw new Error('Prebuild checksum mismatch');
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `opus.node.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, binary, { flag: 'wx' });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  writeFileSync(join(directory, 'build-info.json'), JSON.stringify(asset.build, null, 2) + '\n');
}
function checksumIfExists(path) {
  try {
    return checksum(readFileSync(path));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
if (require.main === module) {
  const operation =
    process.env.OPUS_BUILD_FROM_SOURCE === '1' ? require('../scripts/build-source').buildSource() : install();
  operation.catch((error) => {
    console.error(
      `Opus installation failed: ${error.message}\nNo automatic source fallback. To compile explicitly, set OPUS_BUILD_FROM_SOURCE=1 (C/C++, CMake and Python required).`,
    );
    process.exitCode = 1;
  });
}
module.exports = { install };
