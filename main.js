const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const express = require('express');
const ytSearch = require('yt-search');
const { autoUpdater } = require('electron-updater'); // <-- ATUALIZADOR
const packageConfig = require('./package.json');
let DiscordRPC = null;
try {
    DiscordRPC = require('discord-rpc');
} catch (error) {
    console.log('Discord RPC indisponivel:', error.message);
}

// =========================================================================
// CORREÇÃO DEFINITIVA: EXTRA RESOURCES
// O ASAR esmaga executáveis. Essa rota tira o yt-dlp do ASAR e coloca na raiz do app.
// =========================================================================
const isPackaged = app.isPackaged;
function resolveYtDlpPath() {
  const candidates = isPackaged
    ? [
        path.join(process.resourcesPath, 'yt-dlp-bin', 'yt-dlp.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe')
      ]
    : [
        path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe')
      ];

  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

const ytDlpPath = resolveYtDlpPath();

// Importa e vincula o yt-dlp ao caminho correto
const ytDlp = require('yt-dlp-exec').create(ytDlpPath);

function warmupYtDlp() {
    const startedAt = Date.now();
    ytDlpWarmupStatus = {
        ok: false,
        done: false,
        version: '',
        elapsedMs: 0,
        error: ''
    };

    if (!fs.existsSync(ytDlpPath)) {
        ytDlpWarmupStatus = {
            ok: false,
            done: true,
            version: '',
            elapsedMs: Date.now() - startedAt,
            error: 'yt-dlp.exe nao encontrado no pacote.'
        };
        return;
    }

    execFile(ytDlpPath, ['--version'], { timeout: 12000 }, (error, stdout, stderr) => {
        ytDlpWarmupStatus = {
            ok: !error,
            done: true,
            version: String(stdout || '').trim(),
            elapsedMs: Date.now() - startedAt,
            error: error ? String(stderr || error.message || error).slice(0, 600) : ''
        };
        if (error) console.log('Warmup do yt-dlp falhou:', ytDlpWarmupStatus.error);
        else console.log(`Warmup do yt-dlp ok (${ytDlpWarmupStatus.version}) em ${ytDlpWarmupStatus.elapsedMs}ms`);
    });
}

let mainWindow;
let normalBounds;
const STREAM_CACHE_TTL_MS = 45 * 60 * 1000;
const STREAM_PROXY_TTL_MS = 50 * 60 * 1000;
const SOUNDCLOUD_CLIENT_ID_TTL_MS = 6 * 60 * 60 * 1000;
const streamUrlCache = new Map();
const streamUrlInflight = new Map();
const streamProxyEntries = new Map();
let ytDlpWarmupStatus = {
    ok: false,
    done: false,
    version: '',
    elapsedMs: 0,
    error: ''
};
let soundCloudClientId = '';
let soundCloudClientIdExpiresAt = 0;
let discordClient = null;
let discordLoginPromise = null;
let discordReady = false;
let lastDiscordPresenceRequest = null;
let discordRetryTimer = null;
const discordClientId = packageConfig.discordClientId || '1487787955186565250';
const FLUXO_RPC_URL = packageConfig.homepage || 'https://github.com/Harleyzinn/fluxo';
let floatingWidgetWindow = null;
let streamerOverlayWindow = null;
let lastNowPlayingPayload = null;
let controlServer = null;
let controlServerStartup = null;
let controlServerInfo = {
    enabled: false,
    host: '127.0.0.1',
    port: null,
    url: '',
    lastError: ''
};
let discordStatus = {
    clientId: discordClientId,
    state: DiscordRPC ? 'idle' : 'unavailable',
    lastError: DiscordRPC ? '' : 'Pacote discord-rpc indisponivel.',
    buttonsSent: false,
    buttonsAccepted: false,
    lastButtons: [],
    payloadMode: 'sem botoes',
    lastUpdatedAt: null
};

function setDiscordStatus(patch) {
    discordStatus = {
        ...discordStatus,
        ...patch,
        clientId: discordClientId,
        lastUpdatedAt: new Date().toISOString()
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-status-update', discordStatus);
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function serializeForInlineScript(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => ({
        '<': '\\u003c',
        '>': '\\u003e',
        '&': '\\u0026',
        '\u2028': '\\u2028',
        '\u2029': '\\u2029'
    }[char]));
}

function stripCssString(value) {
    return String(value || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/\\"/g, '"')
        .trim();
}

function sanitizeWidgetClass(value) {
    return String(value || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';
}

function sanitizeWidgetCssValue(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/[<>;{}]/.test(raw) || /javascript:/i.test(raw) || /url\s*\(/i.test(raw)) return fallback;
    return raw.slice(0, 900);
}

function sanitizeWidgetFont(value, fallback = '"Segoe UI", Arial, sans-serif') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/[^a-zA-Z0-9\s"',._-]/.test(raw)) return fallback;
    return raw.slice(0, 160);
}

function getNowPlayingThemeStyle(payload = {}, isOverlay = false) {
    const theme = payload.theme || {};
    const palette = theme.palette || {};
    const themeId = sanitizeWidgetClass(theme.id || 'default');
    const accent = sanitizeWidgetCssValue(palette.accent, '#00ffcc');
    const secondary = sanitizeWidgetCssValue(palette.secondary, '#ff0055');
    const tertiary = sanitizeWidgetCssValue(palette.tertiary, '#ff00ff');
    const text = sanitizeWidgetCssValue(palette.text, '#f4f7fb');
    const muted = sanitizeWidgetCssValue(palette.muted, '#aeb6c2');
    const bg = sanitizeWidgetCssValue(palette.bg, '#05070c');
    const panel = sanitizeWidgetCssValue(palette.panel, 'rgba(5,7,12,.92)');
    const overlay = sanitizeWidgetCssValue(palette.overlay, panel);
    const partyBg = sanitizeWidgetCssValue(palette.partyBg, overlay);
    const partyFx = sanitizeWidgetCssValue(palette.partyFx, 'linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent)');
    const line = sanitizeWidgetCssValue(palette.line, `1px solid ${accent}`);
    const radius = sanitizeWidgetCssValue(palette.radius, '10px');
    const coverRadius = sanitizeWidgetCssValue(palette.coverRadius, radius);
    const coverBorder = sanitizeWidgetCssValue(palette.coverBorder, line);
    const coverFilter = sanitizeWidgetCssValue(palette.coverFilter, 'none');
    const meterFill = sanitizeWidgetCssValue(palette.meterFill, `linear-gradient(90deg, ${accent}, ${secondary})`);
    const font = sanitizeWidgetFont(palette.font);
    const rawLabel = isOverlay
        ? (theme.partyLabel || theme.badge || 'FLUXO OBS OVERLAY')
        : (theme.badge || theme.partyLabel || 'FLUXO WIDGET');
    const rawSigil = theme.sigil || 'FLX';

    return {
        themeId,
        accent,
        secondary,
        tertiary,
        text,
        muted,
        bg,
        surface: isOverlay ? partyBg : overlay,
        fx: isOverlay ? partyFx : 'linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 42px), radial-gradient(circle at 18% 20%, rgba(255,255,255,.08), transparent 24%)',
        line,
        radius,
        coverRadius,
        coverBorder,
        coverFilter,
        meterFill,
        font,
        label: stripCssString(rawLabel).slice(0, 64) || (isOverlay ? 'FLUXO OBS OVERLAY' : 'FLUXO WIDGET'),
        sigil: stripCssString(rawSigil).slice(0, 18) || 'FLX'
    };
}

function normalizeYouTubeTarget(input) {
    const raw = extractFirstHttpUrl(input);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return `https://www.youtube.com/watch?v=${raw}`;
    return `ytsearch1:${raw}`;
}

function isDirectYouTubeTarget(input) {
    const raw = extractFirstHttpUrl(input);
    const parsed = getParsedMediaUrl(raw);
    return (parsed && isYouTubeHost(parsed.hostname)) || /^[a-zA-Z0-9_-]{11}$/.test(raw);
}

function isDirectSoundCloudTarget(input) {
    const parsed = getParsedMediaUrl(input);
    return Boolean(parsed && isSoundCloudHost(parsed.hostname));
}

function sanitizeFileName(name, fallback = 'Fluxo Track') {
    const safe = String(name || fallback)
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);

    return safe || fallback;
}

function getTrackTargetFromPayload(track) {
    if (!track) return '';
    const url = String(track.url || '').trim();
    if (url && !/spotify\.com|spotify\.link/i.test(url)) return normalizeYouTubeTarget(url);
    if (track.videoId) return normalizeYouTubeTarget(track.videoId);
    if (track.soundcloudId || /^soundcloud:/i.test(String(track.id || ''))) return normalizeYouTubeTarget(url || track.id);

    const id = String(track.id || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(id) || /^https?:\/\//i.test(id)) return normalizeYouTubeTarget(id);
    if (/^ghost_|^spotify:/i.test(id) || /spotify\.com|spotify\.link/i.test(url)) return normalizeYouTubeTarget(track.query || track.title || '');

    return normalizeYouTubeTarget(track.query || track.title || id || '');
}

function formatSecondsLabel(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

function getFriendlyMediaError(error) {
    const message = String(error?.stderr || error?.message || error || '').replace(/\r/g, '');
    const lower = message.toLowerCase();

    if (lower.includes('drm protected')) {
        return 'Esse video tem DRM/protecao e nao permite converter ou cortar sample.';
    }
    if (lower.includes('private video')) {
        return 'Esse video esta privado e nao pode ser processado.';
    }
    if (lower.includes('video unavailable') || lower.includes('not available')) {
        return 'Esse video nao esta disponivel para processamento.';
    }
    if (lower.includes('sign in') || lower.includes('age-restricted')) {
        return 'O YouTube bloqueou esse video por login, idade ou restricao regional.';
    }
    if (lower.includes('ffmpeg') && (lower.includes('not found') || lower.includes('no such file'))) {
        return 'FFmpeg nao foi encontrado para finalizar a conversao.';
    }

    const usefulLine = message
        .split('\n')
        .map(line => line.trim())
        .find(line => line && !line.startsWith('Command failed:') && !line.startsWith('C:\\'));

    return usefulLine || 'Falha ao processar essa midia.';
}

function renderNowPlayingWidgetHtml(payload = {}, mode = 'widget') {
    const title = payload.title || 'Fluxo Music';
    const artist = payload.artist || 'Aguardando musica';
    const thumbnail = /^https?:\/\/[^\s"'<>]+$/i.test(String(payload.thumbnail || '').trim())
        ? String(payload.thumbnail || '').trim()
        : '';
    const progress = Math.max(0, Math.min(100, Number(payload.progressPercent) || 0));
    const current = payload.currentTimeLabel || '0:00';
    const duration = payload.durationLabel || '0:00';
    const isOverlay = mode === 'streamer';
    const theme = getNowPlayingThemeStyle(payload, isOverlay);
    const themeClass = `theme-${theme.themeId}`;
    const initialPayload = serializeForInlineScript({
        title,
        artist,
        thumbnail,
        progressPercent: progress,
        currentTimeLabel: current,
        durationLabel: duration
    });

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
:root {
    --accent:${theme.accent};
    --secondary:${theme.secondary};
    --tertiary:${theme.tertiary};
    --text:${theme.text};
    --muted:${theme.muted};
    --bg:${theme.bg};
    --surface:${theme.surface};
    --fx:${theme.fx};
    --line:${theme.line};
    --radius:${theme.radius};
    --cover-radius:${theme.coverRadius};
    --cover-border:${theme.coverBorder};
    --cover-filter:${theme.coverFilter};
    --meter-fill:${theme.meterFill};
    --font:${theme.font};
}
* { box-sizing:border-box; }
html, body { margin:0; width:100%; height:100%; background:transparent; overflow:hidden; font-family:var(--font), "Segoe UI", Arial, sans-serif; color:var(--text); }
body { -webkit-font-smoothing:antialiased; }
.wrap { position:relative; box-sizing:border-box; width:100%; height:100%; display:flex; align-items:center; gap:${isOverlay ? '18px' : '13px'}; padding:${isOverlay ? '18px 24px' : '12px'}; background:var(--surface); border:var(--line); border-radius:var(--radius); box-shadow:0 18px 54px rgba(0,0,0,.48), 0 0 34px color-mix(in srgb, var(--accent), transparent 78%); -webkit-app-region:drag; isolation:isolate; overflow:hidden; }
.wrap::before { content:""; position:absolute; inset:0; pointer-events:none; background:var(--fx); background-size:56px 56px; opacity:.72; z-index:-1; }
.wrap::after { content:""; position:absolute; left:0; right:0; bottom:0; height:3px; background:linear-gradient(90deg,var(--accent),var(--secondary),var(--tertiary)); box-shadow:0 0 18px var(--accent); pointer-events:none; }
.cover { flex:0 0 ${isOverlay ? '92px' : '64px'}; width:${isOverlay ? '92px' : '64px'}; height:${isOverlay ? '92px' : '64px'}; display:flex; align-items:center; justify-content:center; background-size:cover; background-position:center; border:var(--cover-border); border-radius:var(--cover-radius); box-shadow:0 16px 38px rgba(0,0,0,.46), 0 0 24px color-mix(in srgb, var(--secondary), transparent 72%); filter:var(--cover-filter); overflow:hidden; }
.cover.empty { color:var(--accent); background:linear-gradient(135deg, color-mix(in srgb, var(--accent), transparent 88%), rgba(0,0,0,.5)); font-weight:900; letter-spacing:2px; text-shadow:0 0 14px var(--accent); }
.cover span { max-width:100%; overflow:hidden; text-overflow:ellipsis; }
.meta { min-width:0; flex:1; position:relative; }
.kicker { color:var(--accent); font-size:${isOverlay ? '12px' : '10px'}; font-weight:900; letter-spacing:1.4px; text-transform:uppercase; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.title { font-size:${isOverlay ? '28px' : '17px'}; line-height:1.05; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 18px color-mix(in srgb, var(--accent), transparent 74%); }
.artist { color:var(--muted); font-size:${isOverlay ? '17px' : '12px'}; margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bar { height:${isOverlay ? '7px' : '5px'}; background:color-mix(in srgb, var(--text), transparent 88%); margin-top:${isOverlay ? '12px' : '9px'}; overflow:hidden; border-radius:999px; border:1px solid color-mix(in srgb, var(--accent), transparent 72%); }
.fill { height:100%; width:0%; background:var(--meter-fill); box-shadow:0 0 18px var(--accent); transition:width .28s ease; }
.time { margin-top:5px; color:color-mix(in srgb, var(--text), transparent 20%); font-size:${isOverlay ? '13px' : '11px'}; font-weight:700; }
.sigil { flex:0 0 ${isOverlay ? '96px' : '42px'}; min-width:0; display:flex; align-items:center; justify-content:center; color:var(--secondary); font-size:${isOverlay ? '18px' : '10px'}; font-weight:900; letter-spacing:1px; text-transform:uppercase; opacity:.72; text-align:center; text-shadow:0 0 18px color-mix(in srgb, var(--secondary), transparent 44%); }
.close { position:absolute; top:6px; right:8px; width:22px; height:22px; border:1px solid color-mix(in srgb, var(--text), transparent 78%); background:rgba(0,0,0,.28); color:var(--text); border-radius:4px; -webkit-app-region:no-drag; cursor:pointer; opacity:.28; transition:.18s ease; z-index:2; }
.wrap:hover .close { opacity:.92; }
body.streamer .close { opacity:0; }
body.streamer .wrap:hover .close { opacity:.74; }
body.widget .sigil { flex-basis:34px; font-size:9px; }
body.theme-default .wrap { clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px); }
body.theme-minecraft .wrap { image-rendering:pixelated; border:4px solid #111; box-shadow:inset 4px 4px 0 rgba(255,255,255,.12), inset -5px -5px 0 rgba(0,0,0,.45), 0 16px 0 rgba(0,0,0,.24); }
body.theme-minecraft .cover, body.theme-minecraft .bar, body.theme-minecraft .close { border-radius:0; }
body.theme-minecraft .wrap::after { height:9px; background:repeating-linear-gradient(90deg,#202020 0 48px,var(--accent) 48px 54px,#202020 54px 102px); }
body.theme-darkbrotherhood .wrap { box-shadow:inset 0 0 90px rgba(157,0,24,.18), 0 24px 70px rgba(0,0,0,.7); }
body.theme-darkbrotherhood .sigil { color:var(--accent); font-family:Georgia, serif; }
body.theme-error .wrap { box-shadow:inset 0 0 0 2px rgba(255,255,255,.55), 12px 12px 0 rgba(0,0,0,.36); }
body.theme-error .wrap::before { opacity:.9; background:linear-gradient(180deg, rgba(255,255,255,.14) 0 2px, transparent 2px 7px), var(--fx); }
body.theme-error .bar { border-radius:0; }
body.theme-matrix .wrap { font-family:"Fira Code", monospace; text-shadow:0 0 10px color-mix(in srgb, var(--accent), transparent 48%); }
body.theme-matrix .wrap::before { opacity:.88; background:repeating-linear-gradient(90deg, rgba(0,255,65,.14) 0 1px, transparent 1px 18px), repeating-linear-gradient(0deg, transparent 0 15px, rgba(0,255,65,.08) 15px 16px); }
body.theme-souleater .wrap { transform:skewX(-1deg); border-radius:18px 6px 22px 8px; box-shadow:-9px 9px 0 color-mix(in srgb, var(--secondary), transparent 44%), 0 20px 60px rgba(0,0,0,.6); }
body.theme-souleater .wrap::before { opacity:.92; background:radial-gradient(circle at 80% 16%, #ffcf32 0 42px, transparent 44px), var(--fx); }
body.theme-adolla .wrap { background:linear-gradient(180deg, rgba(245,245,245,.94), rgba(18,18,18,.92) 30%, #020202); color:#fff; border:2px solid rgba(255,255,255,.86); }
body.theme-adolla .wrap::before { opacity:.9; background:radial-gradient(ellipse at 50% 100%, rgba(255,255,255,.46), transparent 42%), repeating-linear-gradient(112deg, rgba(255,255,255,.18) 0 7px, rgba(0,0,0,.18) 7px 15px, transparent 15px 34px); }
body.theme-adolla .fill { background:linear-gradient(90deg,#fff,#8c8c8c,#050505); }
body.theme-persona5 .wrap { clip-path:polygon(0 0,96% 0,100% 19%,98% 100%,4% 100%,0 82%); border:3px solid #fff; }
body.theme-persona5 .cover { transform:rotate(-2deg); box-shadow:8px 8px 0 var(--accent), -5px -5px 0 #fff; }
body.theme-hollowknight .cover { border-radius:42% 42% 24% 24%; }
body.theme-eldenring .wrap::before { background:repeating-radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--accent), transparent 72%) 0 1px, transparent 1px 26px), var(--fx); }
body.theme-zelda .wrap { clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px)); }
body.theme-onepiece .cover { border-radius:50%; }
body.theme-naruto .wrap { border-radius:8px 24px 8px 24px; }
body.theme-jujutsu .wrap::before { background:radial-gradient(circle at 70% 15%, color-mix(in srgb, var(--accent), transparent 58%), transparent 24%), repeating-linear-gradient(105deg, transparent 0 46px, rgba(255,255,255,.055) 46px 48px); }
body.theme-aot .wrap { box-shadow:inset 0 0 0 6px rgba(213,208,189,.08), 0 22px 54px rgba(0,0,0,.58); }
body.theme-evangelion .wrap { clip-path:polygon(0 0,92% 0,100% 28%,100% 100%,8% 100%,0 72%); }
body.theme-undertale .wrap { border:3px solid #fff; box-shadow:none; }
body.theme-undertale .bar { border:2px solid #fff; border-radius:0; }
</style>
</head>
<body class="${isOverlay ? 'streamer' : 'widget'} ${themeClass}">
<div class="wrap">
<button class="close" onclick="window.close()">x</button>
<div class="cover" id="cover"><span id="coverText"></span></div>
<div class="meta">
<div class="kicker">${escapeHtml(theme.label)}</div>
<div class="title" id="title"></div>
<div class="artist" id="artist"></div>
<div class="bar"><div class="fill"></div></div>
<div class="time"><span id="current"></span> / <span id="duration"></span></div>
</div>
<div class="sigil">${escapeHtml(theme.sigil)}</div>
</div>
<script>
const initialPayload = ${initialPayload};
function clampProgress(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
}
function safeImageUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\\/\\/[^\\s"'<>]+$/i.test(url) ? url : '';
}
function applyPayload(payload) {
    document.getElementById('title').textContent = payload.title || 'Fluxo Music';
    document.getElementById('artist').textContent = payload.artist || 'Aguardando musica';
    document.getElementById('current').textContent = payload.currentTimeLabel || '0:00';
    document.getElementById('duration').textContent = payload.durationLabel || '0:00';
    document.querySelector('.fill').style.width = clampProgress(payload.progressPercent) + '%';

    const cover = document.getElementById('cover');
    const coverText = document.getElementById('coverText');
    const imageUrl = safeImageUrl(payload.thumbnail);
    cover.classList.toggle('empty', !imageUrl);
    cover.style.backgroundImage = imageUrl ? 'url("' + imageUrl.replace(/"/g, '%22') + '")' : '';
    coverText.textContent = imageUrl ? '' : 'FLX';
}
window.__applyFluxoPayload = applyPayload;
applyPayload(initialPayload);
</script>
</body>
</html>`;
}

function updateAuxNowPlayingWindows() {
    if (!lastNowPlayingPayload) return;

    const targets = [
        { win: floatingWidgetWindow, mode: 'widget' },
        { win: streamerOverlayWindow, mode: 'streamer' }
    ];

    for (const target of targets) {
        if (!target.win || target.win.isDestroyed()) continue;
        const html = renderNowPlayingWidgetHtml(lastNowPlayingPayload, target.mode);
        target.win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
}

function openNowPlayingWindow(mode = 'widget') {
    const isStreamer = mode === 'streamer';
    const existing = isStreamer ? streamerOverlayWindow : floatingWidgetWindow;
    if (existing && !existing.isDestroyed()) {
        existing.show();
        existing.focus();
        return true;
    }

    const win = new BrowserWindow({
        width: isStreamer ? 760 : 360,
        height: isStreamer ? 132 : 96,
        minWidth: isStreamer ? 520 : 280,
        minHeight: isStreamer ? 100 : 80,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: false,
        backgroundColor: '#00000000',
        icon: path.join(__dirname, 'icon.ico')
    });

    if (isStreamer) streamerOverlayWindow = win;
    else floatingWidgetWindow = win;

    win.on('closed', () => {
        if (isStreamer) streamerOverlayWindow = null;
        else floatingWidgetWindow = null;
    });

    updateAuxNowPlayingWindows();
    return true;
}

function getBestThumbnail(info) {
    if (Array.isArray(info?.thumbnails) && info.thumbnails.length > 0) {
        const sorted = [...info.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
        return sorted[0]?.url || info.thumbnail || '';
    }
    return info?.thumbnail || '';
}

function extractFirstHttpUrl(input) {
    const raw = String(input || '').trim();
    const match = raw.match(/https?:\/\/[^\s<>"']+/i);
    return (match ? match[0] : raw).replace(/[)\],.;]+$/g, '');
}

function getParsedMediaUrl(input) {
    const raw = extractFirstHttpUrl(input);
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

function isYouTubeHost(hostname) {
    const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
    return host === 'youtu.be'
        || host === 'youtube.com'
        || host === 'music.youtube.com'
        || host === 'm.youtube.com'
        || host.endsWith('.youtube.com')
        || host === 'youtube-nocookie.com'
        || host.endsWith('.youtube-nocookie.com');
}

function getYouTubeVideoId(input) {
    const raw = extractFirstHttpUrl(input);
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

    const parsed = getParsedMediaUrl(raw);
    if (!parsed || !isYouTubeHost(parsed.hostname)) return '';

    const pathname = parsed.pathname || '';
    if (parsed.hostname.replace(/^www\./i, '').toLowerCase() === 'youtu.be') {
        return pathname.split('/').filter(Boolean)[0] || '';
    }

    const queryId = parsed.searchParams.get('v');
    if (queryId) return queryId;

    const match = pathname.match(/\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/i);
    return match?.[1] || '';
}

function getYouTubeListId(input) {
    const parsed = getParsedMediaUrl(input);
    if (!parsed || !isYouTubeHost(parsed.hostname)) return '';
    return parsed.searchParams.get('list') || '';
}

function isSoundCloudHost(hostname) {
    const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
    return host === 'soundcloud.com'
        || host.endsWith('.soundcloud.com')
        || host === 'on.soundcloud.com'
        || host.endsWith('.on.soundcloud.com')
        || host === 'snd.sc'
        || host.endsWith('.snd.sc')
        || host === 'soundcloud.app.goo.gl'
        || host.endsWith('.soundcloud.app.goo.gl');
}

function isSoundCloudShortHost(hostname) {
    const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
    return host === 'on.soundcloud.com'
        || host.endsWith('.on.soundcloud.com')
        || host === 'snd.sc'
        || host.endsWith('.snd.sc')
        || host === 'soundcloud.app.goo.gl'
        || host.endsWith('.soundcloud.app.goo.gl');
}

function mapYtDlpInfo(info, fallbackSource = 'YouTube') {
    if (!info) return null;
    const id = info.id || info.video_id || '';
    const source = info.extractor_key || info.extractor || fallbackSource;
    const artist = info.uploader || info.channel || info.artist || info.creator || fallbackSource;
    const webpageUrl = info.webpage_url || info.original_url || (isDirectSoundCloudTarget(info.url) ? info.url : '');

    return {
        id: id || webpageUrl,
        title: info.title || 'Sem titulo',
        url: webpageUrl || (id ? `https://www.youtube.com/watch?v=${id}` : ''),
        duration: info.duration_string || info.timestamp || formatSecondsLabel(info.duration) || '',
        thumbnail: getBestThumbnail(info),
        artist,
        author: artist,
        source: /soundcloud/i.test(source || webpageUrl) ? 'SoundCloud' : 'YouTube'
    };
}

function formatMillisecondsLabel(ms) {
    return formatSecondsLabel(Math.round((Number(ms) || 0) / 1000));
}

function getBestSoundCloudArtwork(track) {
    const artwork = track?.artwork_url || track?.user?.avatar_url || '';
    return artwork ? String(artwork).replace(/-large\./, '-t500x500.') : '';
}

function mapSoundCloudTrack(track) {
    if (!track || track.kind !== 'track') return null;
    const id = track.id ? `soundcloud:${track.id}` : track.permalink_url;
    const artist = track.user?.username || track.publisher_metadata?.artist || 'SoundCloud';

    return {
        id,
        soundcloudId: track.id || '',
        title: track.title || 'Faixa do SoundCloud',
        url: track.permalink_url || '',
        duration: formatMillisecondsLabel(track.duration),
        thumbnail: getBestSoundCloudArtwork(track),
        artist,
        author: artist,
        source: 'SoundCloud'
    };
}

async function resolveRedirectUrl(input) {
    const raw = extractFirstHttpUrl(input);
    if (!/^https?:\/\//i.test(raw)) return raw;

    try {
        const res = await fetch(raw, {
            method: 'HEAD',
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return res.url || raw;
    } catch {
        const res = await fetch(raw, {
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return res.url || raw;
    }
}

async function resolveSoundCloudUrl(input) {
    const raw = extractFirstHttpUrl(input);
    const parsed = getParsedMediaUrl(raw);
    if (!parsed || !isSoundCloudShortHost(parsed.hostname)) return raw;

    try {
        const resolved = await resolveRedirectUrl(raw);
        return isDirectSoundCloudTarget(resolved) ? resolved : raw;
    } catch (error) {
        console.log('Falha ao resolver link curto do SoundCloud:', error.message);
        return raw;
    }
}

async function getSoundCloudClientId(forceRefresh = false) {
    if (!forceRefresh && soundCloudClientId && Date.now() < soundCloudClientIdExpiresAt) {
        return soundCloudClientId;
    }

    const fallbackClientId = 'IRnK0myxxLJdwXXjybXQo71mXyDGpaM6';

    try {
        const html = await (await fetch('https://soundcloud.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        })).text();
        const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)]
            .map(match => match[1])
            .filter(src => /sndcdn\.com\/assets\//i.test(src))
            .reverse();

        for (const src of scripts.slice(0, 12)) {
            const scriptUrl = src.startsWith('//') ? `https:${src}` : src;
            const js = await (await fetch(scriptUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })).text();
            const match = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9_-]{20,})["']/)
                || js.match(/client_id=([a-zA-Z0-9_-]{20,})/)
                || js.match(/clientId\s*[:=]\s*["']([a-zA-Z0-9_-]{20,})["']/);

            if (match?.[1]) {
                soundCloudClientId = match[1];
                soundCloudClientIdExpiresAt = Date.now() + SOUNDCLOUD_CLIENT_ID_TTL_MS;
                return soundCloudClientId;
            }
        }
    } catch (error) {
        console.log('Falha ao descobrir client_id do SoundCloud:', error.message);
    }

    soundCloudClientId = fallbackClientId;
    soundCloudClientIdExpiresAt = Date.now() + (30 * 60 * 1000);
    return soundCloudClientId;
}

async function fetchSoundCloudApi(pathname, params = {}, retry = true) {
    const clientId = await getSoundCloudClientId(!retry);
    const url = new URL(pathname, 'https://api-v2.soundcloud.com');
    Object.entries({ ...params, client_id: clientId }).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString(), {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    if ((response.status === 401 || response.status === 403) && retry) {
        soundCloudClientId = '';
        soundCloudClientIdExpiresAt = 0;
        return fetchSoundCloudApi(pathname, params, false);
    }

    if (!response.ok) {
        throw new Error(`SoundCloud API HTTP ${response.status}`);
    }

    return response.json();
}

async function resolveSoundCloudResource(input) {
    const resolvedUrl = await resolveSoundCloudUrl(input);
    return fetchSoundCloudApi('/resolve', { url: resolvedUrl });
}

async function searchSoundCloudTracks(query, limit = 6) {
    const data = await fetchSoundCloudApi('/search/tracks', {
        q: String(query || '').trim(),
        limit
    });

    return (data?.collection || [])
        .map(mapSoundCloudTrack)
        .filter(track => track && track.url);
}

async function getSoundCloudTranscodingUrl(transcoding) {
    const clientId = await getSoundCloudClientId();
    const response = await fetch(`${transcoding.url}?client_id=${clientId}`, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data?.url || null;
}

async function isPlayableHlsUrl(url) {
    if (!/\.m3u8/i.test(String(url || ''))) return true;

    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return false;
        const manifest = await response.text();
        return !/METHOD=SAMPLE-AES|KEYFORMAT=/i.test(manifest);
    } catch {
        return false;
    }
}

function scoreSoundCloudTranscoding(transcoding) {
    const protocol = transcoding?.format?.protocol || '';
    const preset = transcoding?.preset || '';
    if (protocol === 'progressive') return 0;
    if (protocol === 'hls' && /^mp3/i.test(preset)) return 1;
    if (protocol === 'hls') return 2;
    return 99;
}

async function getSoundCloudStreamUrl(input) {
    const resource = await resolveSoundCloudResource(input);
    const track = resource?.kind === 'track' ? resource : null;
    if (!track) return null;

    const candidates = (track.media?.transcodings || [])
        .filter(transcoding => transcoding?.url && ['progressive', 'hls'].includes(transcoding?.format?.protocol))
        .sort((a, b) => scoreSoundCloudTranscoding(a) - scoreSoundCloudTranscoding(b));

    for (const transcoding of candidates) {
        const streamUrl = await getSoundCloudTranscodingUrl(transcoding);
        if (streamUrl && await isPlayableHlsUrl(streamUrl)) return streamUrl;
    }

    return null;
}

function mapYtSearchVideo(video) {
    if (!video) return null;
    const id = video.videoId || video.id || getYouTubeVideoId(video.url);
    const url = video.url || (id ? `https://www.youtube.com/watch?v=${id}` : '');
    const author = video.author?.name || video.author || video.channel || 'YouTube';

    return {
        id: id || url,
        videoId: id,
        title: video.title || 'Sem titulo',
        url,
        duration: video.timestamp || video.duration?.timestamp || formatSecondsLabel(video.seconds || video.duration?.seconds),
        thumbnail: video.thumbnail || video.image || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''),
        artist: author,
        author,
        source: 'YouTube'
    };
}

async function searchYouTubeWithYtSearch(query, limit = 10) {
    const results = await ytSearch(query);
    return (results?.videos || [])
        .slice(0, limit)
        .map(mapYtSearchVideo)
        .filter(track => track && track.url);
}

async function fetchYouTubeOEmbedTrack(videoId) {
    if (!videoId) return null;

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`);
    if (!response.ok) return null;

    const data = await response.json();
    return {
        id: videoId,
        videoId,
        title: data?.title || 'Video do YouTube',
        url: videoUrl,
        duration: '',
        thumbnail: data?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        artist: data?.author_name || 'YouTube',
        author: data?.author_name || 'YouTube',
        source: 'YouTube'
    };
}

async function extractYouTubeMetadataWithYtSearch(input) {
    const target = normalizeYouTubeTarget(input);
    const listId = getYouTubeListId(target);
    const videoId = getYouTubeVideoId(target);

    if (listId) {
        try {
            const playlist = await ytSearch({ listId });
            const tracks = (playlist?.videos || [])
                .map(mapYtSearchVideo)
                .filter(track => track && track.url);

            if (tracks.length > 0) {
                return {
                    title: playlist?.title || 'Playlist do YouTube',
                    tracks: tracks.slice(0, 200),
                    source: 'YouTube',
                    isCollection: true
                };
            }
        } catch (playlistError) {
            console.log('yt-search playlist/mix falhou:', playlistError.message);
        }
    }

    if (videoId) {
        let track = null;

        try {
            const video = await ytSearch({ videoId });
            track = mapYtSearchVideo({
                ...video,
                videoId,
                url: video?.url || `https://www.youtube.com/watch?v=${videoId}`
            });
        } catch (videoError) {
            console.log('yt-search video falhou:', videoError.message);
        }

        if (!track?.url) {
            try {
                track = await fetchYouTubeOEmbedTrack(videoId);
            } catch (oembedError) {
                console.log('YouTube oEmbed falhou:', oembedError.message);
            }
        }

        if (track?.url) {
            return {
                title: track.title,
                tracks: [track],
                source: 'YouTube',
                isCollection: false
            };
        }
    }

    return null;
}

async function extractSoundCloudTracks(url) {
    const target = await resolveSoundCloudUrl(url);

    try {
        const resource = await resolveSoundCloudResource(target);
        const collectionTracks = Array.isArray(resource?.tracks) ? resource.tracks : [];
        const tracks = (resource?.kind === 'track' ? [resource] : collectionTracks)
            .map(mapSoundCloudTrack)
            .filter(track => track && track.url);

        if (tracks.length > 0) {
            return {
                title: resource?.title || (tracks.length > 1 ? 'Playlist do SoundCloud' : 'SoundCloud'),
                tracks,
                source: 'SoundCloud',
                isCollection: tracks.length > 1 || resource?.kind === 'playlist' || resource?.kind === 'system-playlist'
            };
        }
    } catch (apiError) {
        console.log('SoundCloud API falhou, tentando yt-dlp:', apiError.message);
    }

    let output = null;
    try {
        output = await ytDlp(target, {
            dumpSingleJson: true,
            noWarnings: true,
            ignoreErrors: true
        });
    } catch (error) {
        console.log('yt-dlp falhou ao importar SoundCloud:', error.message);
        return {
            title: 'SoundCloud',
            tracks: [],
            source: 'SoundCloud',
            isCollection: false
        };
    }

    const entries = Array.isArray(output?.entries) && output.entries.length > 0 ? output.entries.filter(Boolean) : [output].filter(Boolean);
    const tracks = entries
        .map(entry => mapYtDlpInfo({
            ...entry,
            extractor_key: entry?.extractor_key || output?.extractor_key || 'SoundCloud'
        }, 'SoundCloud'))
        .filter(track => track && track.url);

    return {
        title: output?.title || 'SoundCloud',
        tracks,
        source: 'SoundCloud',
        isCollection: tracks.length > 1
    };
}

function isYouTubeCollectionTarget(input) {
    const parsed = getParsedMediaUrl(input);
    if (!parsed || !isYouTubeHost(parsed.hostname)) return false;
    return Boolean(parsed.searchParams.get('list'))
        || /^\/playlist\/?$/i.test(parsed.pathname)
        || /^\/mix\/?$/i.test(parsed.pathname);
}

async function extractYouTubeTracks(input) {
    const target = normalizeYouTubeTarget(input);
    const isCollection = isYouTubeCollectionTarget(target);
    try {
        const metadataOnly = await extractYouTubeMetadataWithYtSearch(target);
        if (metadataOnly?.tracks?.length) return metadataOnly;
    } catch (metadataError) {
        console.log('yt-search por ID/lista falhou, tentando yt-dlp:', metadataError.message);
    }

    const options = {
        dumpSingleJson: true,
        noWarnings: true,
        ignoreErrors: true,
        extractorArgs: 'youtube:player_client=tv,web'
    };

    if (isCollection) {
        options.flatPlaylist = true;
        options.playlistEnd = 200;
    } else {
        options.noPlaylist = true;
    }

    let output = null;
    try {
        output = await ytDlp(target, options);
    } catch (error) {
        console.log('yt-dlp falhou ao importar YouTube:', error.message);
        return {
            title: isCollection ? 'Playlist do YouTube' : 'YouTube',
            tracks: [],
            source: 'YouTube',
            isCollection
        };
    }

    const entries = Array.isArray(output?.entries) && output.entries.length > 0 ? output.entries : [output];
    const tracks = entries
        .map(entry => mapYtDlpInfo({
            ...entry,
            extractor_key: entry?.extractor_key || output?.extractor_key || 'YouTube'
        }, 'YouTube'))
        .filter(track => track && (track.url || track.id));

    return {
        title: output?.title || (isCollection ? 'Playlist do YouTube' : 'YouTube'),
        tracks,
        source: 'YouTube',
        isCollection: isCollection || tracks.length > 1
    };
}

async function searchWithYtDlp(query, limit = 10) {
    const output = await ytDlp(`ytsearch${limit}:${query}`, {
        dumpSingleJson: true,
        noWarnings: true,
        flatPlaylist: true,
        ignoreErrors: true,
        extractorArgs: 'youtube:player_client=tv,web'
    });

    const entries = Array.isArray(output?.entries) ? output.entries.filter(Boolean) : [output].filter(Boolean);
    return entries.map(mapYtDlpInfo).filter(track => track && track.id);
}

function getFormatForQuality(quality = 'audio') {
    if (quality === 'audio') {
        return 'bestaudio[ext=m4a]/bestaudio/best';
    }

    const heightMap = {
        video: 720,
        '360p': 360,
        '720p': 720,
        '1080p': 1080,
        '1440p': 1440,
        best: 2160
    };
    const height = heightMap[quality] || 720;

    return [
        `best[height<=${height}][vcodec!=none][acodec!=none][ext=mp4]`,
        `best[height<=${height}][vcodec!=none][acodec!=none]`,
        '22',
        '18',
        'best[vcodec!=none][acodec!=none]',
        'best'
    ].join('/');
}

function getMaxHeightForQuality(quality = 'audio') {
    const heightMap = {
        video: 720,
        '360p': 360,
        '720p': 720,
        '1080p': 1080,
        '1440p': 1440,
        best: 2160
    };

    return heightMap[quality] || null;
}

function pickPlayableUrl(output, wantsVideo, maxHeight = null) {
    if (!output) return null;

    const hasPlayableVideo = output.vcodec && output.vcodec !== 'none' && output.acodec && output.acodec !== 'none';
    if (output.url && (!wantsVideo || hasPlayableVideo)) return output.url;

    const formats = Array.isArray(output.formats) ? output.formats : [];
    const playable = formats
        .filter(format => {
            if (!format.url) return false;
            if (wantsVideo) {
                const withinHeight = !maxHeight || !format.height || format.height <= maxHeight;
                return withinHeight && format.vcodec && format.vcodec !== 'none' && format.acodec && format.acodec !== 'none';
            }
            return format.acodec && format.acodec !== 'none';
        })
        .sort((a, b) => {
            const aScore = (a.height || 0) * 100000 + (a.abr || a.tbr || 0);
            const bScore = (b.height || 0) * 100000 + (b.abr || b.tbr || 0);
            return bScore - aScore;
        });

    return playable[0]?.url || null;
}

function getExtractorAttempts() {
    return [
        { extractorArgs: 'youtube:player_client=android_vr,web' },
        { extractorArgs: 'youtube:player_client=android,web' },
        { extractorArgs: 'youtube:player_client=tv,web' },
        { extractorArgs: 'youtube:player_client=ios,web' }
    ];
}

function getStreamCacheKey(target, quality) {
    return `${target}::${quality || 'audio'}`;
}

function readCachedStreamUrl(key) {
    const cached = streamUrlCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > STREAM_CACHE_TTL_MS) {
        streamUrlCache.delete(key);
        return null;
    }
    return cached.url;
}

function writeCachedStreamUrl(key, url) {
    if (url) streamUrlCache.set(key, { url, createdAt: Date.now() });
}

function shouldProxyStreamUrl(url) {
    const value = String(url || '').trim();
    if (!/^https?:\/\//i.test(value)) return false;

    try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        if (host === '127.0.0.1' || host === 'localhost') return false;
    } catch {
        return false;
    }

    return !/\.m3u8(?:$|[?#])/i.test(value);
}

function cleanupStreamProxyEntries() {
    const now = Date.now();
    for (const [token, entry] of streamProxyEntries) {
        if (!entry || now - entry.createdAt > STREAM_PROXY_TTL_MS) {
            streamProxyEntries.delete(token);
        }
    }
}

function createStreamProxyUrl(upstreamUrl, target = '', quality = 'audio') {
    if (!shouldProxyStreamUrl(upstreamUrl) || !controlServerInfo.url) return upstreamUrl;

    cleanupStreamProxyEntries();
    const token = crypto.randomBytes(18).toString('hex');
    streamProxyEntries.set(token, {
        url: upstreamUrl,
        target: String(target || '').slice(0, 360),
        quality: String(quality || 'audio').slice(0, 32),
        createdAt: Date.now()
    });

    return `${controlServerInfo.url}/stream/${token}`;
}

function setStreamProxyCorsHeaders(res) {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Content-Type',
        'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Encoding, Content-Length, Content-Range, Content-Type',
        'Cross-Origin-Resource-Policy': 'cross-origin'
    });
}

async function handleStreamProxyRequest(req, res) {
    setStreamProxyCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    cleanupStreamProxyEntries();
    const entry = streamProxyEntries.get(req.params.token);
    if (!entry) {
        res.status(410).send('Fluxo stream expirado. Tente tocar a musica de novo.');
        return;
    }

    const upstreamHeaders = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': req.headers.accept || '*/*'
    };
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    try {
        const upstream = await fetch(entry.url, {
            method: req.method === 'HEAD' ? 'HEAD' : 'GET',
            redirect: 'follow',
            headers: upstreamHeaders
        });

        res.status(upstream.status);
        const passthroughHeaders = [
            'accept-ranges',
            'content-encoding',
            'content-length',
            'content-range',
            'content-type',
            'last-modified'
        ];
        passthroughHeaders.forEach(name => {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
        });
        res.setHeader('Cache-Control', 'private, max-age=240');

        if (req.method === 'HEAD') {
            res.end();
            return;
        }

        if (!upstream.ok && upstream.status !== 206) {
            const body = await upstream.text().catch(() => '');
            res.send(body || `Falha no upstream do stream (${upstream.status}).`);
            return;
        }

        if (!upstream.body) {
            res.end();
            return;
        }

        Readable.fromWeb(upstream.body).on('error', error => {
            console.log('Fluxo stream proxy falhou:', error.message);
            if (!res.headersSent) res.status(502);
            res.end();
        }).pipe(res);
    } catch (error) {
        console.log('Fluxo stream proxy upstream falhou:', error.message);
        if (!res.headersSent) {
            res.status(502).send('Falha ao abrir stream no proxy local.');
        } else {
            res.end();
        }
    }
}

function extractFirstUrl(output) {
    return String(output || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => /^https?:\/\//i.test(line)) || null;
}

async function getStreamUrlFast(target, quality, format) {
    for (const attempt of getExtractorAttempts()) {
        try {
            const output = await ytDlp(target, {
                getUrl: true,
                noWarnings: true,
                noPlaylist: true,
                format,
                ...attempt
            });

            const streamUrl = extractFirstUrl(output);
            if (streamUrl) return streamUrl;
        } catch (error) {
            console.log(`Extração rápida falhou (${quality}):`, error.message);
        }
    }

    return null;
}

async function getStreamUrlWithMetadata(target, quality, format, wantsVideo, maxHeight) {
    for (const attempt of getExtractorAttempts()) {
        try {
            const output = await ytDlp(target, {
                dumpSingleJson: true,
                noWarnings: true,
                noPlaylist: true,
                format,
                ...attempt
            });

            const streamUrl = pickPlayableUrl(output, wantsVideo, maxHeight);
            if (streamUrl) return streamUrl;
        } catch (error) {
            console.log(`Falha ao obter stream (${quality}):`, error.message);
        }
    }

    return null;
}

async function ytDlpWithExtractorFallback(target, options, label = 'yt-dlp') {
    let lastError = null;

    for (const attempt of getExtractorAttempts()) {
        try {
            return await ytDlp(target, {
                ...options,
                ...attempt
            });
        } catch (error) {
            lastError = error;
            console.log(`${label} falhou (${attempt.extractorArgs}):`, error.message);
        }
    }

    throw lastError || new Error(`${label} falhou em todos os extractors.`);
}

function stripYtSearchPrefix(target) {
    const match = String(target || '').match(/^ytsearch\d*:(.+)$/i);
    return match ? match[1].trim() : '';
}

function normalizeLookupText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getTrackSearchTextFromPayload(payload, primaryTarget = '') {
    if (!payload || typeof payload === 'string') {
        return stripYtSearchPrefix(primaryTarget || payload);
    }

    const title = String(payload.title || payload.name || payload.query || '').trim();
    const query = String(payload.query || '').trim();
    const artistRaw = String(payload.artist || payload.author || payload.channel || payload.uploader || '').trim();
    const artist = /^(desconhecido|youtube|soundcloud|importado do spotify)$/i.test(artistRaw) ? '' : artistRaw;

    if (query && query !== title) return query;
    if (title && artist && !normalizeLookupText(title).includes(normalizeLookupText(artist))) {
        return `${artist} ${title}`.replace(/\s+/g, ' ').trim();
    }
    return title || query || stripYtSearchPrefix(primaryTarget);
}

function addUniqueStreamCandidate(candidates, target, source = 'candidate') {
    const normalized = normalizeYouTubeTarget(target);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (candidates.some(candidate => candidate.key === key)) return;
    candidates.push({ key, target: normalized, source });
}

async function buildSearchStreamCandidates(searchText, limit = 8) {
    const candidates = [];
    const clean = String(searchText || '').replace(/\s+/g, ' ').trim();
    if (!clean) return candidates;

    try {
        const ytSearchTracks = await searchYouTubeWithYtSearch(clean, limit);
        ytSearchTracks.forEach(track => addUniqueStreamCandidate(candidates, track.url || track.videoId || track.id, 'yt-search'));
    } catch (error) {
        console.log('Candidatos via yt-search falharam:', error.message);
    }

    try {
        const ytDlpTracks = await searchWithYtDlp(clean, limit);
        ytDlpTracks.forEach(track => addUniqueStreamCandidate(candidates, track.url || track.videoId || track.id, 'yt-dlp-search'));
    } catch (error) {
        console.log('Candidatos via yt-dlp search falharam:', error.message);
    }

    return candidates;
}

async function getDirectStreamUrl(target, quality = 'audio') {
    if (!target) return null;

    const normalizedTarget = normalizeYouTubeTarget(target);
    if (!normalizedTarget) return null;

    if (isDirectSoundCloudTarget(normalizedTarget)) {
        const soundCloudCacheKey = getStreamCacheKey(await resolveSoundCloudUrl(normalizedTarget), 'soundcloud');
        const cachedSoundCloudUrl = readCachedStreamUrl(soundCloudCacheKey);
        if (cachedSoundCloudUrl) return cachedSoundCloudUrl;

        const soundCloudUrl = await getSoundCloudStreamUrl(normalizedTarget);
        if (soundCloudUrl) {
            writeCachedStreamUrl(soundCloudCacheKey, soundCloudUrl);
            return soundCloudUrl;
        }
    }

    const wantsVideo = quality !== 'audio';
    const format = getFormatForQuality(quality);
    const maxHeight = getMaxHeightForQuality(quality);
    const cacheKey = getStreamCacheKey(normalizedTarget, quality);
    const cachedUrl = readCachedStreamUrl(cacheKey);
    if (cachedUrl) return cachedUrl;

    if (streamUrlInflight.has(cacheKey)) {
        return streamUrlInflight.get(cacheKey);
    }

    const inflight = (async () => {
        const fastUrl = await getStreamUrlFast(normalizedTarget, quality, format);
        if (fastUrl) return fastUrl;

        return getStreamUrlWithMetadata(normalizedTarget, quality, format, wantsVideo, maxHeight);
    })();

    streamUrlInflight.set(cacheKey, inflight);

    try {
        const streamUrl = await inflight;
        writeCachedStreamUrl(cacheKey, streamUrl);
        return streamUrl;
    } finally {
        streamUrlInflight.delete(cacheKey);
    }
}

async function resolveTrackStreamUrl(payload, quality = 'audio') {
    const primaryTarget = typeof payload === 'string'
        ? normalizeYouTubeTarget(payload)
        : getTrackTargetFromPayload(payload);
    if (!primaryTarget) return null;

    let directUrl = null;
    try {
        directUrl = await getDirectStreamUrl(primaryTarget, quality);
    } catch (error) {
        console.log('Stream direto falhou, tentando candidatos:', error.message);
    }
    if (directUrl) {
        return {
            url: createStreamProxyUrl(directUrl, primaryTarget, quality),
            upstreamUrl: directUrl,
            target: primaryTarget,
            source: 'direct',
            quality
        };
    }

    const searchText = getTrackSearchTextFromPayload(payload, primaryTarget);
    if (!searchText) return null;

    const candidates = await buildSearchStreamCandidates(searchText, 8);
    for (const candidate of candidates) {
        if (candidate.target.toLowerCase() === String(primaryTarget).toLowerCase()) continue;
        try {
            const url = await getDirectStreamUrl(candidate.target, quality);
            if (url) {
                return {
                    url: createStreamProxyUrl(url, candidate.target, quality),
                    upstreamUrl: url,
                    target: candidate.target,
                    source: candidate.source,
                    quality
                };
            }
        } catch (error) {
            console.log(`Candidato de stream falhou (${candidate.source}):`, error.message);
        }
    }

    return null;
}

async function resolveSpotifyUrl(input) {
    const raw = String(input || '').trim();
    if (!/spotify\.link/i.test(raw)) return raw;

    try {
        const res = await fetch(raw, { method: 'HEAD', redirect: 'follow' });
        return res.url || raw;
    } catch {
        const res = await fetch(raw, { redirect: 'follow' });
        return res.url || raw;
    }
}

function setupAutoUpdater() {
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', () => {
        if (mainWindow) mainWindow.webContents.send('update-message', 'NOVA ATUALIZAÇÃO ENCONTRADA. INICIANDO DOWNLOAD...');
    });

    autoUpdater.on('download-progress', (progressObj) => {
        if (mainWindow) mainWindow.webContents.send('update-progress', progressObj.percent);
    });

    autoUpdater.on('update-downloaded', () => {
        if (mainWindow) mainWindow.webContents.send('update-message', 'DOWNLOAD CONCLUÍDO! REINICIANDO O SISTEMA...');
        setTimeout(() => autoUpdater.quitAndInstall(), 3000);
    });

    autoUpdater.on('error', (err) => {
        console.log('Erro detalhado do Update:', err);
    });

    setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 3000);
}

function getPluginsDir() {
    return path.join(app.getPath('userData'), 'plugins');
}

async function ensurePluginStarterFile() {
    const pluginsDir = getPluginsDir();
    await fs.promises.mkdir(pluginsDir, { recursive: true });
    const starterPath = path.join(pluginsDir, 'fluxo-starter.json');

    if (fs.existsSync(starterPath)) return;

    const starterPlugin = {
        id: 'fluxo-starter',
        name: 'Fluxo Starter Commands',
        description: 'Exemplos seguros da Plugin API: comandos declarativos que o Fluxo executa sem rodar codigo externo.',
        version: '1.0.0',
        commands: [
            { id: 'search-lofi', label: 'Buscar lo-fi', action: { type: 'search', query: 'lofi hip hop radio study' } },
            { id: 'theme-matrix', label: 'Tema Matrix', action: { type: 'theme', value: 'matrix' } },
            { id: 'eq-podcast', label: 'EQ Podcast', action: { type: 'eq', value: 'vocal' } }
        ]
    };

    await fs.promises.writeFile(starterPath, JSON.stringify(starterPlugin, null, 2), 'utf8');
}

async function scanFluxoPlugins() {
    await ensurePluginStarterFile();
    const pluginsDir = getPluginsDir();
    const files = await fs.promises.readdir(pluginsDir).catch(() => []);
    const plugins = [];

    for (const file of files.filter(name => name.toLowerCase().endsWith('.json'))) {
        const filePath = path.join(pluginsDir, file);
        try {
            const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
            const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
            plugins.push({
                id: String(parsed.id || path.basename(file, '.json')).slice(0, 80),
                name: String(parsed.name || parsed.id || file).slice(0, 120),
                description: String(parsed.description || '').slice(0, 240),
                version: String(parsed.version || '0.0.0').slice(0, 32),
                file,
                path: filePath,
                commands: commands
                    .filter(command => command && command.action)
                    .map(command => ({
                        id: String(command.id || command.label || 'command').slice(0, 80),
                        label: String(command.label || command.id || 'Comando').slice(0, 120),
                        action: command.action
                    }))
                    .slice(0, 24)
            });
        } catch (error) {
            plugins.push({
                id: path.basename(file, '.json'),
                name: file,
                description: `Plugin invalido: ${error.message}`,
                version: 'erro',
                file,
                path: filePath,
                commands: [],
                error: error.message
            });
        }
    }

    return { directory: pluginsDir, plugins };
}

function sendRemoteControlAction(action, payload = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.webContents.send('remote-control-action', {
        action: String(action || '').trim(),
        payload: payload || {},
        receivedAt: Date.now()
    });
    return true;
}

function startControlServer(port = 38995, attempts = 8) {
    if (controlServer) return Promise.resolve(controlServerInfo);
    if (controlServerStartup) return controlServerStartup;

    const remoteApp = express();
    remoteApp.use(express.json({ limit: '256kb' }));

    remoteApp.get('/', (req, res) => {
        res.json({
            app: 'Fluxo Music',
            version: app.getVersion(),
            status: 'online',
            endpoints: ['/status', '/streamdeck', '/action/:action', '/plugins']
        });
    });

    remoteApp.get('/status', (req, res) => {
        res.json({
            nowPlaying: lastNowPlayingPayload || null,
            discord: discordStatus,
            server: controlServerInfo
        });
    });

    remoteApp.all('/stream/:token', (req, res) => {
        handleStreamProxyRequest(req, res);
    });

    remoteApp.all('/action/:action', (req, res) => {
        const ok = sendRemoteControlAction(req.params.action, { ...req.query, ...(req.body || {}) });
        res.json({ ok, action: req.params.action });
    });

    remoteApp.get('/plugins', async (req, res) => {
        res.json(await scanFluxoPlugins());
    });

    remoteApp.get('/streamdeck', (req, res) => {
        const base = controlServerInfo.url || `http://127.0.0.1:${port}`;
        res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Fluxo Stream Deck</title>
<style>body{font-family:Segoe UI,Arial;background:#07080d;color:#f4f7fb;padding:22px}a{display:inline-block;margin:8px;padding:12px 16px;border:1px solid #00ffcc;color:#00ffcc;text-decoration:none;border-radius:8px}code{color:#ff4f8b}</style></head>
<body><h2>Fluxo Music - Stream Deck Bridge</h2>
<p>Use a acao <code>Open URL</code> do Stream Deck apontando para estes links locais.</p>
${['play-pause','next','prev','vol-up','vol-down','toggle-video','fullscreen','party','mini','focus','ambient'].map(action => `<a href="${base}/action/${action}">${action}</a>`).join('')}
</body></html>`);
    });

    controlServerStartup = new Promise(resolve => {
        const tryListen = (nextPort, remaining) => {
            const server = remoteApp.listen(nextPort, '127.0.0.1', () => {
                controlServer = server;
                controlServerInfo = {
                    enabled: true,
                    host: '127.0.0.1',
                    port: nextPort,
                    url: `http://127.0.0.1:${nextPort}`,
                    lastError: ''
                };
                console.log(`Fluxo control server ativo em ${controlServerInfo.url}`);
                resolve(controlServerInfo);
            });

            server.on('error', error => {
                if (error.code === 'EADDRINUSE' && remaining > 0) {
                    tryListen(nextPort + 1, remaining - 1);
                    return;
                }
                controlServerInfo = {
                    ...controlServerInfo,
                    enabled: false,
                    port: null,
                    url: '',
                    lastError: error.message
                };
                console.log('Fluxo control server falhou:', error.message);
                resolve(controlServerInfo);
            });
        };

        tryListen(port, attempts);
    });

    return controlServerStartup;
}

async function timedFetch(url, timeoutMs = 6500) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal
        });
        return {
            url,
            ok: response.ok || response.status < 500,
            status: response.status,
            ms: Date.now() - startedAt
        };
    } catch (error) {
        return {
            url,
            ok: false,
            status: 0,
            ms: Date.now() - startedAt,
            error: error.name === 'AbortError' ? 'timeout' : error.message
        };
    } finally {
        clearTimeout(timer);
    }
}

function getDiscordClient() {
    if (!DiscordRPC || !discordClientId) {
        setDiscordStatus({
            state: 'unavailable',
            lastError: !DiscordRPC ? 'Pacote discord-rpc indisponivel.' : 'Discord Client ID vazio.'
        });
        return null;
    }

    if (!discordClient) {
        DiscordRPC.register(discordClientId);
        discordClient = new DiscordRPC.Client({ transport: 'ipc' });
        discordClient.on('disconnected', () => {
            discordLoginPromise = null;
            discordReady = false;
            setDiscordStatus({ state: 'disconnected', lastError: 'Discord IPC desconectado.' });
        });
        discordClient.on('error', (error) => {
            console.log('Discord RPC erro:', error.message);
            discordReady = false;
            setDiscordStatus({ state: 'error', lastError: error.message });
        });
    }

    return discordClient;
}

async function destroyDiscordClient(reason = '') {
    const client = discordClient;
    discordClient = null;
    discordLoginPromise = null;
    discordReady = false;

    if (!client) return;

    try {
        client.removeAllListeners();
    } catch (_) {}

    try {
        await client.destroy();
    } catch (error) {
        if (reason) console.log(`Discord RPC destroy apos ${reason} falhou:`, error.message);
    }
}

function scheduleDiscordPresenceRetry(delayMs = 7000) {
    if (discordRetryTimer || !lastDiscordPresenceRequest) return;

    discordRetryTimer = setTimeout(() => {
        discordRetryTimer = null;
        if (!lastDiscordPresenceRequest) return;
        updateDiscordPresence(lastDiscordPresenceRequest.track, lastDiscordPresenceRequest.state)
            .catch(error => console.log('Discord RPC retry falhou:', error.message));
    }, delayMs);

    discordRetryTimer.unref?.();
}

async function ensureDiscordReady() {
    const client = getDiscordClient();
    if (!client) return null;
    if (discordReady || client.user) return client;

    if (!discordLoginPromise) {
        setDiscordStatus({ state: 'connecting', lastError: '' });
        discordLoginPromise = client.login({ clientId: discordClientId })
            .then(() => {
                discordReady = true;
                setDiscordStatus({ state: 'connected', lastError: '' });
                return client;
            })
            .catch(async (error) => {
                console.log('Discord RPC login falhou:', error.message);
                await destroyDiscordClient('falha de login');
                setDiscordStatus({
                    state: 'error',
                    lastError: `${error.message}. Abra o Discord desktop e use RESET RPC antes de testar de novo.`
                });
                return null;
            });
    }

    const readyClient = await discordLoginPromise;
    return readyClient || null;
}

function trimPresenceText(value, fallback) {
    const text = String(value || fallback || '').trim();
    return (text || fallback || 'Fluxo Music').slice(0, 128);
}

function normalizePresenceUrl(value) {
    const text = String(value || '').trim();
    return /^https?:\/\//i.test(text) ? text : '';
}

function normalizeYouTubePresenceUrl(value) {
    const url = normalizePresenceUrl(value);
    if (!url) return '';

    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')
            ? url
            : '';
    } catch (_) {
        return '';
    }
}

function toDiscordTimestamp(value) {
    const timestamp = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 2147483647000) return undefined;
    return Math.round(timestamp);
}

function buildDiscordListeningActivity(activity) {
    const start = toDiscordTimestamp(activity.startTimestamp);
    const end = toDiscordTimestamp(activity.endTimestamp);
    const timestamps = {};
    const assets = {};

    if (start) timestamps.start = start;
    if (end) timestamps.end = end;
    if (activity.largeImageKey) assets.large_image = activity.largeImageKey;
    if (activity.largeImageKey && activity.largeImageText) assets.large_text = activity.largeImageText;
    if (activity.smallImageKey) assets.small_image = activity.smallImageKey;
    if (activity.smallImageKey && activity.smallImageText) assets.small_text = activity.smallImageText;

    return {
        type: 2,
        name: 'Fluxo Music',
        details: activity.details,
        state: activity.state,
        timestamps: Object.keys(timestamps).length ? timestamps : undefined,
        assets: Object.keys(assets).length ? assets : undefined,
        buttons: Array.isArray(activity.buttons) && activity.buttons.length ? activity.buttons : undefined,
        instance: false
    };
}

async function sendDiscordActivity(client, activity) {
    let rawError = null;
    const hasButtons = Array.isArray(activity.buttons) && activity.buttons.length > 0;
    const hasCover = Boolean(activity.largeImageKey);

    const withoutButtons = (candidate) => {
        const next = { ...candidate };
        delete next.buttons;
        return next;
    };

    const withoutCover = (candidate) => {
        const next = { ...candidate };
        delete next.largeImageKey;
        delete next.largeImageText;
        return next;
    };

    const sendListening = async (candidate) => {
        await client.request('SET_ACTIVITY', {
            pid: process.pid,
            activity: buildDiscordListeningActivity(candidate)
        });
    };

    const listeningAttempts = [
        {
            activity,
            payloadMode: hasButtons ? 'ouvindo / YouTube' : 'ouvindo / sem botoes',
            warning: '',
            buttonsAccepted: hasButtons
        }
    ];

    if (hasCover) {
        listeningAttempts.push({
            activity: withoutCover(activity),
            payloadMode: hasButtons ? 'ouvindo / YouTube sem thumb' : 'ouvindo / sem thumb',
            warning: hasButtons
                ? 'Thumbnail externa rejeitada pelo Discord; atividade enviada com botao do YouTube e sem capa.'
                : 'Thumbnail externa rejeitada pelo Discord; atividade enviada como Ouvindo sem capa.',
            buttonsAccepted: hasButtons
        });
    }

    if (hasButtons) {
        listeningAttempts.push({
            activity: withoutButtons(activity),
            payloadMode: hasCover ? 'ouvindo / sem botao' : 'ouvindo / sem botoes',
            warning: 'Botao do YouTube rejeitado pelo Discord; atividade enviada sem botao.',
            buttonsAccepted: false
        });

        if (hasCover) {
            listeningAttempts.push({
                activity: withoutButtons(withoutCover(activity)),
                payloadMode: 'ouvindo / sem botao sem thumb',
                warning: 'Botao e thumbnail foram rejeitados pelo Discord; atividade enviada sem ambos.',
                buttonsAccepted: false
            });
        }
    }

    for (const attempt of listeningAttempts) {
        try {
            await sendListening(attempt.activity);
            return {
                payloadMode: attempt.payloadMode,
                warning: attempt.warning,
                buttonsSent: hasButtons,
                buttonsAccepted: attempt.buttonsAccepted,
                lastButtons: attempt.buttonsAccepted ? activity.buttons : []
            };
        } catch (error) {
            rawError = error;
        }
    }

    const fallback = { ...activity };
    if (!fallback.smallImageKey) delete fallback.smallImageText;

    try {
        await client.setActivity(fallback, process.pid);
        return {
            payloadMode: hasButtons ? 'playing fallback / YouTube' : 'playing fallback',
            warning: rawError
                ? `Modo Ouvindo rejeitado (${rawError.message}); usando fallback Playing.`
                : '',
            buttonsSent: hasButtons,
            buttonsAccepted: hasButtons,
            lastButtons: hasButtons ? activity.buttons : []
        };
    } catch (fallbackError) {
        rawError = fallbackError;
        if (fallback.buttons) delete fallback.buttons;

        try {
            await client.setActivity(fallback, process.pid);
            return {
                payloadMode: hasCover ? 'playing fallback / sem botao' : 'playing fallback / sem botoes',
                warning: 'Botao do YouTube rejeitado no fallback; atividade enviada sem botao.',
                buttonsSent: hasButtons,
                buttonsAccepted: false,
                lastButtons: []
            };
        } catch (noButtonError) {
            rawError = noButtonError;
        }

        if (!fallback.largeImageKey) throw rawError;

        delete fallback.largeImageKey;
        delete fallback.largeImageText;
        await client.setActivity(fallback, process.pid);
        return {
            payloadMode: 'playing fallback sem thumb',
            warning: 'Modo Ouvindo, botao e thumbnail foram rejeitados; atividade enviada sem capa.',
            buttonsSent: hasButtons,
            buttonsAccepted: false,
            lastButtons: []
        };
    }
}

async function updateDiscordPresence(track, state = 'playing') {
    if (!track) return;
    lastDiscordPresenceRequest = { track, state };
    const client = await ensureDiscordReady();
    if (!client) {
        scheduleDiscordPresenceRetry();
        return;
    }

    const isPaused = state === 'paused';
    const title = trimPresenceText(track.title, 'Faixa desconhecida');
    const artist = trimPresenceText(track.artist || track.author, 'Artista desconhecido');
    const coverUrl = normalizePresenceUrl(track.thumbnail || track.image);
    const youtubeUrl = normalizeYouTubePresenceUrl(track.youtubeUrl || track.url);
    const startedAt = Number(track.startedAt);
    const endsAt = Number(track.endsAt || track.endTimestamp);
    const progressText = String(track.progressText || '').trim().slice(0, 64);
    const buttons = youtubeUrl ? [{ label: 'Ouvir no YouTube', url: youtubeUrl }] : [];
    const activity = {
        details: trimPresenceText(isPaused ? `Pausado: ${title}` : title, 'Fluxo Music'),
        state: trimPresenceText(progressText ? `${progressText} - ${artist}` : artist, artist),
        largeImageText: trimPresenceText(progressText ? `${title} - ${progressText}` : artist, artist),
        smallImageText: isPaused ? 'Pausado' : 'Tocando',
        instance: false
    };

    if (coverUrl) {
        activity.largeImageKey = coverUrl;
    }

    if (buttons.length) {
        activity.buttons = buttons;
    }

    setDiscordStatus({
        state: 'updating',
        lastError: '',
        buttonsSent: Boolean(buttons.length),
        buttonsAccepted: false,
        lastButtons: buttons,
        payloadMode: buttons.length ? 'ouvindo / YouTube' : 'ouvindo / sem botoes'
    });

    if (!isPaused) {
        activity.startTimestamp = new Date(Number.isFinite(startedAt) ? startedAt : Date.now());
        if (Number.isFinite(endsAt) && endsAt > Date.now()) {
            activity.endTimestamp = new Date(endsAt);
        }
    }

    try {
        const result = await sendDiscordActivity(client, activity);
        setDiscordStatus({
            state: 'active',
            lastError: result.warning || '',
            buttonsSent: Boolean(result.buttonsSent),
            buttonsAccepted: Boolean(result.buttonsAccepted),
            lastButtons: result.lastButtons || [],
            payloadMode: result.payloadMode
        });
    } catch (error) {
        console.log('Discord RPC setActivity falhou:', error.message);
        if (/connection|closed|ipc|socket|pipe/i.test(error.message || '')) {
            await destroyDiscordClient('falha ao enviar atividade');
            scheduleDiscordPresenceRetry();
        }
        setDiscordStatus({ state: 'error', lastError: error.message });
    }
}

async function clearDiscordPresence() {
    lastDiscordPresenceRequest = null;
    if (discordRetryTimer) {
        clearTimeout(discordRetryTimer);
        discordRetryTimer = null;
    }
    const client = await ensureDiscordReady();
    if (!client) return;
    try {
        await client.clearActivity(process.pid);
        setDiscordStatus({
            state: 'connected',
            lastError: '',
            buttonsSent: false,
            buttonsAccepted: false,
            lastButtons: [],
            payloadMode: 'sem botoes'
        });
    } catch (error) {
        console.log('Discord RPC clearActivity falhou:', error.message);
        setDiscordStatus({ state: 'error', lastError: error.message });
    }
}

async function resetDiscordPresenceClient() {
    lastDiscordPresenceRequest = null;
    if (discordRetryTimer) {
        clearTimeout(discordRetryTimer);
        discordRetryTimer = null;
    }
    const client = discordClient;
    const wasReady = discordReady;
    discordClient = null;
    discordLoginPromise = null;
    discordReady = false;

    if (client) {
        try {
            if (client.user || wasReady) await client.clearActivity(process.pid);
        } catch (error) {
            console.log('Discord RPC clear antes do reset falhou:', error.message);
        }

        try {
            client.removeAllListeners();
        } catch (_) {}

        try {
            client.destroy();
        } catch (error) {
            console.log('Discord RPC destroy falhou:', error.message);
        }
    }

    setDiscordStatus({
        state: DiscordRPC ? 'idle' : 'unavailable',
        lastError: DiscordRPC ? '' : 'Pacote discord-rpc indisponivel.',
        buttonsSent: false,
        buttonsAccepted: false,
        lastButtons: [],
        payloadMode: 'sem botoes'
    });
}

const WINDOW_CORNER_RADIUS = 18;

function buildRoundedWindowShape(width, height, radius = WINDOW_CORNER_RADIUS) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const corner = Math.min(
        Math.max(0, Math.floor(radius)),
        Math.floor(safeWidth / 2),
        Math.floor(safeHeight / 2)
    );

    if (!corner) {
        return [{ x: 0, y: 0, width: safeWidth, height: safeHeight }];
    }

    const rects = [];
    const middleHeight = safeHeight - (corner * 2);

    if (middleHeight > 0) {
        rects.push({ x: 0, y: corner, width: safeWidth, height: middleHeight });
    }

    for (let y = 0; y < corner; y += 1) {
        const dy = corner - y - 0.5;
        const inset = Math.ceil(corner - Math.sqrt(Math.max(0, (corner * corner) - (dy * dy))));
        const rowWidth = safeWidth - (inset * 2);

        if (rowWidth > 0) {
            rects.push({ x: inset, y, width: rowWidth, height: 1 });
            rects.push({ x: inset, y: safeHeight - y - 1, width: rowWidth, height: 1 });
        }
    }

    return rects;
}

function bindRoundedWindowShape(win) {
    if (!win || process.platform === 'darwin' || typeof win.setShape !== 'function') {
        return;
    }

    let shapeTimer = null;
    const applyShape = () => {
        if (!win || win.isDestroyed()) return;

        const [width, height] = win.getSize();
        const shouldRound = !win.isMaximized() && !win.isFullScreen();
        const shape = shouldRound
            ? buildRoundedWindowShape(width, height)
            : [{ x: 0, y: 0, width, height }];

        try {
            win.setShape(shape);
        } catch (error) {
            console.log('Falha ao aplicar cantos arredondados na janela:', error.message);
        }
    };

    const scheduleShape = () => {
        if (shapeTimer) clearTimeout(shapeTimer);
        shapeTimer = setTimeout(applyShape, 40);
    };

    win.webContents.once('did-finish-load', scheduleShape);
    win.on('resize', scheduleShape);
    win.on('maximize', scheduleShape);
    win.on('unmaximize', scheduleShape);
    win.on('enter-full-screen', scheduleShape);
    win.on('leave-full-screen', scheduleShape);
    setTimeout(scheduleShape, 120);
}

function createWindow() {
// ... (o resto do seu código de criar a janela continua igualzinho para baixo)
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        frame: false, 
        transparent: true,
        backgroundColor: '#00000000',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    bindRoundedWindowShape(mainWindow);
    mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
    await startControlServer();
    warmupYtDlp();
    createWindow();
    setupAutoUpdater();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// ========================================================
// CONTROLES DE JANELA (MINIMIZAR, FECHAR, PINAR)
// ========================================================
ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('close-window', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.setFullScreen(!win.isFullScreen());
});

ipcMain.on('toggle-always-on-top', (event, isPinned) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setAlwaysOnTop(isPinned);
});

ipcMain.on('discord-presence-update', (event, track, state) => {
    updateDiscordPresence(track, state);
});

ipcMain.on('discord-presence-clear', () => {
    clearDiscordPresence();
});

ipcMain.handle('discord-status-get', () => discordStatus);

ipcMain.handle('discord-presence-reset', async () => {
    await resetDiscordPresenceClient();
    return discordStatus;
});

ipcMain.handle('discord-presence-test', async () => {
    const testTrack = {
        title: 'Teste do Fluxo RPC',
        artist: 'Fluxo Music',
        thumbnail: '',
        url: 'https://www.youtube.com/',
        fluxoUrl: FLUXO_RPC_URL,
        progressText: '0:11 / 3:39',
        startedAt: Date.now() - 11000,
        endsAt: Date.now() + 208000
    };

    await updateDiscordPresence(testTrack, 'playing');
    return discordStatus;
});

ipcMain.handle('app-info-get', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    argv: process.argv,
    platform: process.platform,
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
    downloadsPath: app.getPath('downloads'),
    discord: discordStatus,
    ytDlpPath,
    ytDlpWarmup: ytDlpWarmupStatus,
    controlServer: controlServerInfo,
    pluginsPath: getPluginsDir()
}));

ipcMain.handle('plugins-list', () => scanFluxoPlugins());

ipcMain.handle('plugins-open-folder', async () => {
    await ensurePluginStarterFile();
    const directory = getPluginsDir();
    await shell.openPath(directory);
    return { success: true, directory };
});

ipcMain.handle('external-url-open', async (event, rawUrl) => {
    const allowed = new Set(['https://livepix.gg/devpotato']);
    const url = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!allowed.has(url)) {
        return { success: false, error: 'URL externa nao autorizada.' };
    }

    await shell.openExternal(url);
    return { success: true, url };
});

ipcMain.handle('network-diagnostics-run', async () => {
    const checks = await Promise.all([
        timedFetch('https://www.youtube.com/generate_204'),
        timedFetch('https://open.spotify.com'),
        timedFetch('https://soundcloud.com')
    ]);

    return {
        generatedAt: new Date().toISOString(),
        online: checks.some(check => check.ok),
        checks,
        streamCacheSize: streamUrlCache.size,
        inflightStreams: streamUrlInflight.size,
        ytDlpPath,
        ytDlpExists: fs.existsSync(ytDlpPath),
        ytDlpWarmup: ytDlpWarmupStatus,
        controlServer: controlServerInfo,
        pluginsPath: getPluginsDir()
    };
});

ipcMain.handle('diagnose-media', async (event, track, quality = 'audio') => {
    const target = getTrackTargetFromPayload(track);
    const wantsVideo = quality !== 'audio';
    const format = getFormatForQuality(quality);
    const maxHeight = getMaxHeightForQuality(quality);
    const startedAt = Date.now();
    const result = {
        ok: false,
        quality,
        target,
        generatedAt: new Date().toISOString(),
        checks: [
            { name: 'yt-dlp', ok: fs.existsSync(ytDlpPath), detail: ytDlpPath }
        ],
        metadata: null,
        reason: ''
    };

    if (!target) {
        result.reason = 'Faixa sem URL, ID ou termo de busca para diagnosticar.';
        return result;
    }

    if (!fs.existsSync(ytDlpPath)) {
        result.reason = 'yt-dlp nao foi encontrado no pacote do Fluxo.';
        return result;
    }

    try {
        const info = await ytDlpWithExtractorFallback(target, {
            dumpSingleJson: true,
            noWarnings: true,
            noPlaylist: true
        }, 'metadata de midia');

        result.metadata = {
            title: info?.title || track?.title || '',
            extractor: info?.extractor_key || info?.extractor || '',
            duration: info?.duration || 0,
            liveStatus: info?.live_status || ''
        };
        result.checks.push({ name: 'metadata', ok: true, detail: result.metadata.title });
    } catch (error) {
        result.reason = getFriendlyMediaError(error);
        result.raw = String(error?.stderr || error?.message || error || '').slice(0, 1200);
        result.checks.push({ name: 'metadata', ok: false, detail: result.reason });
        result.elapsedMs = Date.now() - startedAt;
        return result;
    }

    try {
        const streamUrl = await getStreamUrlFast(target, quality, format)
            || await getStreamUrlWithMetadata(target, quality, format, wantsVideo, maxHeight);
        result.ok = Boolean(streamUrl);
        result.reason = streamUrl ? 'Stream tocavel resolvido.' : 'yt-dlp leu a midia, mas nao encontrou formato tocavel para esse modo.';
        result.checks.push({ name: 'stream', ok: Boolean(streamUrl), detail: result.reason });
    } catch (error) {
        result.reason = getFriendlyMediaError(error);
        result.raw = String(error?.stderr || error?.message || error || '').slice(0, 1200);
        result.checks.push({ name: 'stream', ok: false, detail: result.reason });
    }

    result.elapsedMs = Date.now() - startedAt;
    return result;
});

ipcMain.handle('now-playing-widget-open', (event, mode = 'widget') => openNowPlayingWindow(mode));

ipcMain.on('now-playing-widget-update', (event, payload) => {
    lastNowPlayingPayload = payload || {};
    updateAuxNowPlayingWindows();
});

// ========================================================
// LÓGICA DO MINI-PLAYER (COM MEMÓRIA DE TELA)
// ========================================================
ipcMain.on('toggle-mini-player', (event, isMini) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    if (isMini) {
        normalBounds = win.getBounds();
        win.setMinimumSize(480, 110);
        win.setSize(580, 110);
        win.setAlwaysOnTop(true);
    } else {
        win.setMinimumSize(800, 600);
        if (normalBounds) {
            win.setBounds(normalBounds);
        } else {
            win.setSize(1200, 750);
            win.center();
        }
        win.setAlwaysOnTop(false);
    }
});

// ========================================================
// MOTOR DE EXTRAÇÃO VIA API DO YT-DLP (ALTA QUALIDADE + ANTI-BOT)
// ========================================================

ipcMain.handle('get-stream-url', async (event, url, quality = 'audio') => {
    const resolved = await resolveTrackStreamUrl(url, quality);
    return resolved?.url || null;
});

ipcMain.handle('resolve-track-stream', async (event, track, quality = 'audio') => {
    return resolveTrackStreamUrl(track, quality);
});

// ========================================================
// EXTRATOR DE PLAYLISTS DO SPOTIFY (SEM LIMITES E OFICIAL)
// ========================================================

ipcMain.handle('get-spotify-info', async (event, url) => {
    try {
        url = await resolveSpotifyUrl(url);
        // Extrai o ID real do link do Spotify
        const match = url.match(/(?:playlist|album|track)\/([a-zA-Z0-9]+)/);
        if (!match) return null;

        const id = match[1];
        const type = url.includes('album') ? 'album' : url.includes('track') ? 'track' : 'playlist';

        // Acessa o Embed Oficial do Spotify (Livre de tokens)
        const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`);
        const html = await res.text();

        // Encontra a base de dados embutida no HTML
        const jsonMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

        if (jsonMatch && jsonMatch[1]) {
            const data = JSON.parse(jsonMatch[1]);
            const entity = data.props?.pageProps?.state?.data?.entity;
            if (!entity) return null;

            const title = entity.name || "Playlist do Spotify";
            const tracksData = entity.trackList || [];

            // SEM LIMITE! Puxa todas as 100, 200, 500 faixas instantaneamente
            const queries = tracksData.map(t => `${t.title} ${t.subtitle}`).filter(t => t.trim() !== "");

            return { title: title, searchQueries: queries };
        }
        return null;
    } catch (error) {
        console.error("Erro no scraping do Spotify:", error);
        return null;
    }
});
// =========================================================================
// SISTEMA DE BUSCA (yt-search)
// =========================================================================
ipcMain.handle('search-audio', async (event, query) => {
    try {
        const mediaTarget = extractFirstHttpUrl(query);

        if (isDirectSoundCloudTarget(mediaTarget)) {
            return await extractSoundCloudTracks(mediaTarget);
        }

        if (isDirectYouTubeTarget(mediaTarget)) {
            return await extractYouTubeTracks(mediaTarget);
        }

        let videos = [];

        try {
            const [youtubeResult, soundCloudResult] = await Promise.allSettled([
                searchYouTubeWithYtSearch(query, 8),
                searchSoundCloudTracks(query, 5)
            ]);
            const youtubeTracks = youtubeResult.status === 'fulfilled' ? youtubeResult.value : [];
            const soundCloudTracks = soundCloudResult.status === 'fulfilled' ? soundCloudResult.value : [];
            if (youtubeResult.status === 'rejected') console.log('yt-search falhou:', youtubeResult.reason?.message || youtubeResult.reason);
            if (soundCloudResult.status === 'rejected') console.log('SoundCloud search falhou:', soundCloudResult.reason?.message || soundCloudResult.reason);
            videos = [...youtubeTracks, ...soundCloudTracks];
        } catch (searchError) {
            console.log('yt-search falhou, tentando fallback yt-dlp:', searchError.message);
        }

        if (videos.length === 0) {
            try {
                videos = await searchWithYtDlp(query);
            } catch (fallbackError) {
                console.log('yt-dlp search falhou:', fallbackError.message);
                videos = [];
            }
        }

        return { tracks: videos };
    } catch (error) {
        console.error('Erro interno na busca:', error);
        throw new Error('Falha ao buscar no YouTube.');
    }
});
//=================================================
// DESCARREGAR ARQUIVO DE ÁUDIO PARA A PASTA DOWNLOADS
// ========================================================
ipcMain.handle('download-audio', async (event, url, title, collectionTitle = '') => {
    try {
        const downloadsPath = app.getPath('downloads');
        const targetDir = collectionTitle
            ? path.join(downloadsPath, 'Fluxo Music', sanitizeFileName(collectionTitle, 'Playlist'))
            : path.join(downloadsPath, 'Fluxo Music');
        await fs.promises.mkdir(targetDir, { recursive: true });

        const safeTitle = sanitizeFileName(title);
        const outputPath = path.join(targetDir, `${safeTitle}.%(ext)s`);

        await ytDlpWithExtractorFallback(normalizeYouTubeTarget(url || title), {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '0',
            format: 'bestaudio/best',
            output: outputPath,
            noWarnings: true,
            noPlaylist: true
        }, 'download de audio');

        return { success: true, path: targetDir };
    } catch (error) {
        console.error('Erro no download:', error.message);
        return { success: false, error: getFriendlyMediaError(error) };
    }
});

ipcMain.handle('convert-current-track', async (event, track, format = 'mp3') => {
    try {
        const allowed = new Set(['mp3', 'm4a', 'wav', 'opus', 'flac']);
        const audioFormat = allowed.has(String(format).toLowerCase()) ? String(format).toLowerCase() : 'mp3';
        const targetDir = path.join(app.getPath('downloads'), 'Fluxo Music', 'Convertidos');
        await fs.promises.mkdir(targetDir, { recursive: true });

        const title = sanitizeFileName(track?.title, 'Fluxo Convertido');
        const outputPath = path.join(targetDir, `${title}.%(ext)s`);

        await ytDlpWithExtractorFallback(getTrackTargetFromPayload(track), {
            extractAudio: true,
            audioFormat,
            audioQuality: '0',
            format: 'bestaudio/best',
            output: outputPath,
            noWarnings: true,
            noPlaylist: true
        }, 'conversao de faixa');

        return { success: true, path: targetDir };
    } catch (error) {
        console.error('Erro ao converter faixa:', error.message);
        return { success: false, error: getFriendlyMediaError(error) };
    }
});

ipcMain.handle('export-track-sample', async (event, track, startSeconds = 0, endSeconds = 30) => {
    try {
        const start = Math.max(0, Number(startSeconds) || 0);
        const end = Math.max(start + 1, Number(endSeconds) || start + 30);
        const targetDir = path.join(app.getPath('downloads'), 'Fluxo Music', 'Samples');
        await fs.promises.mkdir(targetDir, { recursive: true });

        const title = sanitizeFileName(`${track?.title || 'Fluxo Sample'} ${formatSecondsLabel(start)}-${formatSecondsLabel(end)}`, 'Fluxo Sample');
        const outputPath = path.join(targetDir, `${title}.%(ext)s`);

        await ytDlpWithExtractorFallback(getTrackTargetFromPayload(track), {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '0',
            format: 'bestaudio/best',
            downloadSections: `*${start}-${end}`,
            forceKeyframesAtCuts: true,
            output: outputPath,
            noWarnings: true,
            noPlaylist: true
        }, 'sample de faixa');

        return { success: true, path: targetDir };
    } catch (error) {
        console.error('Erro ao exportar sample:', error.message);
        return { success: false, error: getFriendlyMediaError(error) };
    }
});
// ========================================================
// SISTEMA DE ATALHOS GLOBAIS (SEGUNDO PLANO)
// ========================================================
ipcMain.on('register-global-shortcuts', (event, hotkeys) => {
    globalShortcut.unregisterAll(); // Limpa os antigos
    
    if (!hotkeys.globalEnabled) return; // Só registra se o usuário ativou a chave global

    const mapAction = (acceleratorStr, actionName) => {
        if (!acceleratorStr) return;
        try {
            globalShortcut.register(acceleratorStr, () => {
                if (mainWindow) mainWindow.webContents.send('global-shortcut-action', actionName);
            });
        } catch (e) { console.log(`Falha ao registrar atalho global: ${acceleratorStr}`); }
    };

    mapAction(hotkeys.playPause, 'playPause');
    mapAction(hotkeys.volUp, 'volUp');
    mapAction(hotkeys.volDown, 'volDown');
    mapAction(hotkeys.nextTrack, 'nextTrack');
    mapAction(hotkeys.prevTrack, 'prevTrack');
});

ipcMain.on('unregister-global-shortcuts', () => {
    globalShortcut.unregisterAll();
});

// Remove os atalhos globais se o app for fechado para não travar as teclas do Windows
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
