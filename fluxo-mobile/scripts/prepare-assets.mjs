import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await import('./brand-assets.mjs');
await mkdir(new URL('www/vendor/', root), { recursive: true });
await copyFile(new URL('node_modules/lucide/dist/umd/lucide.min.js', root), new URL('www/vendor/lucide.min.js', root));
await copyFile(new URL('node_modules/lucide/LICENSE', root), new URL('www/vendor/LUCIDE-LICENSE', root));
console.log('Local assets ready:', fileURLToPath(new URL('www/vendor/', root)));
