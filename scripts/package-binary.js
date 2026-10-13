const { cpSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { assetName, checksum, TARGETS } = require('../lib/distribution');
const root = resolve(__dirname, '..');
const { version } = require('../package.json');
const build = JSON.parse(readFileSync(join(root, 'prebuild/build-info.json')));
if (!TARGETS.includes(build.target) || build.napiVersion !== 3 || build.libopusVersion !== 'libopus 1.6.1')
  throw new Error('Unexpected build identity');
const binary = readFileSync(join(root, 'prebuild/opus.node'));
const name = assetName(version, build.target);
const destination = join(root, 'build/assets');
mkdirSync(destination, { recursive: true });
cpSync(join(root, 'prebuild/opus.node'), join(destination, name));
writeFileSync(
  join(destination, `${build.target}.json`),
  JSON.stringify({ target: build.target, name, bytes: binary.length, sha256: checksum(binary), build }, null, 2) + '\n',
);
