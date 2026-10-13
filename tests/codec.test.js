const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const modulePath = require.resolve(process.env.OPUS_TEST_MODULE || '../lib');
const { OpusEncoder, getLibopusVersion } = require(modulePath);
function signal(rate, channels, milliseconds, index = 0) {
  const samples = (rate * milliseconds) / 1000;
  const pcm = Buffer.alloc(samples * channels * 2);
  for (let i = 0; i < samples; i++)
    for (let c = 0; c < channels; c++)
      pcm.writeInt16LE(
        Math.round(12000 * Math.sin((2 * Math.PI * (220 + c * 110) * (i + index * samples)) / rate)),
        (i * channels + c) * 2,
      );
  return pcm;
}
test('the loaded native binary is libopus 1.6.1', () => assert.equal(getLibopusVersion(), 'libopus 1.6.1'));
test('old upstream packet decodes and re-encodes without a fixed packet-size assertion', () => {
  const codec = new OpusEncoder(16000, 1);
  const decoded = codec.decode(readFileSync(join(__dirname, 'frame.opus')));
  assert.equal(decoded.length, 640);
  const packet = codec.encode(decoded);
  assert.ok(packet.length > 0 && packet.length <= 3828);
  assert.equal(new OpusEncoder(16000, 1).decode(packet).length, decoded.length);
});
for (const rate of [8000, 12000, 16000, 24000, 48000])
  for (const channels of [1, 2])
    for (const ms of [20, 40, 60])
      for (const bitrate of [undefined, 16000]) {
        test(`continuous round-trip ${rate}Hz ${channels}ch ${ms}ms bitrate=${bitrate || 'auto'}`, () => {
          const codec = new OpusEncoder(rate, channels);
          if (bitrate) {
            codec.setBitrate(bitrate);
            assert.equal(codec.getBitrate(), bitrate);
          }
          codec.applyEncoderCTL(4010, 9);
          for (let i = 0; i < 5; i++) {
            const pcm = signal(rate, channels, ms, i);
            const packet = codec.encode(pcm);
            const decoded = codec.decode(packet);
            assert.equal(decoded.length, pcm.length);
            assert.ok(packet.length > 0 && packet.length <= 3828);
            if (i > 0) assert.ok(decoded.some((byte) => byte !== 0));
          }
        });
      }
test('default constructors and valid control operations', () => {
  new OpusEncoder();
  new OpusEncoder(undefined, undefined);
  const codec = new OpusEncoder(24000, 1);
  codec.applyEncoderCTL(4010, 9);
  codec.applyDecoderCTL(4028, 0);
  assert.throws(() => codec.applyEncoderCTL(-999, 0));
  assert.throws(() => codec.applyDecoderCTL(-999, 0));
  assert.throws(() => codec.setBitrate(0));
});
test('invalid input throws without aborting the process', () => {
  for (const rate of [0, -1, 44100, NaN, Infinity, 16000.5, '16000', null])
    assert.throws(() => new OpusEncoder(rate, 1));
  for (const channels of [0, -1, 3, 1.5, Infinity, NaN, '1', null])
    assert.throws(() => new OpusEncoder(16000, channels));
  const codec = new OpusEncoder(16000, 1);
  for (const input of [
    undefined,
    'not PCM bytes',
    Buffer.alloc(0),
    Buffer.alloc(1),
    Buffer.alloc(638),
    Buffer.alloc(20000),
  ])
    assert.throws(() => codec.encode(input));
  assert.throws(() => codec.decode({}));
  assert.throws(() => codec.decode(Buffer.from([255])));
  assert.ok(codec.encode(signal(16000, 1, 20)).length > 0);
});
test('odd-offset PCM buffers have identical encoding', () => {
  const pcm = signal(24000, 2, 20);
  const backing = Buffer.alloc(pcm.length + 1);
  pcm.copy(backing, 1);
  assert.deepEqual(new OpusEncoder(24000, 2).encode(backing.subarray(1)), new OpusEncoder(24000, 2).encode(pcm));
});
test('repeated allocation and collection remains safe', () => {
  for (let i = 0; i < 1000; i++) new OpusEncoder(16000, 1).encode(signal(16000, 1, 20));
  global.gc?.();
});
test('four Workers load the same binary and keep independent states', async () => {
  const pcm = signal(16000, 1, 20);
  const codec = new OpusEncoder(16000, 1);
  const expected = Array.from({ length: 3 }, () => codec.encode(pcm).toString('hex'));
  const script = `const {parentPort, workerData}=require('node:worker_threads');const {OpusEncoder,getLibopusVersion}=require(workerData.modulePath);const codec=new OpusEncoder(16000,1);parentPort.postMessage({version:getLibopusVersion(),packets:Array.from({length:3},()=>codec.encode(Buffer.from(workerData.pcm)).toString('hex'))});`;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      const worker = new Worker(script, { eval: true, workerData: { modulePath, pcm } });
      let result;
      await new Promise((resolve, reject) => {
        worker.on('message', (message) => {
          result = message;
        });
        worker.on('error', reject);
        worker.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`))));
      });
      assert.equal(result.version, 'libopus 1.6.1');
      assert.deepEqual(result.packets, expected);
    }),
  );
});
