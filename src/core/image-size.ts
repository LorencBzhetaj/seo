import fs from 'node:fs';

/**
 * Përmasat reale të një imazhi JPEG/PNG, të lexuara nga header-i i skedarit (pa e dekoduar).
 * Përdoret për të verifikuar që screenshot-i i ruajtur ka përmasat që pretendon raporti.
 * null: format i panjohur ose skedar i dëmtuar.
 */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: nënshkrimi 8 bajt, pastaj IHDR me gjerësinë/lartësinë (big-endian)
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: SOI, pastaj segmente deri te SOFn (C0–CF, pa C4/C8/CC)
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export function imageFileSize(file: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      // Header-i (dhe segmentet EXIF/ICC para SOF) zakonisht janë në 64 KB e parë.
      const buf = Buffer.alloc(65536);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return imageSize(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
