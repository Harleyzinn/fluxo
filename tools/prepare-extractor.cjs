const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const extractZip = require('extract-zip');

const version = '2026.08.19';
const sha256 = '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a';
const target = path.resolve(__dirname, '../node_modules/yt-dlp-exec/bin/yt-dlp.exe');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
    const existing = await fs.readFile(target).catch(() => null);
    if (existing && hash(existing) === sha256) {
        console.log(`yt-dlp ${version}: SHA-256 verified`);
    } else {
        const response = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp.exe`, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`yt-dlp download: HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (hash(bytes) !== sha256) throw new Error('yt-dlp SHA-256 mismatch; existing binary kept');
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(`${target}.download`, bytes);
        await fs.rename(`${target}.download`, target);
        console.log(`yt-dlp ${version}: downloaded and SHA-256 verified`);
    }

    const runtimeDir = path.resolve(__dirname, '../vendor/deno');
    const runtime = await fs.readFile(path.join(runtimeDir, 'deno.exe')).catch(() => null);
    if (runtime && hash(runtime) === 'e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33') {
        console.log('Deno 2.9.7: SHA-256 verified');
        return;
    }
    const archive = path.join(runtimeDir, 'deno.zip');
    const response = await fetch('https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip', { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Deno download: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== 'a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238') throw new Error('Deno SHA-256 mismatch');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(archive, bytes);
    await extractZip(archive, { dir: runtimeDir });
    await fs.unlink(archive);
    console.log('Deno 2.9.7: downloaded and archive SHA-256 verified');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
