import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const audioDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'mobile',
  'assets',
  'audio',
);
const expectations = [
  { name: 'paper-draw.wav', minimumDuration: 0.4, maximumDuration: 0.44 },
  { name: 'reveal-shimmer.wav', minimumDuration: 0.7, maximumDuration: 0.74 },
];

for (const expectation of expectations) {
  const buffer = readFileSync(join(audioDirectory, expectation.name));
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${expectation.name} is not a RIFF/WAVE file.`);
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitDepth = buffer.readUInt16LE(34);
  const dataBytes = buffer.readUInt32LE(40);
  if (channels !== 1 || sampleRate !== 44_100 || bitDepth !== 16) {
    throw new Error(`${expectation.name} must be mono 44.1 kHz 16-bit PCM.`);
  }
  const duration = dataBytes / (channels * (bitDepth / 8) * sampleRate);
  if (duration < expectation.minimumDuration || duration > expectation.maximumDuration) {
    throw new Error(`${expectation.name} has unexpected duration ${String(duration)}.`);
  }
  let peak = 0;
  let sum = 0;
  const sampleCount = dataBytes / 2;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(44 + index * 2) / 32_768;
    peak = Math.max(peak, Math.abs(sample));
    sum += sample;
  }
  const dcOffset = Math.abs(sum / sampleCount);
  if (peak < 0.01 || peak > 0.2) {
    throw new Error(`${expectation.name} peak ${String(peak)} is silent or too loud.`);
  }
  if (dcOffset > 0.002) {
    throw new Error(`${expectation.name} DC offset ${String(dcOffset)} exceeds the safe bound.`);
  }
}
