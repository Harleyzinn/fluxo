const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const repository = 'Harleyzinn/fluxo';
const tag = `v${version}`;

async function main() {
    const mode = process.argv[2];
    if (!['check', 'draft', 'upload', 'publish'].includes(mode)) throw new Error('Choose check, draft, upload or publish explicitly');
    // Credentials stay in memory and are never written to files or console.
    const credential = execFileSync('git', ['credential', 'fill'], {
        cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
    });
    const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
    if (!token) throw new Error('GitHub credential unavailable');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Fluxo-Release', 'X-GitHub-Api-Version': '2022-11-28' };
    const api = async (route, method = 'GET', body) => {
        const response = await fetch(`https://api.github.com${route}`, {
            method, headers: { ...headers, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error(`GitHub ${method}: HTTP ${response.status}`);
        return response.json();
    };
    const repo = await api(`/repos/${repository}`);
    if (mode === 'check') {
        console.log(JSON.stringify({ repository: repo.full_name, push: repo.permissions?.push, defaultBranch: repo.default_branch }));
        return;
    }
    const releases = await api(`/repos/${repository}/releases?per_page=100`);
    let release = releases.find(item => item.tag_name === tag);
    if (!release && mode === 'draft') {
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        release = await api(`/repos/${repository}/releases`, 'POST', {
            tag_name: tag, target_commitish: commit, name: `Fluxo Music ${version}`, draft: true,
            body: fs.readFileSync(path.join(root, `release-notes-${version}.md`), 'utf8')
        });
    }
    if (!release) throw new Error(`Create draft ${tag} first`);
    if (mode === 'upload') {
        if (!release.draft) throw new Error('Refusing to replace assets on a published release');
        for (const name of [`Fluxo-Music-Setup-${version}.exe`, `Fluxo-Music-Setup-${version}.exe.blockmap`, 'latest.yml']) {
            const file = path.join(root, 'dist', name);
            const existing = release.assets.find(asset => asset.name === name);
            if (existing) throw new Error(`Asset already exists; verify it before retrying: ${name}`);
            const url = new URL(release.upload_url.split('{')[0]);
            url.searchParams.set('name', name);
            const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(file), signal: AbortSignal.timeout(300000) });
            if (!response.ok) throw new Error(`Upload ${name}: HTTP ${response.status}`);
            const asset = await response.json();
            if (asset.size !== fs.statSync(file).size) throw new Error(`Upload size mismatch: ${name}`);
            const expectedDigest = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
            if (asset.digest && asset.digest !== expectedDigest) throw new Error(`Upload digest mismatch: ${name}`);
            console.log(JSON.stringify({ uploaded: name, bytes: asset.size }));
        }
    }
    if (mode === 'publish') {
        for (const name of [`Fluxo-Music-Setup-${version}.exe`, `Fluxo-Music-Setup-${version}.exe.blockmap`, 'latest.yml']) {
            if (!release.assets.some(asset => asset.name === name && asset.size === fs.statSync(path.join(root, 'dist', name)).size)) throw new Error(`Missing or mismatched asset: ${name}`);
        }
        release = await api(`/repos/${repository}/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' });
    }
    console.log(JSON.stringify({ id: release.id, url: release.html_url, draft: release.draft, tag: release.tag_name }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
