// Programmatic Round 4 marketing-cover brightness gate.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = ['cover-16x9.png', 'cover-1x1.png', 'cover-2x3.png'];
let failed = false;

function pngPixels(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 1, 4) !== 'PNG') throw new Error(path + ': not a PNG');
  let offset = 8, width, height, depth, type, chunks = [];
  while (offset < b.length) {
    const len = b.readUInt32BE(offset), name = b.toString('ascii', offset + 4, offset + 8), data = b.subarray(offset + 8, offset + 8 + len); offset += len + 12;
    if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; }
    if (name === 'IDAT') chunks.push(data);
    if (name === 'IEND') break;
  }
  if (depth !== 8 || !([2, 6].includes(type))) throw new Error(path + ': expected 8-bit RGB/RGBA PNG');
  const channels = type === 6 ? 4 : 3, stride = width * channels, raw = inflateSync(Buffer.concat(chunks));
  const out = new Uint8Array(width * height * channels); let prev = new Uint8Array(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++], row = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b0 = prev[x] || 0, c = x >= channels ? prev[x - channels] : 0, v = raw[p++];
      if (filter === 1) row[x] = (v + a) & 255;
      else if (filter === 2) row[x] = (v + b0) & 255;
      else if (filter === 3) row[x] = (v + Math.floor((a + b0) / 2)) & 255;
      else if (filter === 4) { const q = a + b0 - c, pa = Math.abs(q - a), pb = Math.abs(q - b0), pc = Math.abs(q - c); row[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b0 : c)) & 255; }
      else row[x] = v;
    }
    prev = row;
  }
  return { width, height, channels, data: out };
}
for (const file of files) {
  const im = pngPixels(join(root, 'marketing', file)); let lumSum = 0, satSum = 0, dark = 0;
  const n = im.width * im.height;
  for (let i = 0; i < im.data.length; i += im.channels) {
    const r = im.data[i] / 255, g = im.data[i + 1] / 255, b = im.data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * 255;
    lumSum += lum; satSum += max === 0 ? 0 : (max - min) / max; if (lum < 40) dark++;
  }
  const meanLum = lumSum / n, darkFrac = dark / n, meanSat = satSum / n;
  const pass = meanLum >= 80 && darkFrac <= .35 && meanSat >= .35;
  console.log(`${file}: meanLum=${meanLum.toFixed(2)} darkFrac=${darkFrac.toFixed(4)} meanSat=${meanSat.toFixed(4)} ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) failed = true;
}
process.exit(failed ? 1 : 0);
