const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'));
for (const forbidden of ['/MAPA_MENTAL_FLUXO.canvas', '/MAPA_MENTAL_OBSIDIAN_FLUXO.md', '/.obsidian', '/.env', '/backups', '/tests', '/tools', '/vendor', '/.git']) {
    assert.equal(files.some(file => file === forbidden || file.startsWith(`${forbidden}/`)), false, `Private/development file in package: ${forbidden}`);
}
for (const file of ['/main.js', '/preload.js', '/script.js', '/index.html', '/style.css', '/themes-collection.css']) {
    assert.ok(files.includes(file), `Missing ${file}`);
    assert.deepEqual(asar.extractFile(archive, file.slice(1)), fs.readFileSync(path.join(root, file.slice(1))), `Stale packaged file: ${file}`);
}
const packedConfig = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(packedConfig.version, version);
assert.ok(fs.existsSync(path.join(root, 'dist/win-unpacked/resources/THIRD_PARTY_NOTICES.txt')));
const hash = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
for (const [source, bundled] of [['node_modules/yt-dlp-exec/bin/yt-dlp.exe', 'yt-dlp.exe'], ['vendor/deno/deno.exe', 'deno.exe']]) {
    assert.equal(hash(path.join(root, source)), hash(path.join(root, 'dist/win-unpacked/resources/yt-dlp-bin', bundled)));
}
const update = yaml.load(fs.readFileSync(path.join(root, 'dist/latest.yml'), 'utf8'));
assert.equal(update.version, version);
const installer = path.join(root, 'dist', `Fluxo-Music-Setup-${version}.exe`);
assert.equal(update.files[0].url, path.basename(installer));
assert.equal(update.files[0].size, fs.statSync(installer).size);
assert.equal(update.files[0].sha512, hash(installer, 'sha512', 'base64'));
assert.ok(fs.statSync(`${installer}.blockmap`).size > 0);
console.log(JSON.stringify({ version, installer, bytes: fs.statSync(installer).size, packagePrivacy: 'passed', runtimes: 'verified', updaterManifest: 'verified' }));
