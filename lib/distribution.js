const https = require('node:https');
const { createHash } = require('node:crypto');

const TARGETS = [
  'linux-x64-glibc',
  'linux-arm64-glibc',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
];
function targetFor(platform = process.platform, arch = process.arch, report = process.report.getReport()) {
  const libc = platform === 'linux' ? (report.header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined;
  const target = [platform, arch, libc].filter(Boolean).join('-');
  if (!TARGETS.includes(target))
    throw new Error(`Unsupported prebuild target: ${target}. Use OPUS_BUILD_FROM_SOURCE=1 with a supported toolchain.`);
  if (platform === 'linux' && libc === 'glibc') {
    const [major, minor] = report.header.glibcVersionRuntime.split('.').map(Number);
    if (major < 2 || (major === 2 && minor < 28))
      throw new Error('Prebuilds require glibc >= 2.28; build from source explicitly.');
  }
  return target;
}
function assetName(version, target) {
  return `opus-${version}-napi-v3-${target}.node`;
}
function checksum(data) {
  return createHash('sha256').update(data).digest('hex');
}
function download(url, limit = 32 * 1024 * 1024, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('Downloads require HTTPS'));
    const request = https.get(parsed, { headers: { 'User-Agent': 'keepresearch-opus' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location || redirects >= 5) return reject(new Error('Invalid download redirect'));
        return resolve(download(new URL(response.headers.location, parsed).href, limit, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed: HTTP ${response.statusCode} (${parsed.pathname})`));
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > limit) response.destroy(new Error('Download exceeds size limit'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Download timed out')));
    request.on('error', reject);
  });
}
module.exports = { TARGETS, targetFor, assetName, checksum, download };
