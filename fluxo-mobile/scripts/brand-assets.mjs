import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const glyph = await sharp(fileURLToPath(new URL('www/assets/brand-original.png', root)))
  .extract({ left: 44, top: 55, width: 165, height: 110 }).png().toBuffer();
async function icon(size, relative, foreground = false) {
  const width = Math.round(size * (foreground ? 0.55 : 0.70));
  const image = await sharp(glyph).resize({ width }).png().toBuffer();
  const { height } = await sharp(image).metadata();
  const out = new URL(relative, root);
  await mkdir(new URL('./', out), { recursive: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: foreground ? 0 : 1 } } })
    .composite([{ input: image, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }]).png().toFile(fileURLToPath(out));
}
await icon(512, 'www/assets/brand-mark.png');
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const base = `android/app/src/main/res/mipmap-${density}/`;
  await icon(Math.round(48 * scale), base + 'ic_launcher.png');
  await icon(Math.round(48 * scale), base + 'ic_launcher_round.png');
  await icon(Math.round(108 * scale), base + 'ic_launcher_foreground.png', true);
}
console.log('Fluxo Android icons generated.');
