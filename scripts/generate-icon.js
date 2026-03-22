#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PromptPlus — App Icon Generator
// Creates a 1024x1024 PNG icon (indigo gradient + white sparkle)
// Zero external dependencies — uses Node.js zlib for PNG compression
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Minimal PNG Encoder ────────────────────────────────────────────────────

function createPNG(width, height, pixels) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }

  function crc32(data) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const tb = Buffer.from(type, 'ascii');
    const lb = Buffer.alloc(4);
    lb.writeUInt32BE(data.length);
    const body = Buffer.concat([tb, data]);
    const cb = Buffer.alloc(4);
    cb.writeUInt32BE(crc32(body));
    return Buffer.concat([lb, body, cb]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * rowLen + 1 + x * 4;
      raw[di] = pixels[si]; raw[di+1] = pixels[si+1]; raw[di+2] = pixels[si+2]; raw[di+3] = pixels[si+3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Icon Renderer ──────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function generateIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;

  // Sparkle geometry
  const outerR = size * 0.26;   // 266px — tip of each ray
  const innerR = size * 0.08;   // 82px  — waist between rays
  const glowR  = size * 0.38;   // 389px — soft glow extent
  const coreR  = size * 0.05;   // 51px  — bright center disk

  // Gradient colors  (Indigo 500 → Indigo 700)
  const c1 = { r: 99, g: 102, b: 241 };   // #6366f1
  const c2 = { r: 67, g: 56,  b: 202 };   // #4338ca

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // ── Background gradient (diagonal)
      const gt = (x / size) * 0.55 + (y / size) * 0.45;
      let r = Math.round(lerp(c1.r, c2.r, gt));
      let g = Math.round(lerp(c1.g, c2.g, gt));
      let b = Math.round(lerp(c1.b, c2.b, gt));

      // ── Sparkle
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);

      // 4-pointed star shape: radius varies with angle
      const cos2t = Math.cos(2 * theta);
      const starR = innerR + (outerR - innerR) * cos2t * cos2t;

      let blend = 0;

      if (dist < coreR) {
        // Bright center disk
        blend = 1.0;
      } else if (dist <= starR) {
        // Star body — slight falloff near edges for anti-alias
        const edgeSoftness = clamp((starR - dist) / 3, 0, 1);
        blend = 0.95 * edgeSoftness;
      } else if (dist < glowR) {
        // Soft outer glow
        const t = (dist - starR) / (glowR - starR);
        blend = Math.pow(1 - t, 3) * 0.22;
      }

      // Add faint 8-pointed accent: thin diagonal rays
      if (blend < 0.15 && dist > coreR && dist < outerR * 1.3) {
        const cos2tOff = Math.cos(2 * theta + Math.PI / 4);
        const diagR = innerR * 0.3 + (outerR * 0.55 - innerR * 0.3) * cos2tOff * cos2tOff;
        if (dist < diagR) {
          const diagBlend = clamp((diagR - dist) / 2, 0, 1) * 0.35;
          blend = Math.max(blend, diagBlend);
        }
      }

      if (blend > 0) {
        r = Math.round(lerp(r, 255, blend));
        g = Math.round(lerp(g, 255, blend));
        b = Math.round(lerp(b, 255, blend));
      }

      // ── Subtle corner vignette
      const cornerT = dist / (size * 0.707);
      if (cornerT > 0.65) {
        const darken = 1 - ((cornerT - 0.65) / 0.35) * 0.25;
        r = Math.round(r * darken);
        g = Math.round(g * darken);
        b = Math.round(b * darken);
      }

      px[i] = clamp(r, 0, 255);
      px[i + 1] = clamp(g, 0, 255);
      px[i + 2] = clamp(b, 0, 255);
      px[i + 3] = 255;
    }
  }

  return px;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const SIZE = 1024;
const outDir = path.join(__dirname, '..', 'build');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`Generating ${SIZE}x${SIZE} icon...`);
const start = Date.now();
const pixels = generateIcon(SIZE);
const pngBuf = createPNG(SIZE, SIZE, pixels);

const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, pngBuf);
console.log(`✓ Icon saved to ${outPath}  (${(pngBuf.length / 1024).toFixed(0)} KB, ${Date.now() - start}ms)`);
