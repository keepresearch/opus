const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { assetName, checksum, TARGETS } = require('../lib/distribution');
const { version } = require('../package.json');
const directory = resolve(process.argv[2] || 'build/assets');
const commit = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Missing release commit');
const assets = readdirSync(directory)
  .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
  .map((name) => JSON.parse(readFileSync(join(directory, name))));
if (assets.length !== TARGETS.length || new Set(assets.map((a) => a.target)).size !== TARGETS.length)
  throw new Error('Incomplete release matrix');
for (const asset of assets) {
  const binary = readFileSync(join(directory, asset.name));
  if (
    !TARGETS.includes(asset.target) ||
    asset.name !== assetName(version, asset.target) ||
    asset.build.commit !== commit ||
    asset.build.napiVersion !== 3 ||
    asset.build.source.sha256 !== require('../vendor/source.json').sha256 ||
    asset.build.libopusVersion !== 'libopus 1.6.1' ||
    asset.sha256 !== checksum(binary) ||
    asset.bytes !== binary.length
  )
    throw new Error('Release asset identity mismatch');
}
assets.sort((a, b) => a.target.localeCompare(b.target));
writeFileSync(
  join(directory, 'manifest.json'),
  JSON.stringify({ version, tag: `rolling-${version}`, commit, napiVersion: 3, assets }, null, 2) + '\n',
);
writeFileSync(
  join(directory, 'LICENSES.txt'),
  readFileSync(resolve(__dirname, '../LICENSE')) +
    '\nlibopus:\n' +
    readFileSync(resolve(__dirname, '../vendor/OPUS-LICENSE')),
);
