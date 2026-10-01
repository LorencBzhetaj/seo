// Ikona e SEO Tool (ICO me imazhe PNG 16–256 px), e vizatuar piksel për piksel me Node (zlib për PNG):
// katror i rrumbullakosur blu dhe një xham zmadhues me tri shtylla. Pa varësi dhe pa ekzekutues të jashtëm.
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Ngjyra e pikës (u, v ∈ [0,1]) ose null jashtë formës. */
function shade(u, v) {
  const r = 0.22;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null;
  const t = (u + v) / 2;
  let col = [37 + (14 - 37) * t, 99 + (116 - 99) * t, 235 + (144 - 235) * t];
  // xhami: unaza + bishti
  const gx = 0.44;
  const gy = 0.44;
  const R = 0.22;
  const w = 0.045;
  const d = Math.hypot(u - gx, v - gy);
  const ring = Math.abs(d - R) < w;
  const k = 0.72 * R / Math.SQRT2 + 0.05;
  const hx0 = gx + k;
  const hx1 = 0.78;
  const proj = Math.max(0, Math.min(1, ((u - hx0) + (v - hx0)) / (2 * (hx1 - hx0))));
  const px = hx0 + proj * (hx1 - hx0);
  const handle = Math.hypot(u - px, v - px) < w * 1.15;
  // tri shtylla brenda xhamit
  const bw = R * 0.3;
  const bars = [
    [gx - R * 0.55, gy + R * 0.5, R * 0.35],
    [gx - R * 0.15, gy + R * 0.5, R * 0.7],
    [gx + R * 0.25, gy + R * 0.5, R * 1.05],
  ];
  const bar = d < R - w && bars.some(([x, base, h]) => u >= x && u <= x + bw && v <= base && v >= base - h);
  if (ring || handle) col = [255, 255, 255];
  else if (bar) col = [225, 240, 255];
  return col;
}

function render(size) {
  const ss = 4; // supersampling për skaje të buta
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          a++;
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      const o = (y * size + x) * 4;
      if (a) for (let i = 0; i < 3; i++) out[o + i] = Math.round(sum[i] / a);
      out[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}

export function makeIcon(file) {
  const sizes = [16, 24, 32, 48, 64, 256];
  const imgs = sizes.map(render);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const o = 6 + i * 16;
    head[o] = s >= 256 ? 0 : s;
    head[o + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(imgs[i].length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += imgs[i].length;
  });
  fs.writeFileSync(file, Buffer.concat([head, ...imgs]));
  return imgs[sizes.indexOf(256)];
}

if (process.argv[2]) {
  const big = makeIcon(process.argv[2]);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], big);
}
