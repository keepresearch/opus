const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { install } = require('../lib/install');
const { assetName, checksum, targetFor } = require('../lib/distribution');
const version = require('../package.json').version;
const target = 'linux-x64-glibc';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'opus-install-test-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  const binary = Buffer.from('fake native binary');
  const manifest = {
    version,
    tag: `rolling-${version}`,
    commit: 'a'.repeat(40),
    napiVersion: 3,
    assets: [
      {
        target,
        name: assetName(version, target),
        sha256: checksum(binary),
        bytes: binary.length,
        build: { libopusVersion: 'libopus 1.6.1' },
      },
    ],
  };
  const fetchFile = async (url) => (url.endsWith('manifest.json') ? Buffer.from(JSON.stringify(manifest)) : binary);
  return { root, binary, manifest, fetchFile };
}
test('download from the fork release and atomically install only verified bytes', async () => {
  const f = fixture();
  const urls = [];
  try {
    await install({
      ...f,
      target,
      fetchFile: async (url) => {
        urls.push(url);
        return f.fetchFile(url);
      },
    });
    assert.deepEqual(readFileSync(join(f.root, 'prebuild/opus.node')), f.binary);
    assert.equal(urls.length, 2);
    assert.ok(
      urls.every((u) => u.startsWith(`https://github.com/keepresearch/opus/releases/download/rolling-${version}/`)),
    );
    await install({
      ...f,
      target,
      fetchFile: async (url) => {
        assert.ok(url.endsWith('manifest.json'));
        return f.fetchFile(url);
      },
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
for (const scenario of ['download', 'checksum', 'version', 'missing target']) {
  test(`installer rejects ${scenario} errors without source fallback or unverified binary`, async () => {
    const f = fixture();
    try {
      if (scenario === 'checksum') f.manifest.assets[0].sha256 = 'b'.repeat(64);
      if (scenario === 'version') f.manifest.version = 'wrong';
      if (scenario === 'missing target') f.manifest.assets = [];
      const fetchFile =
        scenario === 'download'
          ? async () => {
              throw new Error('HTTP 404');
            }
          : f.fetchFile;
      await assert.rejects(install({ ...f, target, fetchFile }));
      assert.equal(existsSync(join(f.root, 'prebuild/opus.node')), false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}
test('platform mapping and glibc baseline', () => {
  assert.equal(targetFor('linux', 'x64', { header: { glibcVersionRuntime: '2.28' } }), 'linux-x64-glibc');
  assert.equal(targetFor('linux', 'arm64', { header: {} }), 'linux-arm64-musl');
  assert.equal(targetFor('darwin', 'arm64', { header: {} }), 'darwin-arm64');
  assert.throws(() => targetFor('win32', 'x64', { header: {} }), /Unsupported/);
  assert.throws(() => targetFor('linux', 'x64', { header: { glibcVersionRuntime: '2.27' } }), /2.28/);
});
