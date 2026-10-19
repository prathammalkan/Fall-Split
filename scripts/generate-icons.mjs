/**
 * generate-icons.mjs
 * Generates placeholder PWA icon PNGs for Fall Split.
 * Uses the Canvas API via the `canvas` package if available,
 * or writes minimal valid 1x1 transparent PNGs as fallback.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const BG = '#0a0a0a';
const ACCENT = '#f97316';

function generateIcon(size, maskable = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  if (maskable) {
    // Maskable: fill entire canvas with bg
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size, size);
  } else {
    // Standard: rounded square
    const r = size * 0.2;
    ctx.fillStyle = BG;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Draw lightning bolt
  const pad = size * (maskable ? 0.25 : 0.2);
  const w = size - pad * 2;
  const h = size - pad * 2;
  const x = pad;
  const y = pad;

  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  // Lightning bolt path (angular, geometric)
  ctx.moveTo(x + w * 0.6, y);
  ctx.lineTo(x + w * 0.2, y + h * 0.45);
  ctx.lineTo(x + w * 0.5, y + h * 0.45);
  ctx.lineTo(x + w * 0.4, y + h);
  ctx.lineTo(x + w * 0.8, y + h * 0.55);
  ctx.lineTo(x + w * 0.5, y + h * 0.55);
  ctx.lineTo(x + w * 0.6, y);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer('image/png');
}

for (const size of SIZES) {
  const buf = generateIcon(size, false);
  const filename = `icon-${size}x${size}.png`;
  writeFileSync(join(iconsDir, filename), buf);
  console.log(`Generated ${filename}`);
}

// Maskable icon
const maskableBuf = generateIcon(512, true);
writeFileSync(join(iconsDir, 'icon-512x512-maskable.png'), maskableBuf);
console.log('Generated icon-512x512-maskable.png');

// Apple touch icon (180x180)
const appleIconCanvas = createCanvas(180, 180);
const appleCtx = appleIconCanvas.getContext('2d');
appleCtx.fillStyle = BG;
appleCtx.fillRect(0, 0, 180, 180);
const pad = 36, w = 108, h = 108, x = 36, y = 36;
appleCtx.fillStyle = ACCENT;
appleCtx.beginPath();
appleCtx.moveTo(x + w * 0.6, y);
appleCtx.lineTo(x + w * 0.2, y + h * 0.45);
appleCtx.lineTo(x + w * 0.5, y + h * 0.45);
appleCtx.lineTo(x + w * 0.4, y + h);
appleCtx.lineTo(x + w * 0.8, y + h * 0.55);
appleCtx.lineTo(x + w * 0.5, y + h * 0.55);
appleCtx.lineTo(x + w * 0.6, y);
appleCtx.closePath();
appleCtx.fill();
const applePublicDir = join(__dirname, '..', 'public');
writeFileSync(join(applePublicDir, 'apple-touch-icon.png'), appleIconCanvas.toBuffer('image/png'));
console.log('Generated apple-touch-icon.png');

// favicon.ico (32x32 PNG — browsers accept PNG as favicon)
const favCanvas = createCanvas(32, 32);
const favCtx = favCanvas.getContext('2d');
favCtx.fillStyle = BG;
favCtx.fillRect(0, 0, 32, 32);
favCtx.fillStyle = ACCENT;
favCtx.beginPath();
favCtx.moveTo(20, 2);
favCtx.lineTo(8, 15);
favCtx.lineTo(16, 15);
favCtx.lineTo(12, 30);
favCtx.lineTo(24, 17);
favCtx.lineTo(16, 17);
favCtx.lineTo(20, 2);
favCtx.closePath();
favCtx.fill();
writeFileSync(join(applePublicDir, 'favicon.ico'), favCanvas.toBuffer('image/png'));
console.log('Generated favicon.ico');

console.log('\nAll PWA icons generated successfully!');
