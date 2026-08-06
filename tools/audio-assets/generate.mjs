import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 44_100;
const outputDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'mobile',
  'assets',
  'audio',
);

function clamp(sample) {
  return Math.max(-1, Math.min(1, sample));
}

function writeWave(name, durationSeconds, sampleAt) {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    buffer.writeInt16LE(Math.round(clamp(sampleAt(time, index)) * 32_767), 44 + index * 2);
  }
  writeFileSync(join(outputDirectory, name), buffer);
}

mkdirSync(outputDirectory, { recursive: true });

let noiseState = 0x5f3759df;
let filteredNoise = 0;
writeWave('paper-draw.wav', 0.42, (time) => {
  noiseState = (Math.imul(noiseState, 1_664_525) + 1_013_904_223) >>> 0;
  const noise = (noiseState / 0xffff_ffff) * 2 - 1;
  filteredNoise = filteredNoise * 0.82 + noise * 0.18;
  const envelope = Math.sin(Math.PI * Math.min(time / 0.42, 1)) ** 2;
  const body = Math.sin(2 * Math.PI * 174 * time) * Math.exp(-7 * time);
  return envelope * filteredNoise * 0.09 + body * 0.025;
});

const shimmerNotes = [523.25, 659.25, 783.99];
writeWave('reveal-shimmer.wav', 0.72, (time) => {
  let sample = 0;
  for (const [index, frequency] of shimmerNotes.entries()) {
    const onset = index * 0.105;
    const noteTime = time - onset;
    if (noteTime < 0) continue;
    const attack = Math.min(noteTime / 0.018, 1);
    const decay = Math.exp(-4.8 * noteTime);
    sample +=
      attack *
      decay *
      (Math.sin(2 * Math.PI * frequency * noteTime) +
        0.24 * Math.sin(2 * Math.PI * frequency * 2 * noteTime));
  }
  const finalFade = Math.max(0, Math.min(1, (0.72 - time) / 0.16));
  return sample * finalFade * 0.055;
});
