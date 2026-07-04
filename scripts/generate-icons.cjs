const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const outputDir = path.join(__dirname, '..', 'build');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPng(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const center = size / 2;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = row + 1 + x * 4;
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const inCircle = distance < size * 0.46;
      const inScreen = x > size * 0.22 && x < size * 0.78 && y > size * 0.30 && y < size * 0.68;
      const inPlay = x > size * 0.44 && x < size * 0.64 && Math.abs(y - size * 0.49) < (x - size * 0.42) * 0.52;
      const inSmile = y > size * 0.62 && y < size * 0.66 && x > size * 0.36 && x < size * 0.64;

      let color = [0, 0, 0, 0];
      if (inCircle) color = [255, 201, 61, 255];
      if (inScreen) color = [20, 30, 48, 255];
      if (inPlay) color = [255, 255, 255, 255];
      if (inSmile) color = [255, 255, 255, 255];
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIco(entries, filePath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = Buffer.concat(entries.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  }));
  fs.writeFileSync(filePath, Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]));
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'icon.png'), createPng(256));
writeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: createPng(size) })), path.join(outputDir, 'icon.ico'));
fs.writeFileSync(path.join(outputDir, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="118" fill="#ffc93d"/><rect x="56" y="76" width="144" height="98" rx="22" fill="#141e30"/><path d="M114 98v54l48-27z" fill="#fff"/><rect x="92" y="160" width="72" height="10" rx="5" fill="#fff"/></svg>\n`);
console.log('Generated build/icon.png, build/icon.ico, and build/icon.svg');
