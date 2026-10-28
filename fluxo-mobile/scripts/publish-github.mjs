import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const repository = 'Harleyzinn/fluxo', tag = `mobile-v${version}`;
const mode = process.argv[2];
const names = [`Fluxo-Mobile-${version}.apk`, `Fluxo-Mobile-${version}-codigo.zip`, 'INSTALAR-NO-CELULAR.md', 'VERIFICACAO.md', 'LICENSE', 'THIRD_PARTY.md', `PLAYER-${version.replace(/\.0$/, '')}.md`, `RESULTADOS-${version}.json`, 'SHA256SUMS.txt'];
const digest = file => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;

async function main() {
  if (!['check', 'draft', 'upload', 'publish', 'verify'].includes(mode)) throw new Error('Choose check, draft, upload, publish or verify explicitly.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  const credential = execFileSync('git', ['credential', 'fill'], { cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } });
  const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GitHub credential unavailable.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Fluxo-Mobile-Release', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com${route}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GitHub ${method}: HTTP ${response.status}`);
    return response.json();
  };
  const repo = await api(`/repos/${repository}`);
  if (!repo.permissions?.push) throw new Error('Repository push permission required.');
  if (mode === 'check') { console.log(JSON.stringify({ repository: repo.full_name, push: true, tag, defaultBranch: repo.default_branch })); return; }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const evidence = JSON.parse(readFileSync(path.join(root, 'dist', `RESULTADOS-${version}.json`), 'utf8'));
  if (evidence.version !== version || evidence.sourceCommit !== head || `sha256:${evidence.apkSha256}` !== digest(path.join(root, 'dist', names[0]))) throw new Error('Validation evidence does not match this APK/source.');
  const builtAt = Date.parse(evidence.apkBuiltAt);
  if (!Number.isFinite(builtAt) || [evidence.nativeFocus, evidence.nativeBackground, evidence.nativeRenderer].some(result => !Number.isFinite(Date.parse(result?.startedAt)) || Date.parse(result.startedAt) < builtAt)) throw new Error('Stale or undated validation evidence.');
  const focusCases = ['interfaceSounds', 'background', 'lockedScreen', 'notifications', 'networkLoss', 'networkReturn', 'rapidAppSwitching', 'idleAudioPreferences', 'downloadCompletion'];
  const backgroundCases = ['notificationPause', 'notificationPlay', 'notificationNext', 'noAutomaticQueue', 'offlineRadio', 'sleepEnd', 'radioStopClearsRecommendations'];
  const rendererCases = ['foregroundAudioSurvives', 'backgroundRecoveryDeferred', 'idleRecoveryDoesNotStartAudio', 'recoveryLoopGuard'];
  if (evidence.nativeFocus?.appVersion !== version || evidence.nativeFocus.externalFocusLosses !== 0 || !focusCases.every(key => evidence.nativeFocus.scenarios?.[key] === true)
    || !backgroundCases.every(key => evidence.nativeBackground?.[key] === true) || evidence.nativeBackground.onlineScreenOff?.seconds < 180 || !evidence.nativeBackground.onlineScreenOff?.foreground
    || !rendererCases.every(key => evidence.nativeRenderer?.[key] === true) || !evidence.nativePlayer?.partialConfigurationPreserved) throw new Error('Required native validation evidence is missing.');
  if (execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit the mobile sources before releasing.');
  let release = (await api(`/repos/${repository}/releases?per_page=100`)).find(item => item.tag_name === tag);
  if (!release && mode === 'draft') release = await api(`/repos/${repository}/releases`, 'POST', {
    tag_name: tag, target_commitish: head, name: `Fluxo Mobile ${version}`, draft: true, prerelease: true, make_latest: 'false',
    body: readFileSync(path.join(root, `docs/RELEASE-${version.replace(/\.0$/, '')}.md`), 'utf8')
  });
  if (!release) throw new Error(`Create the draft ${tag} first.`);
  if (release.target_commitish !== head) throw new Error('Release target differs from the local commit.');
  if (mode === 'upload') {
    if (!release.draft) throw new Error('Refusing to modify published assets.');
    for (const name of names) {
      const file = path.join(root, 'dist', name), expected = digest(file);
      const existing = release.assets.find(asset => asset.name === name);
      if (existing) { if (existing.digest !== expected) throw new Error(`Existing asset differs: ${name}`); continue; }
      const url = new URL(release.upload_url.split('{')[0]); url.searchParams.set('name', name);
      const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: readFileSync(file), signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error(`Upload ${name}: HTTP ${response.status}`);
      const asset = await response.json();
      if (asset.size !== statSync(file).size || asset.digest && asset.digest !== expected) throw new Error(`Upload verification failed: ${name}`);
      console.log(JSON.stringify({ uploaded: name, bytes: asset.size }));
    }
  }
  if (mode === 'publish') {
    for (const name of names) {
      const file = path.join(root, 'dist', name), asset = release.assets.find(item => item.name === name);
      if (!asset || asset.size !== statSync(file).size || asset.digest !== digest(file)) throw new Error(`Missing or mismatched asset: ${name}`);
    }
    release = await api(`/repos/${repository}/releases/${release.id}`, 'PATCH', { draft: false, prerelease: true, make_latest: 'false' });
  }
  if (mode === 'verify') {
    if (release.draft) throw new Error('Release is not public.');
    for (const name of names.slice(0, 2)) {
      const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error(`Public download ${name}: HTTP ${response.status}`);
      const actual = `sha256:${createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')}`;
      if (actual !== digest(path.join(root, 'dist', name))) throw new Error(`Public download differs: ${name}`);
      console.log(JSON.stringify({ verifiedPublicDownload: name, digest: actual }));
    }
    const latest = await api(`/repos/${repository}/releases/latest`);
    if (latest.tag_name.startsWith('mobile-')) throw new Error('Desktop Latest release was replaced.');
    console.log(JSON.stringify({ desktopLatest: latest.tag_name }));
  }
  console.log(JSON.stringify({ url: release.html_url, tag, draft: release.draft, prerelease: release.prerelease, target: release.target_commitish }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
