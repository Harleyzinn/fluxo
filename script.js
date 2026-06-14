// ========================================================
// FIREBASE INITIALIZATION E LOGICA GLOBAL DE SALA
// ========================================================
const firebaseConfig = {
    apiKey: "AIzaSyCLK5DhWQMX6WO8lI0zlldnuyK04Gxm4PE",
    authDomain: "fluxo-music.firebaseapp.com",
    databaseURL: "https://fluxo-music-default-rtdb.firebaseio.com",
    projectId: "fluxo-music",
    storageBucket: "fluxo-music.firebasestorage.app",
    messagingSenderId: "247694587031",
    appId: "1:247694587031:web:3b32fe681e36eb65a725d2"
};

let db = null;
if (window.firebase?.initializeApp) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
} else {
    console.warn('Firebase indisponivel. Sessao compartilhada sera desativada.');
}
// ========================================================
// FIX: INTERCEPTADOR DE BUSCA (PADRONIZAÇÃO DE DADOS)
// ========================================================
if (window.electronAPI && window.electronAPI.searchAudio) {
    const originalSearch = window.electronAPI.searchAudio;
    window.electronAPI.searchAudio = async (query) => {
        const result = await originalSearch(query);
        // Se o main.js devolver um Array puro, embrulhamos num objeto com '.tracks'
        // Isso conserta a busca principal, as rádios e o auto-mix de uma vez só!
        const data = Array.isArray(result) ? { tracks: result } : (result || { tracks: [] });
        data.tracks = (data.tracks || []).map(normalizeTrack).filter(Boolean);
        return data;
    };
}   

function getTrackStreamId(track) {
    if (!track) return '';
    const url = String(track.url || '').trim();
    if (url && !/spotify\.com|spotify\.link/i.test(url)) return url;
    if (track.videoId) return track.videoId;
    if (track.soundcloudId || /^soundcloud:/i.test(String(track.id || ''))) return url || track.id;

    const id = String(track.id || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(id) || /^https?:\/\//i.test(id)) return id;
    if (/^ghost_|^spotify:/i.test(id) || /spotify\.com|spotify\.link/i.test(url)) return track.query || track.title || '';

    return track.query || track.title || id || '';
}

function getYouTubeVideoIdFromValue(value) {
    const text = String(value || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;

    const patterns = [
        /[?&]v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1];
    }

    return '';
}

function getStableYouTubeThumbnail(videoId) {
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
}

function normalizeTrack(track) {
    if (!track) return null;

    const id = track.id || track.videoId || track.url || track.query || '';
    const videoId = track.videoId || getYouTubeVideoIdFromValue(id) || getYouTubeVideoIdFromValue(track.url);
    const artist = track.artist || track.author?.name || track.author || track.channel || track.uploader || 'Desconhecido';
    return {
        ...track,
        id,
        videoId,
        artist,
        author: artist,
        title: track.title || track.name || track.query || 'Faixa sem titulo',
        thumbnail: getStableYouTubeThumbnail(videoId) || track.thumbnail || track.image || '',
        duration: track.duration || track.timestamp || ''
    };
}

function normalizeSearchResult(result) {
    const tracks = Array.isArray(result) ? result : (Array.isArray(result?.tracks) ? result.tracks : []);
    return { tracks: tracks.map(normalizeTrack).filter(track => track && getTrackStreamId(track)) };
}

async function searchAudioTracks(query) {
    if (!window.electronAPI?.searchAudio) return { tracks: [] };
    return normalizeSearchResult(await window.electronAPI.searchAudio(query));
}

const STREAM_RESOLUTION_TTL_MS = 38 * 60 * 1000;
const STREAM_RESOLUTION_REFRESH_MS = 18 * 60 * 1000;
const streamPrefetchKeys = new Set();
const streamResolutionCache = new Map();
const streamResolutionInflight = new Map();
let currentStreamRetryKey = '';

function getResolvedStreamCacheKey(track, quality = 'audio') {
    const normalized = normalizeTrack(track);
    if (!normalized) return '';
    const streamId = getTrackStreamId(normalized);
    const stableKey = getTrackKey(normalized) || streamId;
    return streamId ? `${stableKey}::${streamId}::${quality}` : '';
}

function readResolvedStreamCache(key) {
    const entry = streamResolutionCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > STREAM_RESOLUTION_TTL_MS) {
        streamResolutionCache.delete(key);
        return null;
    }
    return entry;
}

function rememberResolvedStream(key, resolved) {
    if (!key || !resolved?.url) return resolved;
    streamResolutionCache.set(key, {
        resolved,
        createdAt: Date.now()
    });
    return resolved;
}

function invalidateResolvedStream(track, quality = 'audio') {
    const key = getResolvedStreamCacheKey(track, quality);
    if (key) streamResolutionCache.delete(key);
    return key;
}

async function resolveTrackStreamCached(track, quality = 'audio', options = {}) {
    const normalized = normalizeTrack(track);
    const trackId = getTrackStreamId(normalized);
    if (!normalized || !trackId) throw new Error('Faixa sem identificador de stream.');

    const key = getResolvedStreamCacheKey(normalized, quality);
    const cached = !options.forceRefresh ? readResolvedStreamCache(key) : null;
    if (cached?.resolved?.url) {
        const age = Date.now() - cached.createdAt;
        if (age > STREAM_RESOLUTION_REFRESH_MS && !streamResolutionInflight.has(key)) {
            resolveTrackStreamCached(normalized, quality, { forceRefresh: true })
                .catch(err => console.log('Refresh de stream em background falhou:', err?.message || err));
        }
        return { ...cached.resolved, fromCache: true };
    }

    if (streamResolutionInflight.has(key)) return streamResolutionInflight.get(key);

    const promise = (async () => {
        const rawResolved = window.electronAPI.resolveTrackStream
            ? await window.electronAPI.resolveTrackStream(normalized, quality)
            : { url: await window.electronAPI.getStreamUrl(trackId, quality), quality, track: normalized };
        const url = typeof rawResolved === 'string' ? rawResolved : rawResolved?.url;
        if (!url) throw new Error('Stream indisponivel.');
        const resolved = {
            url,
            mode: rawResolved?.quality || quality,
            quality: rawResolved?.quality || quality,
            track: normalized,
            target: rawResolved?.target || trackId,
            source: rawResolved?.source || 'direct',
            warmedAt: Date.now()
        };
        return rememberResolvedStream(key, resolved);
    })();

    streamResolutionInflight.set(key, promise);
    try {
        return await promise;
    } finally {
        streamResolutionInflight.delete(key);
    }
}

function prefetchStream(track, quality = 'audio') {
    const normalized = normalizeTrack(track);
    const key = getResolvedStreamCacheKey(normalized, quality);
    if (!key || !window.electronAPI?.getStreamUrl) return Promise.resolve(null);
    if (readResolvedStreamCache(key)?.resolved?.url) return Promise.resolve(streamResolutionCache.get(key).resolved);
    if (streamResolutionInflight.has(key)) return streamResolutionInflight.get(key);
    if (streamPrefetchKeys.has(key)) return Promise.resolve(null);
    streamPrefetchKeys.add(key);

    return resolveTrackStreamCached(normalized, quality)
        .catch(err => {
            console.log('Preload de stream falhou:', err?.message || err);
            return null;
        })
        .finally(() => {
            setTimeout(() => streamPrefetchKeys.delete(key), 12000);
        });
}

function warmTrackStreams(tracks, quality = 'audio', limit = 3) {
    (tracks || [])
        .map(normalizeTrack)
        .filter(Boolean)
        .slice(0, limit)
        .forEach((track, index) => {
            setTimeout(() => prefetchStream(track, quality), index * 260);
        });
}

function getAdaptivePreloadLimit() {
    if (adaptivePreloadMode === 'off') return 0;
    const connection = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
    if (connection?.saveData || /(^|-)2g/i.test(connection?.effectiveType || '')) return adaptivePreloadMode === 'aggressive' ? 1 : 0;
    if (adaptivePreloadMode === 'aggressive') return 3;
    if (adaptivePreloadMode === 'light') return 1;
    return 2;
}

function smartPrefetchUpcoming(reason = 'idle') {
    const limit = getAdaptivePreloadLimit();
    if (!limit || !queue.length) return;
    if (Date.now() - lastAdaptivePreloadAt < 5000 && reason !== 'track-load') return;
    lastAdaptivePreloadAt = Date.now();

    const candidates = [];
    for (let offset = 1; offset <= limit; offset++) {
        const nextIndex = currentIndex + offset;
        if (queue[nextIndex]) candidates.push(queue[nextIndex]);
    }

    if (!candidates.length && loopMode === 1 && queue.length > 1) {
        candidates.push(queue[0]);
    }

    warmTrackStreams(candidates, isVideoMode ? 'video' : 'audio', limit);
}

async function resolveGhostTrack(track) {
    if (!track?.isGhost) return normalizeTrack(track);

    const ytRes = await searchAudioTracks(`${track.query || track.title} audio`);
    if (ytRes?.tracks?.length) {
        const resolved = normalizeTrack(ytRes.tracks[0]);
        return { ...track, ...resolved, isGhost: false };
    }

    throw new Error('Nao foi possivel converter a faixa do Spotify.');
}

async function downloadTrack(track, collectionTitle = '') {
    const resolved = await resolveGhostTrack(track);
    return window.electronAPI.downloadAudio(getTrackStreamId(resolved), resolved.title, collectionTitle);
}

function setVideoModeEnabled(enabled) {
    document.body.classList.toggle('video-mode', enabled);
}

let currentRoom = null;
let isHost = false;
let ignoreSync = false; 
let isWaitingForSync = false; 
let roomSettings = getDefaultRoomSettings();
let sessionPlayedTracks = [];
let sessionUsers = {};
let sessionSkipVotes = {};
let sessionQueueVotes = {};
let sessionReactions = {};
let sessionPinnedTrackKey = '';
let lastManualPlaybackControlAt = 0;
let lastManualPlaybackAction = 'all';
let isApplyingRemotePlayback = false;
let lastAppliedSessionEqStamp = '';
let lastAppliedSessionVideoMode = null;
let skipVoteInProgress = false;

let myUid = localStorage.getItem('fluxo_uid');
if (!myUid) { 
    myUid = 'usr_' + Math.random().toString(36).substr(2, 9); 
    localStorage.setItem('fluxo_uid', myUid); 
}
let myName = localStorage.getItem('fluxo_name') || '';

// VARIÁVEIS DE ESTADO DA INTERFACE
let activeMpTab = 'mp-info';
let currentLyrics = "Clique acima para sincronizar com a música atual.";
const DEFAULT_DISCORD_CLIENT_ID = '1487787955186565250';
const SESSION_REACTION_TYPES = [
    { id: 'fire', label: 'HYPE', icon: 'ph-fire' },
    { id: 'heart', label: 'BRABA', icon: 'ph-heart' },
    { id: 'laugh', label: 'KKK', icon: 'ph-smiley' },
    { id: 'sad', label: 'FEELS', icon: 'ph-cloud-rain' },
    { id: 'replay', label: 'REPLAY', icon: 'ph-repeat' }
];
let lyricCache = loadLyricCache();

localStorage.setItem('fluxo_discord_client_id', DEFAULT_DISCORD_CLIENT_ID);

function generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

function getDefaultRoomSettings() {
    return {
        controlsEnabled: false,
        queueVisible: true,
        directQueueEnabled: false,
        sessionRadioEnabled: false,
        videoEnabled: false,
        skipVotingEnabled: true,
        hostCanSkipVote: true,
        allowGuestPlayPause: false,
        allowGuestSeek: false,
        allowGuestSkip: false,
        requestsMuted: false,
        priorityQueueEnabled: true,
        reactionsEnabled: true
    };
}

function normalizeRoomSettings(settings = {}) {
    const normalized = { ...getDefaultRoomSettings(), ...(settings || {}) };
    if (settings?.controlsEnabled) {
        normalized.allowGuestPlayPause = true;
        normalized.allowGuestSeek = true;
        normalized.allowGuestSkip = true;
    }
    normalized.controlsEnabled = Boolean(normalized.allowGuestPlayPause && normalized.allowGuestSeek && normalized.allowGuestSkip);
    return normalized;
}

function isQueueViewActive() {
    return document.getElementById('btnQueueView')?.classList.contains('active');
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

function getRecommendedFirebaseRulesObject() {
    const roomWriteRule = "$roomId.matches(/^[A-Z0-9]{4}$/) && ((!data.exists() && newData.hasChildren(['createdAt', 'updatedAt'])) || (data.exists() && (!data.child('createdAt').exists() || data.child('createdAt').val() + 86400000 > now || !newData.exists())))";

    return {
        rules: {
            rooms: {
                "$roomId": {
                    ".read": "$roomId.matches(/^[A-Z0-9]{4}$/)",
                    ".write": roomWriteRule,
                    createdAt: { ".validate": "newData.isNumber()" },
                    updatedAt: { ".validate": "newData.isNumber()" },
                    metaUpdatedAt: { ".validate": "newData.isNumber()" },
                    state: { ".validate": "newData.isString() && newData.val().matches(/^(playing|paused)$/)" },
                    time: { ".validate": "newData.isNumber()" },
                    track: { ".validate": true },
                    queue: { ".validate": true },
                    settings: {
                        controlsEnabled: { ".validate": "newData.isBoolean()" },
                        queueVisible: { ".validate": "newData.isBoolean()" },
                        directQueueEnabled: { ".validate": "newData.isBoolean()" },
                        sessionRadioEnabled: { ".validate": "newData.isBoolean()" },
                        videoEnabled: { ".validate": "newData.isBoolean()" },
                        skipVotingEnabled: { ".validate": "newData.isBoolean()" },
                        hostCanSkipVote: { ".validate": "newData.isBoolean()" },
                        allowGuestPlayPause: { ".validate": "newData.isBoolean()" },
                        allowGuestSeek: { ".validate": "newData.isBoolean()" },
                        allowGuestSkip: { ".validate": "newData.isBoolean()" },
                        requestsMuted: { ".validate": "newData.isBoolean()" },
                        priorityQueueEnabled: { ".validate": "newData.isBoolean()" },
                        reactionsEnabled: { ".validate": "newData.isBoolean()" },
                        "$other": { ".validate": false }
                    },
                    pinnedTrackKey: { ".validate": "newData.isString() && newData.val().length <= 40" },
                    played: { ".validate": true },
                    eq: { ".validate": true },
                    directQueue: {
                        "$requestId": {
                            track: { ".validate": true },
                            sender: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            createdAt: { ".validate": "newData.isNumber()" },
                            system: { ".validate": "newData.isBoolean()" },
                            "$other": { ".validate": false }
                        }
                    },
                    skipVotes: {
                        "$uid": {
                            name: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            votedAt: { ".validate": "newData.isNumber()" },
                            "$other": { ".validate": false }
                        }
                    },
                    queueVotes: {
                        "$trackKey": {
                            "$uid": {
                                name: { ".validate": "newData.isString() && newData.val().length <= 20" },
                                votedAt: { ".validate": "newData.isNumber()" },
                                "$other": { ".validate": false }
                            }
                        }
                    },
                    reactions: {
                        "$reactionId": {
                            type: { ".validate": "newData.isString() && newData.val().matches(/^(fire|heart|laugh|sad|replay)$/)" },
                            emoji: { ".validate": "newData.isString() && newData.val().length <= 8" },
                            sender: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            trackKey: { ".validate": "newData.isString() && newData.val().length <= 40" },
                            trackTitle: { ".validate": "newData.isString() && newData.val().length <= 160" },
                            createdAt: { ".validate": "newData.isNumber()" },
                            "$other": { ".validate": false }
                        }
                    },
                    users: {
                        "$uid": {
                            name: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            isReady: { ".validate": "newData.isBoolean()" },
                            isHost: { ".validate": "newData.isBoolean()" },
                            "$other": { ".validate": false }
                        }
                    },
                    entryRequests: {
                        "$uid": {
                            name: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            status: { ".validate": "newData.isString() && newData.val().matches(/^(pending|accepted|rejected)$/)" },
                            "$other": { ".validate": false }
                        }
                    },
                    musicRequests: {
                        "$requestId": {
                            track: { ".validate": true },
                            sender: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            message: { ".validate": "newData.isString() && newData.val().length <= 240" },
                            status: { ".validate": "newData.isString() && newData.val().matches(/^(pending|accepted|rejected)$/)" },
                            "$other": { ".validate": false }
                        }
                    },
                    chat: {
                        "$messageId": {
                            sender: { ".validate": "newData.isString() && newData.val().length <= 20" },
                            text: { ".validate": "newData.isString() && newData.val().length <= 500" },
                            createdAt: { ".validate": "newData.isNumber()" },
                            system: { ".validate": "newData.isBoolean()" },
                            "$other": { ".validate": false }
                        }
                    },
                    "$other": { ".validate": false }
                }
            },
            ".read": false,
            ".write": false
        }
    };
}

function getRecommendedFirebaseRulesText() {
    return JSON.stringify(getRecommendedFirebaseRulesObject(), null, 2);
}

function isFirebasePermissionDenied(error) {
    const raw = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    return raw.includes('permission_denied') || raw.includes('permission denied') || raw.includes('permission');
}

function resetMultiplayerSessionState() {
    currentRoom = null;
    isHost = false;
    ignoreSync = false;
    isWaitingForSync = false;
    sessionPlayedTracks = [];
    sessionUsers = {};
    sessionSkipVotes = {};
    sessionQueueVotes = {};
    sessionReactions = {};
    sessionPinnedTrackKey = '';
    lastAppliedSessionEqStamp = '';
    lastAppliedSessionVideoMode = null;
}

function handleMultiplayerFirebaseError(error, context = 'sincronizar multiplayer') {
    console.warn(`[Fluxo multiplayer] Falha ao ${context}:`, error);

    if (isFirebasePermissionDenied(error)) {
        resetMultiplayerSessionState();
        renderMultiplayerUnavailable(`Firebase recusou permissao ao ${context}. As regras atuais do Realtime Database parecem expiradas ou bloqueadas.`);
        return;
    }

    renderMultiplayerUnavailable(`Falha no Firebase ao ${context}.`, error);
}

function trackMultiplayerPromise(promise, context) {
    if (!promise || typeof promise.catch !== 'function') return promise;
    return promise.catch(error => {
        handleMultiplayerFirebaseError(error, context);
        return null;
    });
}

function updateCurrentRoomState(payload, context = 'atualizar sala') {
    if (!db || !currentRoom) return Promise.resolve(null);
    return trackMultiplayerPromise(db.ref(`rooms/${currentRoom}`).update(payload), context);
}

function getCurrentPlaybackPatch(extra = {}) {
    const patch = {
        metaUpdatedAt: Date.now(),
        ...extra
    };

    if (!Object.prototype.hasOwnProperty.call(patch, 'updatedAt')) {
        patch.updatedAt = Date.now();
    }

    if (!Object.prototype.hasOwnProperty.call(patch, 'time') && queue[currentIndex]) {
        patch.time = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    }

    if (!Object.prototype.hasOwnProperty.call(patch, 'state')) {
        patch.state = audioPlayer.paused ? 'paused' : 'playing';
    }

    return patch;
}

function getSharedExpectedTime(data = {}) {
    let expectedTime = Number(data.time) || 0;
    if (data.state === 'playing' && data.updatedAt) {
        expectedTime += Math.max(0, (Date.now() - Number(data.updatedAt)) / 1000);
    }
    return expectedTime;
}

function noteManualPlaybackControl(action = 'all') {
    lastManualPlaybackControlAt = Date.now();
    lastManualPlaybackAction = action;
}

function canPublishPlaybackEvent() {
    if (!currentRoom || isApplyingRemotePlayback) return false;
    if (isHost) return true;
    return canControl(lastManualPlaybackAction) && Date.now() - lastManualPlaybackControlAt < 2200;
}

async function withRemotePlaybackGuard(action) {
    isApplyingRemotePlayback = true;
    ignoreSync = true;
    try {
        return await action();
    } finally {
        setTimeout(() => {
            isApplyingRemotePlayback = false;
            ignoreSync = false;
        }, 350);
    }
}

function getSessionEqPayload() {
    try {
        return buildSharedPresetPayload();
    } catch {
        return null;
    }
}

function publishSessionEqState(context = 'sincronizar equalizador') {
    if (!currentRoom || !isHost) return;
    const eq = getSessionEqPayload();
    if (!eq) return;
    updateCurrentRoomState(getCurrentPlaybackPatch({ eq }), context);
}

function getTrackListFingerprint(tracks = []) {
    return tracks.map(track => getTrackFingerprint(normalizeTrack(track)) || normalizeTrack(track)?.id || '').join('|');
}

function getSessionTrackKey(track) {
    const normalized = normalizeTrack(track);
    if (!normalized) return '';
    const raw = getTrackFingerprint(normalized) || getTrackKey(normalized) || normalized.title;
    return `trk_${stableHash(raw).toString(36)}`;
}

function getQueueVoteBucket(track) {
    const key = getSessionTrackKey(track);
    return key ? (sessionQueueVotes?.[key] || {}) : {};
}

function getQueueVoteCount(track) {
    return Object.keys(getQueueVoteBucket(track)).length;
}

function getReactionTypeInfo(type) {
    return SESSION_REACTION_TYPES.find(item => item.id === type) || SESSION_REACTION_TYPES[0];
}

function getTrackReactionSummary(track) {
    const key = getSessionTrackKey(track);
    const counts = {};
    Object.values(sessionReactions || {}).forEach(reaction => {
        if (!reaction || reaction.trackKey !== key) return;
        counts[reaction.type] = (counts[reaction.type] || 0) + 1;
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { total, counts };
}

function sortSessionQueueByPriority() {
    if (!isHost || !roomSettings.priorityQueueEnabled || queue.length <= currentIndex + 1) return false;
    const current = queue[currentIndex];
    const upcoming = queue.slice(currentIndex + 1).map((track, order) => ({ track, order }));
    const sorted = [...upcoming].sort((a, b) => {
        const aPinned = getSessionTrackKey(a.track) === sessionPinnedTrackKey ? 1 : 0;
        const bPinned = getSessionTrackKey(b.track) === sessionPinnedTrackKey ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        const aVotes = getQueueVoteCount(a.track);
        const bVotes = getQueueVoteCount(b.track);
        if (aVotes !== bVotes) return bVotes - aVotes;
        return a.order - b.order;
    });
    const nextQueue = [
        ...queue.slice(0, currentIndex + 1),
        ...sorted.map(item => item.track)
    ];
    if (getTrackListFingerprint(nextQueue) === getTrackListFingerprint(queue)) return false;
    queue = nextQueue;
    originalQueue = nextQueue.slice();
    currentIndex = findTrackIndexByIdentity(queue, current);
    if (currentIndex < 0) currentIndex = 0;
    publishRoomState();
    renderSessionQueueList(queue, sessionPlayedTracks);
    return true;
}

function voteSessionQueueTrack(track) {
    if (!currentRoom || !db) return;
    const key = getSessionTrackKey(track);
    if (!key) return;
    const voteRef = db.ref(`rooms/${currentRoom}/queueVotes/${key}/${myUid}`);
    const existing = sessionQueueVotes?.[key]?.[myUid];
    const action = existing
        ? voteRef.remove()
        : voteRef.set({ name: myName, votedAt: Date.now() });
    trackMultiplayerPromise(action, existing ? 'remover voto da fila' : 'votar na fila');
}

function pinSessionQueueTrack(track) {
    if (!isHost || !currentRoom || !db) return;
    const key = getSessionTrackKey(track);
    sessionPinnedTrackKey = sessionPinnedTrackKey === key ? '' : key;
    if (sessionPinnedTrackKey && queue[currentIndex]) {
        sortSessionQueueByPriority();
    }
    updateCurrentRoomState(getCurrentPlaybackPatch({ pinnedTrackKey: sessionPinnedTrackKey }), 'fixar musica da fila');
}

function sendSessionReaction(type) {
    if (!currentRoom || !db || !roomSettings.reactionsEnabled) return;
    const track = normalizeTrack(queue[currentIndex]);
    if (!track) return;
    const info = getReactionTypeInfo(type);
    trackMultiplayerPromise(
        db.ref(`rooms/${currentRoom}/reactions`).push({
            type: info.id,
            emoji: info.icon,
            sender: myName,
            trackKey: getSessionTrackKey(track),
            trackTitle: String(track.title || 'Faixa').slice(0, 160),
            createdAt: Date.now()
        }),
        'enviar reacao da sessao'
    );
}

function renderSessionReactionFeed() {
    const feed = document.getElementById('sessionReactionFeed');
    if (!feed) return;
    const recent = Object.values(sessionReactions || {})
        .filter(Boolean)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 8);
    feed.innerHTML = recent.length ? recent.map(reaction => {
        const info = getReactionTypeInfo(reaction.type);
        return `
            <div class="mp-reaction-feed-row">
                <i class="ph ${escapeHtml(info.icon)}"></i>
                <span>${escapeHtml(reaction.sender || 'USER')}</span>
                <small>${escapeHtml(info.label)} em ${escapeHtml(reaction.trackTitle || 'faixa')}</small>
            </div>
        `;
    }).join('') : '<div class="mp-empty">Sem reacoes ainda.</div>';
}

function getSessionRankingData() {
    const requesterMap = {};
    const trackReactionMap = {};
    const acceptedMap = {};

    sessionPlayedTracks.forEach(track => {
        const requester = String(track?.requestedBy || '').trim();
        if (requester) requesterMap[requester] = (requesterMap[requester] || 0) + 1;
        const key = getSessionTrackKey(track);
        if (requester && key) {
            acceptedMap[key] = {
                title: track.title || 'Faixa',
                requester,
                count: (acceptedMap[key]?.count || 0) + 1
            };
        }
    });

    Object.values(sessionReactions || {}).forEach(reaction => {
        if (!reaction?.trackKey) return;
        trackReactionMap[reaction.trackKey] = {
            title: reaction.trackTitle || trackReactionMap[reaction.trackKey]?.title || 'Faixa',
            count: (trackReactionMap[reaction.trackKey]?.count || 0) + 1
        };
    });

    const toTop = (map, formatter) => Object.entries(map)
        .map(formatter)
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    return {
        requesters: toTop(requesterMap, ([name, count]) => ({ name, count })),
        reacted: toTop(trackReactionMap, ([key, value]) => ({ key, ...value })),
        accepted: toTop(acceptedMap, ([key, value]) => ({ key, ...value }))
    };
}

function saveSessionReplayPlaylist() {
    const tracks = getSessionPlaylistTracks('played').slice().reverse();
    if (!tracks.length) return false;
    const stamp = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    savedPlaylists.push({
        title: `Replay da sessao ${currentRoom} - ${stamp}`,
        cover: tracks[0]?.thumbnail || '',
        locked: false,
        tracks
    });
    savePlaylists();
    updateAchievementProgress('playlistSaved');
    unlockAchievement('sessionReplay');
    return true;
}

function renderSessionRanking() {
    const box = document.getElementById('sessionRankingBox');
    if (!box) return;
    const ranking = getSessionRankingData();
    const renderList = (items, empty, label = 'vezes') => items.length ? items.map((item, index) => `
        <div class="mp-rank-row">
            <span>${index + 1}</span>
            <strong>${escapeHtml(item.name || item.title || 'Item')}</strong>
            <small>${item.count} ${label}</small>
        </div>
    `).join('') : `<div class="mp-empty">${empty}</div>`;
    box.innerHTML = `
        <article class="mp-rank-card">
            <h4>Quem mais emplacou</h4>
            ${renderList(ranking.requesters, 'Sem musicas pedidas tocadas ainda.', 'tocadas')}
        </article>
        <article class="mp-rank-card">
            <h4>Mais reagidas</h4>
            ${renderList(ranking.reacted, 'Sem reacoes suficientes ainda.', 'reacoes')}
        </article>
        <article class="mp-rank-card">
            <h4>Pedidos aceitos</h4>
            ${renderList(ranking.accepted, 'Nenhum pedido aceito tocou ainda.', 'vezes')}
        </article>
    `;
}

function sharedTrackIdMatches(track) {
    const normalized = normalizeTrack(track);
    if (!normalized) return false;
    return normalized.id === audioPlayer.dataset.id || getTrackKey(normalized) === getTrackKey(queue[currentIndex]);
}

function syncHostQueueFromSharedQueue(sharedQueue = []) {
    if (!isHost || !Array.isArray(sharedQueue) || !sharedQueue.length) return;
    const normalized = sharedQueue.map(normalizeTrack).filter(Boolean);
    if (!normalized.length) return;
    if (getTrackListFingerprint(normalized) === getTrackListFingerprint(queue)) return;

    const currentTrack = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    queue = normalized;
    originalQueue = normalized.slice();
    const nextIndex = currentTrack ? findTrackIndexByIdentity(queue, currentTrack) : currentIndex;
    currentIndex = nextIndex >= 0 ? nextIndex : Math.min(currentIndex, queue.length - 1);
    if (isQueueViewActive()) document.getElementById('btnQueueView')?.click();
}

function rememberSessionPlayedTrack(track) {
    if (!currentRoom || !isHost) return;
    const normalized = normalizeTrack(track);
    if (!normalized) return;
    const key = getTrackKey(normalized);
    if (key && sessionPlayedTracks[0] && getTrackKey(sessionPlayedTracks[0]) === key) return;
    sessionPlayedTracks = [
        { ...normalized, sessionPlayedAt: Date.now() },
        ...sessionPlayedTracks.filter(item => !key || getTrackKey(item) !== key)
    ].slice(0, 120);
}

function getSessionPlaylistTracks(mode = 'queue') {
    const source = mode === 'played' ? sessionPlayedTracks : queue;
    return (source || []).map(normalizeTrack).filter(Boolean);
}

function saveSessionTracksAsPlaylist(mode = 'queue') {
    const tracks = getSessionPlaylistTracks(mode);
    if (!tracks.length) return false;
    const stamp = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const title = mode === 'played'
        ? `Sessao ${currentRoom} - tocadas ${stamp}`
        : `Sessao ${currentRoom} - fila ${stamp}`;
    savedPlaylists.push({ title, cover: tracks[0]?.thumbnail || '', locked: false, tracks });
    savePlaylists();
    updateAchievementProgress('playlistSaved');
    return true;
}

function renderSessionQueueList(sharedQueue = queue, played = sessionPlayedTracks) {
    const queueBox = document.getElementById('sessionQueueList');
    const playedBox = document.getElementById('sessionPlayedList');
    const normalizedQueue = (sharedQueue || []).map(normalizeTrack).filter(Boolean);
    const normalizedPlayed = (played || []).map(normalizeTrack).filter(Boolean);

    if (queueBox) {
        queueBox.innerHTML = normalizedQueue.length ? normalizedQueue.map((track, index) => `
            <div class="mp-track-row ${index === currentIndex ? 'active' : ''} ${getSessionTrackKey(track) === sessionPinnedTrackKey ? 'pinned' : ''}">
                <span class="mp-track-index">${index + 1}</span>
                <div class="mp-track-thumb" style="background-image:url('${escapeHtml(track.thumbnail || '')}')"></div>
                <div class="mp-track-copy">
                    <strong>${escapeHtml(track.title || 'Faixa')}</strong>
                    <span>${escapeHtml(track.artist || 'Desconhecido')}${track.requestedBy ? ` - por ${escapeHtml(track.requestedBy)}` : ''}</span>
                    <div class="mp-track-stats">
                        <small><i class="ph ph-arrow-fat-up"></i> ${getQueueVoteCount(track)}</small>
                        <small><i class="ph ph-sparkle"></i> ${getTrackReactionSummary(track).total}</small>
                        ${getSessionTrackKey(track) === sessionPinnedTrackKey ? '<small class="pin">FIXADA</small>' : ''}
                    </div>
                </div>
                <div class="mp-track-actions">
                    <button class="btn-action" data-session-vote="${index}" title="Votar para subir na fila"><i class="ph ph-arrow-fat-up"></i></button>
                    ${isHost ? `<button class="btn-action" data-session-pin="${index}" title="Fixar como prioridade"><i class="ph ph-push-pin"></i></button>` : ''}
                </div>
            </div>
        `).join('') : '<div class="mp-empty">Fila da sessao vazia.</div>';

        queueBox.querySelectorAll('[data-session-vote]').forEach(button => {
            button.onclick = () => voteSessionQueueTrack(normalizedQueue[Number(button.dataset.sessionVote)]);
        });
        queueBox.querySelectorAll('[data-session-pin]').forEach(button => {
            button.onclick = () => pinSessionQueueTrack(normalizedQueue[Number(button.dataset.sessionPin)]);
        });
    }

    if (playedBox) {
        playedBox.innerHTML = normalizedPlayed.length ? normalizedPlayed.slice(0, 20).map((track, index) => `
            <div class="mp-track-row compact">
                <span class="mp-track-index">${index + 1}</span>
                <div class="mp-track-copy">
                    <strong>${escapeHtml(track.title || 'Faixa')}</strong>
                    <span>${escapeHtml(track.artist || 'Desconhecido')}</span>
                </div>
            </div>
        `).join('') : '<div class="mp-empty">Nada tocado nesta sessao ainda.</div>';
    }
}

function publishRoomState(extra = {}) {
    if (!db || !currentRoom || !isHost) return;

    const eq = getSessionEqPayload();
    updateCurrentRoomState(getCurrentPlaybackPatch({
        queue: roomSettings.queueVisible ? queue.map(normalizeTrack).filter(Boolean) : [],
        played: sessionPlayedTracks.map(normalizeTrack).filter(Boolean),
        settings: normalizeRoomSettings(roomSettings),
        pinnedTrackKey: sessionPinnedTrackKey || '',
        ...(eq ? { eq } : {}),
        updatedAt: Date.now(),
        ...extra
    }), 'publicar estado da sala');
}

function renderMultiplayerUnavailable(reason = '', error = null) {
    const expired = Date.now() >= FIREBASE_TEST_MODE_EXPIRES_AT;
    const expiresAt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(new Date(FIREBASE_TEST_MODE_EXPIRES_AT));
    const detail = reason || 'Nao foi possivel carregar a rede da sessao compartilhada. O player local continua funcionando normalmente.';
    const errorCode = error?.code || error?.message || '';

    panelTitle.innerText = "SESSÃO COMPARTILHADA INDISPONÍVEL";
    resultsList.innerHTML = `
        <li style="padding: 38px; color: var(--text-main);">
            <div style="max-width: 760px; margin: 0 auto; display: grid; gap: 18px;">
                <div style="text-align:center;">
                    <i class="ph ph-plugs-connected" style="font-size: 3.4rem; color: var(--neon-pink); display:block; margin-bottom:15px;"></i>
                    <h3 style="margin:0 0 8px; color:var(--neon-pink);">Multiplayer bloqueado pelo Firebase</h3>
                    <p style="margin:0; color:var(--text-muted); line-height:1.6;">${escapeHtml(detail)}</p>
                </div>
                <div style="border:var(--border-tech); border-radius:var(--item-radius); background:rgba(0,0,0,0.24); padding:16px; display:grid; gap:10px;">
                    <div style="display:flex; justify-content:space-between; gap:12px; color:var(--text-muted); font-size:0.9rem;">
                        <span>Modo teste expirou</span>
                        <strong style="color:${expired ? 'var(--neon-pink)' : 'var(--neon-cyan)'};">${escapeHtml(expiresAt)} BRT</strong>
                    </div>
                    <div style="color:var(--text-muted); font-size:0.9rem; line-height:1.55;">
                        Publique as regras do arquivo <strong>firebase.database.rules.json</strong> em Firebase Console &gt; Realtime Database &gt; Rules.
                        Como o app ainda nao usa Firebase Auth, essas regras liberam salas do Fluxo com validacao basica e expiram salas antigas em 24h.
                    </div>
                    ${errorCode ? `<code style="white-space:pre-wrap; color:var(--neon-pink); font-size:0.78rem;">${escapeHtml(errorCode)}</code>` : ''}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">
                    <button class="btn-confirm" id="btnCopyMultiplayerRules"><i class="ph ph-copy"></i> COPIAR REGRAS</button>
                    <button class="btn-action" id="btnRetryMultiplayer"><i class="ph ph-arrow-clockwise"></i> TENTAR DE NOVO</button>
                </div>
            </div>
        </li>
    `;

    document.getElementById('btnCopyMultiplayerRules')?.addEventListener('click', (event) => {
        copyDonationText(getRecommendedFirebaseRulesText(), event.currentTarget, 'REGRAS COPIADAS');
    });
    document.getElementById('btnRetryMultiplayer')?.addEventListener('click', renderMultiplayerPanel);
}

function renderSharedQueue(sharedQueue = [], visible = true) {
    const box = document.getElementById('sharedQueueBox');
    if (!box || isHost) return;

    if (!visible) {
        box.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Fila do anfitrião oculta.</div>';
        return;
    }

    if (!sharedQueue.length) {
        box.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Fila do anfitrião vazia.</div>';
        return;
    }

    box.innerHTML = `
        <div style="color:var(--neon-cyan); font-weight:bold; margin-bottom:8px;">FILA DO ANFITRIÃO</div>
        ${sharedQueue.slice(0, 8).map((track, index) => `
            <div style="display:flex; gap:8px; padding:4px 0; color:var(--text-main); font-size:0.85rem;">
                <span style="color:var(--text-muted); width:24px;">${index + 1}.</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(normalizeTrack(track)?.title)}</span>
            </div>
        `).join('')}
    `;
}

// ========================================================
// LÓGICA DA JANELA (ELECTRON BAR CONTROLS)
// ========================================================
document.getElementById('titleBarMin').addEventListener('click', () => { window.electronAPI.minimizeWindow(); });
document.getElementById('titleBarClose').addEventListener('click', () => { window.electronAPI.closeWindow(); });

if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

// ========================================================
// TRAVA DE CONTROLE E PERMISSÕES
// ========================================================
function canControl(action = 'all') {
    if (isHost) return true;
    if (currentRoom && roomSettings.controlsEnabled) return true;
    if (!currentRoom) return true;
    const permissionByAction = {
        playPause: 'allowGuestPlayPause',
        seek: 'allowGuestSeek',
        skip: 'allowGuestSkip',
        queue: 'directQueueEnabled'
    };
    const key = permissionByAction[action] || '';
    return Boolean(key && roomSettings[key]);
}

// ========================================================
// GERENCIAMENTO DO MENU LATERAL (SIDEBAR)
// ========================================================
// GERENCIAMENTO GENÉRICO DO MENU LATERAL (SIDEBAR)
// ========================================================
const menuButtons = document.querySelectorAll('.sidebar-btn');

function handleTabSwitch(clickedBtn) {
    // 1. Controle Visual (Remove o brilho dos outros botões e acende o clicado)
    menuButtons.forEach(btn => btn.classList.remove('active'));
    clickedBtn.classList.add('active');

    // 2. Limpeza de UI Genérica (Esconde coisas que não devem vazar para outras abas)
    const btnClearQueue = document.getElementById('btnClearQueue');
    if (btnClearQueue) btnClearQueue.style.display = 'none';

    // 3. Pausa prévias de áudio que ficaram tocando esquecidas em outra aba
    if (window.previewPlayer && !window.previewPlayer.paused) {
        window.previewPlayer.pause();
        document.querySelectorAll('.btn-preview').forEach(b => b.classList.replace('ph-pause-circle', 'ph-play-circle'));
    }

    // 4. Lógica Específica para alguns botões da Sidebar
    if (clickedBtn.id === 'btnMultiplayer') {
        document.getElementById('mpBadge').style.display = 'none'; 
        renderMultiplayerPanel(); 
        if (typeof currentRoom !== 'undefined' && currentRoom) setupRoomListeners(); 
    }
}

// Aplica o "escutador" em todos os botões do menu lateral
menuButtons.forEach(btn => {
    btn.addEventListener('click', function() { 
        handleTabSwitch(this); 
    });
});
// ========================================================
// SISTEMA DE TEMAS
// ========================================================
function applyThemeClass(themeId) {
    [...document.body.classList]
        .filter(className => className.startsWith('theme-'))
        .forEach(className => document.body.classList.remove(className));

    if (themeId && themeId !== 'default') {
        document.body.classList.add(`theme-${themeId}`);
    }
}

const savedTheme = localStorage.getItem('fluxo_theme') || 'default';
applyThemeClass(savedTheme);

const LIVEPIX_DONATION_URL = 'https://livepix.gg/devpotato';
const LIVEPIX_PUBLIC_ID = '041b09cb-97d1-4ca3-b918-b1e5a08918b4';
const LIVEPIX_WIDGET_URL = 'https://widget.livepix.gg/embed/74f064b4-5a37-4c8d-8121-013017caa1e8';
const FIREBASE_TEST_MODE_EXPIRES_AT = 1777518000000;
const FIREBASE_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

document.getElementById('btnThemes').addEventListener('click', renderThemes);
document.getElementById('btnChangelog')?.addEventListener('click', renderChangelog);
document.getElementById('btnDonations')?.addEventListener('click', renderDonationsPanel);

const FLUXO_CHANGELOG = [
    {
        version: '3.9.30',
        date: '14/06/2026',
        title: 'Polimento do player',
        badge: 'Atual',
        items: [
            'Controles de reproducao tiveram codigo legado inalcancavel removido para reduzir conflito entre permissao de sessao e comandos locais.',
            'Auto-Mix agora aquece o stream da proxima faixa assim que ela entra na fila.',
            'Falha geral da busca virou uma tela amigavel com TENTAR DE NOVO e atalho para diagnostico de rede.',
            'Mantido o cache, prefetch e warmup do player para iniciar faixas com menos chamadas repetidas ao yt-dlp.'
        ]
    },
    {
        version: '3.9.29',
        date: '06/06/2026',
        title: 'Player turbo e backup completo',
        badge: 'Anterior',
        items: [
            'Player ganhou cache real de resolucao de stream no renderer, reaproveitando prefetch em vez de chamar yt-dlp de novo no play.',
            'Busca, playlist preview, tocar agora, tocar a seguir e proximas faixas aquecem streams em segundo plano.',
            'O app faz warmup do yt-dlp no boot e mostra status/tempo no diagnostico da Central Fluxo.',
            'Falhas do media element agora invalidam cache, renovam o stream uma vez e mostram o botao POR QUE FALHOU?.',
            'Biblioteca ganhou backup completo e restauracao em JSON unico com playlists, favoritos, historico, inbox, perfil visual e EQ.'
        ]
    },
    {
        version: '3.9.28',
        date: '06/06/2026',
        title: 'Stream blindado por proxy local',
        badge: 'Anterior',
        items: [
            'Corrigida a causa raiz do erro de stream recente: URLs do YouTube/googlevideo quebravam com CORS no renderer do Electron.',
            'O Fluxo agora toca streams via proxy local temporario em 127.0.0.1 com suporte a Range, CORS e Web Audio.',
            'O instalador agora inclui o yt-dlp.exe em resources/yt-dlp-bin e o app tem fallback para app.asar.unpacked.',
            'Equalizador, visualizer, modo video, preview, Deck B e sessao compartilhada continuam recebendo audio tocavel pelo mesmo caminho.',
            'Mantido o resolvedor robusto da 3.9.27, mas sem mandar a URL externa crua direto para o elemento de midia.'
        ]
    },
    {
        version: '3.9.27',
        date: '06/06/2026',
        title: 'Resolver de stream definitivo',
        badge: 'Anterior',
        items: [
            'O renderer agora envia a faixa inteira para o processo principal resolver stream com contexto de titulo, artista, query, URL e ids antigos.',
            'Se o alvo rapido falhar, o Fluxo testa candidatos do YouTube pelo titulo/query sem alterar a fila ou repetir musica.',
            'Fallback cobre id interno, ghost, Spotify, URL quebrada do YouTube e playlist salva de versoes antigas.',
            'Preview, prefetch, Deck B, sessao compartilhada e player principal usam o mesmo resolvedor robusto.'
        ]
    },
    {
        version: '3.9.26',
        date: '06/06/2026',
        title: 'Stream de playlists salvo',
        badge: 'Anterior',
        items: [
            'Faixas antigas/importadas com id ghost, Spotify ou id interno agora usam query/titulo para resolver o YouTube.',
            'Corrigido erro de stream em playlists como Acustico Kamaitachi quando a faixa salva nao tinha URL tocavel.',
            'Player mantem a velocidade de abertura usando ytsearch1 direto e clients android_vr/android antes do fallback tv/web.',
            'Diagnostico, download, conversor e samples seguem a mesma ordem de fallback do player.'
        ]
    },
    {
        version: '3.9.25',
        date: '06/06/2026',
        title: 'Hotfix de stream',
        badge: 'Anterior',
        items: [
            'Removida a recuperacao automatica que podia trocar faixas quebradas por outro resultado e repetir a mesma musica.',
            'Modo video ainda cai para audio da propria faixa quando necessario, sem alterar a fila.',
            'Downloads, conversor e exportador de samples agora usam os mesmos fallbacks de extractor do player.',
            'Diagnostico de midia deixou de depender apenas do client tv/web do YouTube, reduzindo falsos erros de DRM.'
        ]
    },
    {
        version: '3.9.23',
        date: '06/06/2026',
        title: 'LivePix mais limpo',
        badge: 'Anterior',
        items: [
            'A aba LivePix nao oferece mais campo ou fluxo manual para inserir lista externa de doadores.',
            'A janela de ultimos apoiadores ficou reservada para integracao automatica futura, sem configuracao tecnica dentro do app.',
            'Textos de changelog e release foram limpos para nao sugerir fonte manual de apoiadores.'
        ]
    },
    {
        version: '3.9.22',
        date: '05/06/2026',
        title: 'Sessao compartilhada turbinada',
        badge: 'Anterior',
        items: [
            'Modo host profissional ganhou permissoes separadas para play/pause, seek, skip, fila direta, pedidos silenciados, reacoes e prioridade.',
            'Fila da sessao agora tem votos para subir musica, pin do host e ordenacao prioritaria sem reiniciar a faixa atual.',
            'Reacoes ao vivo, ranking da sessao e replay automatico permitem salvar tudo que tocou como playlist.',
            'Conquistas locais foram adicionadas para plays, playlists, sessoes, replay, sleep timer e diagnostico da biblioteca.',
            'Sleep timer foi refeito com pausa por tempo, parar depois da faixa atual, fechar app e fade out configuravel.',
            'Biblioteca inteligente detecta duplicadas, faixas sem capa e suspeitas de midia quebrada, com deduplicacao manual segura.'
        ]
    },
    {
        version: '3.9.21',
        date: '05/06/2026',
        title: 'Sessao compartilhada profissional',
        badge: 'Anterior',
        items: [
            'Sessao compartilhada ganhou nova UI com cards, abas de controle, fila, membros, chat, pedidos e historico tocado.',
            'Convidados agora podem ver membros, salvar fila da sessao e salvar todas as musicas tocadas na sala.',
            'Host pode liberar proxima musica direta, Infinite Radio da sessao, video para todos e votacao de skip por 50% da sala.',
            'Sync foi ajustado para reduzir delay, evitar pausa acidental por buffering e aplicar o equalizador do host nos convidados.',
            'Aba LivePix ganhou janela preparada para ultimos doadores sem expor segredo privado no app.',
            'Novo tema Fluxo Bug entrou como satira visual de crash report e bugs controlados.'
        ]
    },
    {
        version: '3.9.20',
        date: '05/06/2026',
        title: 'Multiplayer Firebase destravado',
        badge: 'Anterior',
        items: [
            'Sessao compartilhada agora detecta permission_denied do Firebase e mostra o motivo no painel.',
            'O app explica que as regras de modo teste venceram em 30/04/2026 e oferece botao para copiar regras novas.',
            'Novo firebase.database.rules.json limita o multiplayer a salas de 4 caracteres, valida chat/pedidos/membros e expira salas antigas em 24h.',
            'Criar sala, entrar, chat, pedidos, host actions e sync de play/pause/progresso ganharam tratamento de erro.'
        ]
    },
    {
        version: '3.9.19',
        date: '05/06/2026',
        title: 'Widget oficial LivePix',
        badge: 'Anterior',
        items: [
            'A aba Apoiar Fluxo passou a usar o embed oficial do LivePix no lugar do QR gerado por terceiro.',
            'Widget de doacao aponta para widget.livepix.gg/embed/74f064b4-5a37-4c8d-8121-013017caa1e8.',
            'Card de doacao foi redimensionado para acomodar iframe do LivePix com mais estabilidade visual.',
            'Botao principal continua abrindo livepix.gg/devpotato no navegador externo.'
        ]
    },
    {
        version: '3.9.18',
        date: '05/06/2026',
        title: 'Aba de doacoes LivePix',
        badge: 'Anterior',
        items: [
            'Nova aba Apoiar Fluxo entrou no topo da sidebar com destaque visual permanente.',
            'Pagina de doacoes ganhou CTA forte para livepix.gg/devpotato, QR Code, copia de link e mensagem de compartilhamento.',
            'Abertura do LivePix usa IPC seguro com allowlist para evitar links externos arbitrarios.',
            'Segredos privados nao sao embutidos no app; apenas link e ID publico do LivePix aparecem para apoio.'
        ]
    },
    {
        version: '3.9.17',
        date: '31/05/2026',
        title: 'SoundCloud reconstruido',
        badge: 'Anterior',
        items: [
            'SoundCloud agora usa API publica propria para buscar faixas, sets, playlists e links curtos.',
            'Links on.soundcloud.com, snd.sc e soundcloud.app.goo.gl passam a ser reconhecidos e resolvidos antes da importacao.',
            'Player ganhou suporte local a HLS para tocar streams .m3u8 liberados pelo SoundCloud.',
            'Quando o SoundCloud entrega apenas stream protegido, o Fluxo falha com aviso de midia em vez de quebrar a busca.'
        ]
    },
    {
        version: '3.9.16',
        date: '31/05/2026',
        title: 'Busca do YouTube blindada',
        badge: 'Anterior',
        items: [
            'Busca principal deixou de quebrar quando o YouTube ou yt-dlp retorna videos marcados como DRM.',
            'Links diretos e playlists do YouTube agora usam metadados leves por ID/lista antes de cair no yt-dlp.',
            'Fallback do yt-dlp ignora entradas nulas e falhas individuais sem derrubar a tela de resultados.',
            'Warning do slider vertical do equalizador foi removido usando o padrao atual de CSS.'
        ]
    },
    {
        version: '3.9.15',
        date: '31/05/2026',
        title: 'Busca de temas e skins refeitas',
        badge: 'Anterior',
        items: [
            'Pagina de temas ganhou barra de pesquisa com filtro por nome, obra, estilo, cor e contador de resultados.',
            'Elden Ring, One Piece, Naruto, Jujutsu, Attack on Titan, Evangelion e Undertale foram refeitos com identidades mais distintas.',
            'Zelda, Hollow Knight e Persona 5 foram preservados sem alteracoes visuais.',
            'Os temas refeitos usam CSS/gradientes e componentes do proprio Fluxo, sem depender de imagens de fundo.'
        ]
    },
    {
        version: '3.9.14',
        date: '31/05/2026',
        title: 'Links, mixes e playlists',
        badge: 'Anterior',
        items: [
            'Barra de pesquisa agora aceita links do YouTube, music.youtube.com, youtu.be, playlists e mixes com parametro list.',
            'Playlists e mixes do YouTube sao importados como colecao em vez de virarem apenas um video solto.',
            'SoundCloud ficou mais flexivel com sets, playlists e links mobile/curtos como on.soundcloud.com.',
            'A tela de busca mostra quando esta importando link, playlist, mix ou set antes de renderizar os resultados.'
        ]
    },
    {
        version: '3.9.13',
        date: '31/05/2026',
        title: 'Botao YouTube no RPC',
        badge: 'Anterior',
        items: [
            'Discord RPC voltou a enviar o botao Ouvir no YouTube quando a faixa atual tem link do YouTube.',
            'O botao foi integrado ao payload Ouvindo para continuar aparecendo junto de jogos abertos.',
            'Se o Discord rejeitar botao ou thumbnail, o Fluxo usa fallback automatico sem derrubar a atividade.',
            'Central Fluxo agora mostra se o botao do RPC foi aceito ou se caiu em fallback.'
        ]
    },
    {
        version: '3.9.12',
        date: '31/05/2026',
        title: 'RPC como Ouvindo',
        badge: 'Anterior',
        items: [
            'Discord RPC agora envia a atividade como Ouvindo Fluxo Music, evitando sumir quando Roblox ou outro jogo esta aberto.',
            'Payload passou a usar SET_ACTIVITY raw com type Listening e fallback automatico para Playing se o Discord rejeitar.',
            'Diagnostico da Central mostra o modo real do payload: ouvindo, ouvindo sem thumb ou fallback.',
            'Botoes continuam removidos do RPC para evitar rejeicoes silenciosas.'
        ]
    },
    {
        version: '3.9.11',
        date: '31/05/2026',
        title: 'Cantos externos reais',
        badge: 'Anterior',
        items: [
            'A janela agora usa recorte nativo do Electron para arredondar de verdade as quinas externas no Windows/Linux.',
            'O recorte acompanha resize, maximizar e fullscreen sem cortar a interface.',
            'A raiz HTML ganhou fundo transparente tecnico para impedir o Chromium de pintar um retangulo atras dos temas.',
            'Os fundos dos temas continuam preservados, sem wrapper novo escondendo a identidade visual.'
        ]
    },
    {
        version: '3.9.10',
        date: '31/05/2026',
        title: 'Janela arredondada',
        badge: 'Anterior',
        items: [
            'Bordas externas da janela do Fluxo ficaram arredondadas.',
            'HTML e body agora usam fundo transparente e clipping arredondado para respeitar a janela Electron.',
            'Titlebar acompanha o raio superior da janela.',
            'Ajuste visual aplicado sem mexer nos temas individualmente.'
        ]
    },
    {
        version: '3.9.9',
        date: '31/05/2026',
        title: 'RPC sem botoes',
        badge: 'Anterior',
        items: [
            'Discord RPC deixou de enviar botoes para evitar rejeicao silenciosa do Discord.',
            'Presenca agora usa payload minimo: musica, artista, tempo e capa com fallback automatico.',
            'RPC ganhou retry automatico quando o Discord desktop ainda nao esta pronto.',
            'Reset RPC limpa a conexao quebrada antes de tentar uma atividade nova.',
            'Diagnostico da Central foi simplificado para mostrar estado, client id e ultimo erro.'
        ]
    },
    {
        version: '3.9.8',
        date: '31/05/2026',
        title: 'RPC, Central limpa e temas estaveis',
        badge: 'Anterior',
        items: [
            'Central Fluxo ficou ainda mais simples: status, acoes principais e uma unica gaveta de ferramentas avancadas.',
            'Temas novos foram refeitos em uma camada estavel, sem travar o scroll da lista.',
            'RPC agora reseta conexoes quebradas, reconecta depois de falha de login e envia atividade com PID correto.',
            'Diagnostico de RPC passou a orientar melhor quando o Discord desktop precisa estar aberto.',
            'Scroll de resultados e equalizador foi protegido contra overrides visuais dos temas.'
        ]
    },
    {
        version: '3.9.7',
        date: '31/05/2026',
        title: 'Central simples, RPC e Radio',
        badge: 'Anterior',
        items: [
            'Central Fluxo reorganizada em areas claras, atalhos principais e controles avancados recolhidos.',
            'Discord RPC ganhou reset manual, envio mais conservador da atividade e diagnostico mais direto.',
            'Infinite Radio ficou mais criterioso para puxar musicas relacionadas por artista, titulo e estilo.',
            'Fallback amplo do radio foi removido para evitar sugestoes aleatorias depois de poucas faixas.',
            'Temas recentes receberam uma passada de identidade visual para ficarem mais diferentes entre si.'
        ]
    },
    {
        version: '3.9.6',
        date: '25/05/2026',
        title: 'Recuperacao, Inbox e Diagnostico',
        badge: 'Anterior',
        items: [
            'Modo Recuperacao adicionado com atalho Ctrl+Shift+R para sair de mini-player, modo festa, foco, ambiente, tema bugado e layouts compactos presos.',
            'Inbox de musicas criada para guardar faixas tocadas agora, adicionadas na fila ou baixadas antes de virarem playlist definitiva.',
            'Painel BPM e Tom estima BPM, tonalidade, energia e confianca da faixa atual e das proximas musicas da fila.',
            'Diagnostico de Midia testa audio/video da faixa atual e registra problemas como DRM, bloqueio regional, video privado, formato quebrado ou falha de stream.',
            'Diagnostico de erros de reproducao passou a guardar alertas locais em vez de deixar falhas silenciosas quebrarem o fluxo.'
        ]
    },
    {
        version: '3.9.5',
        date: '24/05/2026',
        title: 'Widget, OBS e DJ',
        badge: 'Anterior',
        items: [
            'Widget de musica atual agora acompanha a paleta, fonte, bordas e efeitos do tema ativo.',
            'Overlay OBS ganhou skin propria por tema e usa o visual de modo festa quando disponivel.',
            'Troca de tema atualiza widget e overlay abertos na hora, sem precisar reabrir.',
            'Modo DJ recebeu preview B com volume dedicado, stop e retomada mais previsivel.',
            'Modo DJ evoluiu para Deck B independente com selecao de faixa, sync BPM e crossfader.',
            'Foram adicionados SoundCloud, waveform na timeline, comentarios locais, recap semanal, heatmap, Plugin API, Stream Deck bridge, automacoes e busca global.',
            'Mini player ganhou variantes compacto/horizontal e a tela ambiente entrou como modo visual separado.',
            'Erros de midia protegida por DRM agora aparecem de forma limpa, sem despejar comando tecnico na tela.'
        ]
    },
    {
        version: '3.9.4',
        date: '24/05/2026',
        title: 'Updater mais limpo',
        badge: 'Updater',
        items: [
            'Versionamento atualizado para 3.9.4.',
            'Instalador agora detecta Fluxo ja instalado e entra em modo silencioso.',
            'Quando a atualizacao termina, o app reabre direto na versao nova.',
            'Manifesto latest.yml e setup foram gerados com nome consistente para o auto-updater.'
        ]
    },
    {
        version: '3.9.3',
        date: '24/05/2026',
        title: 'Fila e aleatorio',
        badge: 'Fix',
        items: [
            'Modo aleatorio deixou de tratar a ultima musica sorteada como fim da playlist.',
            'Shuffle agora preserva a musica atual e embaralha o restante com identidade estavel.',
            'Fila ficou mais previsivel ao misturar busca, playlists e auto-mix.'
        ]
    },
    {
        version: '3.9.x',
        date: 'Pacote grande',
        title: 'Player, busca e Discord',
        badge: 'Core',
        items: [
            'Busca do YouTube foi blindada com normalizacao de resultados, thumbnails e fallback.',
            'Inicio da musica ficou mais rapido com prefetch de stream em resultados e fila.',
            'Seletor de qualidade de video foi removido e trocado por modo Audio/Video.',
            'Fullscreen agora mira o video, nao a janela inteira do app.',
            'Discord Rich Presence recebeu app id fixo, musica atual, thumbnail, tempo decorrido e duracao.',
            'RPC passou a priorizar payload simples para reduzir rejeicoes do Discord.'
        ]
    },
    {
        version: '3.9.x',
        date: 'Audio lab',
        title: 'Equalizador e efeitos',
        badge: 'DSP',
        items: [
            'Equalizador ficou mais robusto com perfis e controles de DSP.',
            'Velocidade da musica ganhou presets tipo slower, reverb e nightcore.',
            'Controles de midia foram centralizados para reduzir o caos visual dos botoes.',
            'Mini player foi melhorado e integrado com audio, video e modo festa.',
            'Crossfade e transicao suave receberam ajustes para reduzir estados bugados.'
        ]
    },
    {
        version: '3.9.x',
        date: 'Visual',
        title: 'Temas e modo festa',
        badge: 'UI',
        items: [
            'Minecraft, Soul Eater, Adolla, Dark Brotherhood e Fatal Error foram refeitos do zero.',
            'Adolla foi corrigido para usar chamas pretas e brancas.',
            'Hacker Matrix recebeu tratamento visual proprio.',
            'Foram adicionados novos temas de jogos, animes e mangas famosos.',
            'Cada tema ganhou identidade mais forte, com skin propria para modo festa e equalizador.'
        ]
    },
    {
        version: '3.9.x',
        date: 'Biblioteca',
        title: 'Recursos do Fluxo',
        badge: 'App',
        items: [
            'Biblioteca local com playlists, salvar fila e preview de playlist.',
            'Historico recente, radios ao vivo, sleep timer e atalhos locais/globais.',
            'Sessao compartilhada com sala, anfitriao, convidados, pedidos e fila visivel/opcional.',
            'Download de audio, suporte a links do YouTube/Spotify e drag and drop de arquivos.',
            'Engine de letras foi melhorada para achar letras automaticamente com menos busca manual.'
        ]
    }
];

function flattenChangelogText() {
    return FLUXO_CHANGELOG.map(entry => {
        const items = entry.items.map(item => `- ${item}`).join('\n');
        return `${entry.version} - ${entry.title}\n${items}`;
    }).join('\n\n');
}

async function writeTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    if (!success) throw new Error('Clipboard indisponivel.');
}

async function copyDonationText(text, button, doneText = 'COPIADO') {
    if (!button) return;
    const original = button.innerHTML;
    try {
        await writeTextToClipboard(text);
        button.innerHTML = `<i class="ph ph-check"></i> ${doneText}`;
    } catch (error) {
        console.warn('Falha ao copiar doacao:', error);
        button.innerHTML = '<i class="ph ph-warning"></i> FALHOU';
    }
    setTimeout(() => { button.innerHTML = original; }, 1600);
}

async function openLivePixDonation(source = 'donation-panel') {
    const clicks = Number(localStorage.getItem('fluxo_donation_clicks') || 0) + 1;
    localStorage.setItem('fluxo_donation_clicks', String(clicks));

    try {
        if (window.electronAPI?.openExternalUrl) {
            await window.electronAPI.openExternalUrl(LIVEPIX_DONATION_URL);
        } else {
            window.open(LIVEPIX_DONATION_URL, '_blank', 'noopener,noreferrer');
        }
    } catch (error) {
        console.warn(`Falha ao abrir LivePix (${source}):`, error);
        window.open(LIVEPIX_DONATION_URL, '_blank', 'noopener,noreferrer');
    }

    const counter = document.getElementById('donationOpenCounter');
    if (counter) counter.innerText = `${clicks} aberturas locais`;
}

function getStoredLivePixDonors() {
    try {
        return JSON.parse(localStorage.getItem('fluxo_livepix_donors') || '[]')
            .map(item => typeof item === 'string' ? { name: item } : item)
            .map(item => ({ name: String(item?.name || item?.donor || item?.username || '').trim() }))
            .filter(item => item.name)
            .slice(0, 12);
    } catch {
        return [];
    }
}

function renderLivePixDonorList(donors = getStoredLivePixDonors()) {
    const list = document.getElementById('livePixDonorList');
    if (!list) return;
    list.innerHTML = donors.length
        ? donors.map((donor, index) => `
            <div class="donation-donor-row">
                <span>${index + 1}</span>
                <strong>${escapeHtml(donor.name)}</strong>
            </div>
        `).join('')
        : '<div class="donation-donor-empty">Aguardando integracao automatica de doadores.</div>';
}

function renderDonationsPanel() {
    panelTitle.innerText = 'APOIAR O FLUXO';
    queueCounter.innerText = 'LivePix';
    const clicks = Number(localStorage.getItem('fluxo_donation_clicks') || 0);
    const shareText = `Eu apoio o Fluxo Music: ${LIVEPIX_DONATION_URL}`;

    resultsList.innerHTML = `
        <li class="donation-root">
            <section class="donation-hero">
                <div class="donation-hero-copy">
                    <span class="donation-kicker">Renda principal do projeto</span>
                    <h2>Ajude o Fluxo a continuar vivo, bonito e atualizando.</h2>
                    <p>Doacoes pelo LivePix ajudam a bancar tempo de desenvolvimento, manutencao do player, testes de busca, releases e lapidacao dos temas.</p>
                    <div class="donation-actions">
                        <button class="btn-confirm donation-primary" id="btnOpenLivePix"><i class="ph ph-hand-heart"></i> DOAR PELO LIVEPIX</button>
                        <button class="btn-action" id="btnCopyLivePix"><i class="ph ph-copy"></i> COPIAR LINK</button>
                    </div>
                    <div class="donation-link-pill">
                        <i class="ph ph-link-simple"></i>
                        <span>${escapeHtml(LIVEPIX_DONATION_URL.replace(/^https?:\/\//, ''))}</span>
                    </div>
                </div>
                <div class="donation-qr-card">
                    <div class="donation-qr-wrap">
                        <iframe
                            src="${LIVEPIX_WIDGET_URL}"
                            title="Widget LivePix Fluxo"
                            loading="lazy"
                            referrerpolicy="no-referrer"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                        ></iframe>
                    </div>
                    <strong>Widget oficial do LivePix</strong>
                    <span id="donationOpenCounter">${clicks} aberturas locais</span>
                </div>
            </section>

            <section class="donation-grid">
                <article class="donation-card donation-card-highlight">
                    <i class="ph ph-rocket-launch"></i>
                    <h3>O que a doacao financia</h3>
                    <p>Correcoes de busca, updater, Discord RPC, suporte a YouTube/SoundCloud, polimento dos temas e novas funcoes sem o projeto virar abandonware.</p>
                </article>
                <article class="donation-card">
                    <i class="ph ph-shield-check"></i>
                    <h3>Seguro para o usuario</h3>
                    <p>O Fluxo abre apenas a pagina publica do LivePix. Nenhum segredo, token privado ou credencial de pagamento fica salvo dentro do app.</p>
                </article>
                <article class="donation-card">
                    <i class="ph ph-megaphone"></i>
                    <h3>Ajuda sem dinheiro</h3>
                    <p>Compartilhar o link, indicar o Fluxo e mandar feedback bom tambem sustenta o projeto.</p>
                    <button class="btn-action" id="btnCopyDonationShare"><i class="ph ph-share-network"></i> COPIAR MENSAGEM</button>
                </article>
            </section>

            <section class="donation-donors-card">
                <div class="donation-donors-head">
                    <div>
                        <span>Ultimos apoiadores</span>
                        <strong>Doadores recentes</strong>
                    </div>
                </div>
                <div id="livePixDonorList" class="donation-donor-list"></div>
                <p class="donation-donor-note">A lista sera alimentada por integracao automatica quando estiver disponivel.</p>
            </section>

            <section class="donation-trust">
                <div>
                    <span>ID publico LivePix</span>
                    <strong>${escapeHtml(LIVEPIX_PUBLIC_ID)}</strong>
                </div>
                <button class="btn-action" id="btnCopyLivePixId"><i class="ph ph-identification-card"></i> COPIAR ID</button>
            </section>
        </li>
    `;

    document.getElementById('btnOpenLivePix')?.addEventListener('click', () => openLivePixDonation('primary'));
    document.getElementById('btnCopyLivePix')?.addEventListener('click', (event) => copyDonationText(LIVEPIX_DONATION_URL, event.currentTarget));
    document.getElementById('btnCopyDonationShare')?.addEventListener('click', (event) => copyDonationText(shareText, event.currentTarget, 'MENSAGEM COPIADA'));
    document.getElementById('btnCopyLivePixId')?.addEventListener('click', (event) => copyDonationText(LIVEPIX_PUBLIC_ID, event.currentTarget, 'ID COPIADO'));
    renderLivePixDonorList();
}

function renderChangelog() {
    panelTitle.innerText = 'CHANGELOG DO FLUXO';
    queueCounter.innerText = 'v3.9.30';
    resultsList.innerHTML = `
        <li class="changelog-root">
            <section class="changelog-hero">
                <div class="changelog-hero-icon"><i class="ph ph-scroll"></i></div>
                <div>
                    <span class="changelog-kicker">Historico de mudancas</span>
                    <h2>Fluxo Music 3.9.30</h2>
                    <p>Resumo das mudancas recentes do player, interface, updater, Discord RPC, busca, temas e recursos principais.</p>
                </div>
                <button class="btn-confirm changelog-copy" id="btnCopyChangelog"><i class="ph ph-copy"></i> COPIAR</button>
            </section>
            <section class="changelog-grid">
                ${FLUXO_CHANGELOG.map(entry => `
                    <article class="changelog-card">
                        <div class="changelog-card-head">
                            <div>
                                <span class="changelog-version">${escapeHtml(entry.version)}</span>
                                <h3>${escapeHtml(entry.title)}</h3>
                            </div>
                            <span class="changelog-badge">${escapeHtml(entry.badge)}</span>
                        </div>
                        <span class="changelog-date">${escapeHtml(entry.date)}</span>
                        <ul>
                            ${entry.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </article>
                `).join('')}
            </section>
        </li>
    `;

    const copyBtn = document.getElementById('btnCopyChangelog');
    if (copyBtn) {
        copyBtn.onclick = async () => {
            const original = copyBtn.innerHTML;
            try {
                await navigator.clipboard.writeText(flattenChangelogText());
                copyBtn.innerHTML = '<i class="ph ph-check"></i> COPIADO';
            } catch (err) {
                console.warn('Falha ao copiar changelog:', err);
                copyBtn.innerHTML = '<i class="ph ph-warning"></i> FALHOU';
            }
            setTimeout(() => { copyBtn.innerHTML = original; }, 1600);
        };
    }
}

async function openChangelogAfterUpdateIfNeeded() {
    if (!window.electronAPI?.getAppInfo) return;

    try {
        const info = await window.electronAPI.getAppInfo();
        const args = Array.isArray(info?.argv) ? info.argv.join(' ') : '';
        const updated = /\b--updated\b|\bupdated\b/i.test(args);
        const marker = `fluxo_seen_update_${info?.version || 'dev'}`;

        if (updated && localStorage.getItem(marker) !== 'true') {
            localStorage.setItem(marker, 'true');
            setTimeout(() => {
                document.getElementById('btnChangelog')?.click();
            }, 650);
        }
    } catch (error) {
        console.warn('Nao foi possivel verificar abertura pos-update:', error);
    }
}

function renderThemes() {
    panelTitle.innerText = "SISTEMA OS: SELEÇÃO DE INTERFACE";
    queueCounter.innerText = "";
    const previousFilter = document.getElementById('themeSearchInput')?.value || '';
    resultsList.innerHTML = `
        <li class="theme-search-row">
            <div class="theme-search-box">
                <i class="ph ph-magnifying-glass"></i>
                <input id="themeSearchInput" class="inline-input theme-search-input" value="${escapeHtml(previousFilter)}" placeholder="Buscar tema por nome, obra, estilo ou cor...">
                <span id="themeSearchCount" class="theme-search-count"></span>
            </div>
        </li>
    `;

    const themes = [
        { id: 'default', name: 'Cyber Deck', desc: 'Neon Cyan & Pink. Poligonal, afiado e hacker.' },
        { id: 'galaxy', name: 'Galáxia (Glass)', desc: 'Vidro embaçado, flutuante, tons de nebulosa.' },
        { id: 'bw', name: 'Terminal Grafite', desc: 'Terminal em fio e cinzas frios. Preciso e técnico.' },
        { id: 'pipboy', name: 'RobCo Terminal', desc: 'Simulação CRT verde animada. Foco em dados.' },
        { id: 'blood', name: 'Blood Dragon', desc: 'Vermelho e preto. Chanfros, glitch e agressividade.' },
        { id: 'gold', name: 'Deus Ex (Cyberpunk)', desc: 'Preto e Ouro. Alto contraste, chanfros corporativos.' },
        { id: 'nightcity', name: 'Night City', desc: 'Amarelo estourado e preto. Estilo 2077.' },
        { id: 'ocean', name: 'Deep Ocean', desc: 'Ilhas flutuantes azuis que respiram. Calmo.' },
        { id: 'matrix', name: 'Hacker Matrix', desc: 'Código verde puro no terminal. Sem imagens.' },
        { id: 'tron', name: 'Tron Grid', desc: 'Perspectiva 3D synthwave escuro com neons.' },
        { id: 'glasslight', name: 'Neumorphism Light', desc: 'Branco fosco, clean, com sombras muito suaves.' },
        { id: 'minimal', name: 'Minimal Dark', desc: 'Preto absoluto. Sem bordas grosas, foco no disco.' },
        { id: 'gruvbox', name: 'Gruvbox', desc: 'O clássico de Devs. Tons pastéis, areia e quente.' },
        { id: 'nord', name: 'Nord (Ártico)', desc: 'Azul gelo, cinza profundo. Calmo e técnico.' },
        { id: 'kawaii', name: 'Kawaii Pop', desc: 'Rosa pastel, fofo, bordas arredondadas e pontilhadas.' },
        { id: 'dracula', name: 'Dracula Dark', desc: 'O clássico tema de código. Elegante, roxo e escuro.' },
        { id: 'blueprint', name: 'Engenharia CAD', desc: 'Planta baixa de engenharia, grade e linhas brancas.' },
        { id: 'arcade', name: 'Arcade 80s', desc: 'Neon puro, vibrante, lembrando fliperamas clássicos.' },
        { id: 'cafe', name: 'Cozy Café', desc: 'Tons terrosos, madeira e café. Quente e relaxante.' },
        { id: 'cybersec', name: 'Kali CyberSec', desc: 'Azul noturno, técnico, focado em painéis táticos.' },
        { id: 'aero', name: 'Frutiger Aero', desc: 'Anos 2000, botões glossy de vidro, azul e verde.' },
        { id: 'raiden', name: 'MGR: Jack the Ripper', desc: 'Ciano elétrico, cortes poligonais e aço.' },
        { id: 'sam', name: 'MGR: Jetstream Sam', desc: 'Elegância Samurai em Carmesim e Ouro.' },
        { id: 'armstrong', name: 'MGR: Senator Armstrong', desc: 'Nanomachines, asfalto pesado e fogo.' },
        { id: 'tensura', name: 'Tensura (Rimuru)', desc: 'Slime azul, bordas extremamente arredondadas, aura mágica e UI fluida.' },
        { id: 'halinhu', name: 'Halinhu', desc: 'Conjuração Isekai: Paineis Grimório flutuantes, Aura Ouro e Roxo, UI RPG de Status.' },
        { id: 'manga', name: 'Manga Edition', desc: 'Isekai HQ: UI Cel-Shaded desenhada à mão, fontes pretas, Círculos Mágicos.' },
        { id: 'synthwave', name: 'Synthwave Retrowave', desc: 'Sol poente, grid roxo e letreiros neon.' },
        { id: 'lua', name: 'Patas da Lua', desc: 'Confortável e macio. Tons pastéis, pelos brancos e pelagem mista.' },
        { id: 'ophiuchus', name: 'Constelação Ophiuchus', desc: 'O 13º signo cravado na pele e nas estrelas. Neon cósmico.' },
        { id: 'darkbrotherhood', name: 'Dark Brotherhood', desc: 'Santuário de contrato: mão negra, veludo, prata e sangue ritual.' },
        { id: 'orokin', name: 'Orokin Cell', desc: 'Luxo marfim e decorações em ouro direto do Void.' },
        { id: 'morioh', name: 'Morioh-Cho Radio', desc: 'Céu amarelo bizarro, painéis rosa choque e clima de verão.' },
        { id: 'error', name: 'Fatal Error', desc: 'Crash lab premium: diagnóstico, tela azul profunda e painéis de kernel.' },
        { id: 'excalibur', name: 'Dark Excalibur', desc: 'Metal escuro, cortes de armadura e energia Void ciano e roxo.' },
        { id: 'souleater', name: 'Soul Eater', desc: 'Manga gotico torto: lua amarela, vermelho sangue, paineis assimetricos e energia cartoon sombria.' },
        { id: 'adolla', name: 'Adolla (Fire Force)', desc: 'Interface Adolla: chamas pretas e brancas, fuligem, brilho frio e sinais de brigada.' },
        { id: 'minecraft', name: 'Minecraft', desc: 'Crafting Table OS: inventário, blocos cúbicos, hotbar e pixel art limpa.' },
        { id: 'terraria', name: 'Terraria RPG', desc: 'Madeira rica, pedra esculpida e poções mágicas com visual de aventura.' },
        { id: 'eldenring', name: 'Elden Ring', desc: 'Runas douradas, pedra antiga, boss fog e altar de status.' },
        { id: 'persona5', name: 'Persona 5', desc: 'Phantom UI: recortes agressivos, vermelho, preto e branco editorial.' },
        { id: 'hollowknight', name: 'Hollow Knight', desc: 'Máscara vazia, caverna azul fria, linhas finas e silêncio elegante.' },
        { id: 'zelda', name: 'Zelda Ancient', desc: 'Tecnologia Sheikah: pedra escura, circuitos azuis e brilho âmbar.' },
        { id: 'onepiece', name: 'One Piece Log Pose', desc: 'Mapa marítimo, bússola, cordame e painel de convés.' },
        { id: 'naruto', name: 'Naruto Chakra', desc: 'Pergaminhos ninja, selos, chakra laranja e azul disciplinado.' },
        { id: 'jujutsu', name: 'Jujutsu Kaisen', desc: 'Talismãs, energia amaldiçoada violeta e UI de barreira.' },
        { id: 'aot', name: 'Attack on Titan', desc: 'Dossiê militar, muralhas, couro verde e relatórios táticos.' },
        { id: 'evangelion', name: 'Evangelion NERV', desc: 'HUD NERV angular, alertas MAGI e contraste verde-laranja.' },
        { id: 'undertale', name: 'Undertale Battle', desc: 'Caixa de batalha, coração vermelho, tipografia mono e preto puro.' },
        { id: 'fluxobug', name: 'Fluxo Bug', desc: 'Sátira interna: painel de crash bonito, TODOs falsos, alertas tortos e caos controlado.' }
    ];

    const normalizeThemeFilter = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const renderThemeResults = () => {
        const query = normalizeThemeFilter(document.getElementById('themeSearchInput')?.value || '');
        const activeTheme = localStorage.getItem('fluxo_theme') || 'default';

        resultsList.querySelectorAll('.theme-result-item, .theme-empty-result').forEach(item => item.remove());
        const filteredThemes = themes.filter(theme => {
            const haystack = normalizeThemeFilter(`${theme.id} ${theme.name} ${theme.desc}`);
            return !query || haystack.includes(query);
        });

        const counter = document.getElementById('themeSearchCount');
        if (counter) counter.innerText = `${filteredThemes.length}/${themes.length}`;

        if (!filteredThemes.length) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'theme-empty-result';
            emptyLi.innerHTML = '<span>Nenhum tema encontrado.</span>';
            resultsList.appendChild(emptyLi);
            return;
        }

        filteredThemes.forEach(theme => {
            const li = document.createElement('li');
            li.className = 'result-item theme-result-item';
            li.dataset.themeId = theme.id;
            const isActive = activeTheme === theme.id;
            li.innerHTML = `
                <div class="result-thumb" style="background-color: var(--bg-panel); color: var(--neon-cyan); border: var(--border-tech); font-size: 1.5rem;">
                    <i class="ph ${isActive ? 'ph-star' : 'ph-palette'}"></i>
                </div>
                <div class="result-info" style="flex: 1;">
                    <span class="result-title" style="color: var(--neon-cyan);">${escapeHtml(theme.name)}</span>
                    <span class="result-artist">${escapeHtml(theme.desc)}</span>
                </div>
            `;
            li.addEventListener('click', () => {
                applyThemeClass(theme.id);
                localStorage.setItem('fluxo_theme', theme.id);
                updateNowPlayingWidget();
                renderThemeResults();
            });
            resultsList.appendChild(li);
        });
    };

    const themeSearchInput = document.getElementById('themeSearchInput');
    themeSearchInput?.addEventListener('input', renderThemeResults);
    themeSearchInput?.addEventListener('keydown', (event) => event.stopPropagation());
    renderThemeResults();
}

// ========================================================
// VARIÁVEIS DO PLAYER E AUDIO CORE (AGORA COM VÍDEO)
// ========================================================
// Em vez de new Audio(), criamos um elemento de vídeo
const audioPlayer = document.createElement('video'); 
audioPlayer.id = 'mainVideoPlayer';
audioPlayer.preload = 'auto'; 
audioPlayer.crossOrigin = "anonymous";  

// Injetamos o vídeo no container que criamos no HTML
document.getElementById('videoContainer').appendChild(audioPlayer);

audioPlayer.addEventListener('play', () => document.body.classList.remove('is-paused'));
audioPlayer.addEventListener('pause', () => document.body.classList.add('is-paused'));
const previewPlayer = new Audio(); 
previewPlayer.preload = 'auto';
let mainHlsController = null;
let previewHlsController = null;

function isHlsStreamUrl(url) {
    return /\.m3u8(?:$|[?#])/i.test(String(url || ''));
}

function destroyHlsController(slot = 'main') {
    const current = slot === 'preview' ? previewHlsController : mainHlsController;
    if (current) {
        try { current.destroy(); } catch {}
    }
    if (slot === 'preview') previewHlsController = null;
    else mainHlsController = null;
}

function setMediaElementSource(mediaElement, url, slot = 'main') {
    destroyHlsController(slot);

    if (isHlsStreamUrl(url) && window.Hls?.isSupported?.()) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90
        });
        if (slot === 'preview') previewHlsController = hls;
        else mainHlsController = hls;

        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data?.fatal) {
                console.log('Erro fatal HLS:', data);
                destroyHlsController(slot);
            }
        });
        hls.loadSource(url);
        hls.attachMedia(mediaElement);
        return;
    }

    mediaElement.src = url;
    mediaElement.load();
}

let queue = [], originalQueue = [], currentIndex = 0, isShuffled = false, loopMode = 0; 
let playHistory = JSON.parse(localStorage.getItem('fluxo_history')) || [];
let isAutoMix = false;
let autoMixSeedTrack = null;
let isCrossfade = false;
let crossfadeTriggered = false;
let isSmoothTransitioning = false;
let autoMixRequestInFlight = null;
let savedPlaylists = JSON.parse(localStorage.getItem('fluxo_playlists')) || [];
let playlistTrash = readStoredArray('fluxo_playlist_trash');
let favoriteTracks = readStoredArray('fluxo_favorites').map(normalizeTrack).filter(Boolean);
let queueTabs = readStoredArray('fluxo_queue_tabs');
let activeQueueTabId = localStorage.getItem('fluxo_active_queue_tab') || '';
let isLibraryCompact = localStorage.getItem('fluxo_library_compact') === 'true';
let isBpmTransitionEnabled = localStorage.getItem('fluxo_bpm_transition') === 'true';
let isFocusModeEnabled = localStorage.getItem('fluxo_focus_mode') === 'true';
let djPreviewVolume = clampNumber(localStorage.getItem('fluxo_dj_preview_volume'), 0, 1, 0.35);
let djDeckBIndex = Number(localStorage.getItem('fluxo_dj_deck_b_index') || 1);
let lastWidgetUpdateAt = 0;
let lastAdaptivePreloadAt = 0;
let adaptivePreloadMode = localStorage.getItem('fluxo_adaptive_preload') || 'balanced';
let isPodcastMode = localStorage.getItem('fluxo_podcast_mode') === 'true';
let miniPlayerVariant = localStorage.getItem('fluxo_mini_variant') || 'horizontal';
if (!['compact', 'horizontal', 'cinema'].includes(miniPlayerVariant)) miniPlayerVariant = 'horizontal';
let isMiniPlayerActive = false;
let isAmbientMode = localStorage.getItem('fluxo_ambient_mode') === 'true';
let trackComments = readStoredObject('fluxo_track_comments');
let musicAutomations = readStoredArray('fluxo_music_automations');
let trackInbox = readStoredArray('fluxo_music_inbox').map(normalizeTrack).filter(Boolean);
let trackAnalysis = readStoredObject('fluxo_track_analysis');
let mediaIssues = readStoredArray('fluxo_media_issues');
let automationRunMemory = {};
let autoMixMemory = JSON.parse(localStorage.getItem('fluxo_automix_memory') || '[]');
let achievementState = readStoredObject('fluxo_achievements');
let fluxoStats = {
    tracksPlayed: 0,
    playlistsSaved: 0,
    sessionsCreated: 0,
    sessionsJoined: 0,
    sleepTimersUsed: 0,
    ...readStoredObject('fluxo_stats')
};
savedPlaylists = savedPlaylists.map(pl => ({
    title: pl.title || pl.name || 'Playlist',
    cover: pl.cover || '',
    locked: Boolean(pl.locked),
    tracks: (Array.isArray(pl.tracks) ? pl.tracks : []).map(normalizeTrack).filter(Boolean)
}));

const titleEl = document.getElementById('title'), artistEl = document.getElementById('artist'), coverEl = document.getElementById('cover');
const progressFill = document.getElementById('progressFill'), playPauseBtn = document.getElementById('playPauseBtn');
const searchInput = document.getElementById('searchInput'), btnSearch = document.getElementById('btnSearch'), resultsList = document.getElementById('resultsList');
const panelTitle = document.getElementById('panelTitle'), queueCounter = document.getElementById('queueCounter');
const coverIcon = document.getElementById('coverIcon');
const timelineWaveform = document.getElementById('timelineWaveform');

if (isFocusModeEnabled) document.body.classList.add('focus-mode');
document.body.classList.toggle('podcast-mode', isPodcastMode);
document.body.classList.toggle('ambient-mode', isAmbientMode);
document.body.classList.add(`mini-${miniPlayerVariant}`);

function readStoredArray(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function readStoredObject(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function savePlaylists() {
    localStorage.setItem('fluxo_playlists', JSON.stringify(savedPlaylists));
}

function savePlaylistTrash() {
    localStorage.setItem('fluxo_playlist_trash', JSON.stringify(playlistTrash));
}

function saveFavorites() {
    localStorage.setItem('fluxo_favorites', JSON.stringify(favoriteTracks));
}

function saveQueueTabs() {
    localStorage.setItem('fluxo_queue_tabs', JSON.stringify(queueTabs));
    localStorage.setItem('fluxo_active_queue_tab', activeQueueTabId);
}

function saveTrackComments() {
    localStorage.setItem('fluxo_track_comments', JSON.stringify(trackComments));
}

function saveMusicAutomations() {
    localStorage.setItem('fluxo_music_automations', JSON.stringify(musicAutomations));
}

function saveTrackInbox() {
    localStorage.setItem('fluxo_music_inbox', JSON.stringify(trackInbox));
}

function saveTrackAnalysis() {
    localStorage.setItem('fluxo_track_analysis', JSON.stringify(trackAnalysis));
}

function saveMediaIssues() {
    localStorage.setItem('fluxo_media_issues', JSON.stringify(mediaIssues));
}

function saveFluxoStats() {
    localStorage.setItem('fluxo_stats', JSON.stringify(fluxoStats));
}

function saveAchievements() {
    localStorage.setItem('fluxo_achievements', JSON.stringify(achievementState));
}

const FLUXO_ACHIEVEMENTS = [
    { id: 'firstPlay', title: 'Primeiro play', desc: 'Tocou a primeira musica no Fluxo.', icon: 'ph-play-circle' },
    { id: 'tenTracks', title: 'Aquecendo', desc: 'Ouviu 10 musicas.', icon: 'ph-fire' },
    { id: 'hundredTracks', title: 'Modo vicio', desc: 'Ouviu 100 musicas.', icon: 'ph-infinity' },
    { id: 'playlistSaved', title: 'Curador', desc: 'Salvou uma playlist ou fila.', icon: 'ph-list-plus' },
    { id: 'sessionHost', title: 'Host da noite', desc: 'Criou uma sessao compartilhada.', icon: 'ph-crown-simple' },
    { id: 'sessionGuest', title: 'Entrou no bonde', desc: 'Entrou em uma sessao compartilhada.', icon: 'ph-users-three' },
    { id: 'sessionReplay', title: 'Replay eterno', desc: 'Salvou o replay de uma sessao.', icon: 'ph-repeat' },
    { id: 'sleepTimer', title: 'Boa noite', desc: 'Ativou o sleep timer.', icon: 'ph-moon-stars' },
    { id: 'libraryDoctor', title: 'Biblioteca limpa', desc: 'Rodou o diagnostico inteligente da biblioteca.', icon: 'ph-stethoscope' }
];

function unlockAchievement(id) {
    if (!id || achievementState[id]) return false;
    const achievement = FLUXO_ACHIEVEMENTS.find(item => item.id === id);
    if (!achievement) return false;
    achievementState[id] = { unlockedAt: Date.now() };
    saveAchievements();
    if (Notification.permission === 'granted') {
        new Notification('Conquista desbloqueada', { body: `${achievement.title} - ${achievement.desc}` });
    }
    return true;
}

function updateAchievementProgress(event = '') {
    if (event === 'trackPlayed') {
        fluxoStats.tracksPlayed = Number(fluxoStats.tracksPlayed || 0) + 1;
        unlockAchievement('firstPlay');
        if (fluxoStats.tracksPlayed >= 10) unlockAchievement('tenTracks');
        if (fluxoStats.tracksPlayed >= 100) unlockAchievement('hundredTracks');
    }
    if (event === 'playlistSaved') {
        fluxoStats.playlistsSaved = Number(fluxoStats.playlistsSaved || 0) + 1;
        unlockAchievement('playlistSaved');
    }
    if (event === 'sessionHost') {
        fluxoStats.sessionsCreated = Number(fluxoStats.sessionsCreated || 0) + 1;
        unlockAchievement('sessionHost');
    }
    if (event === 'sessionGuest') {
        fluxoStats.sessionsJoined = Number(fluxoStats.sessionsJoined || 0) + 1;
        unlockAchievement('sessionGuest');
    }
    if (event === 'sleepTimer') {
        fluxoStats.sleepTimersUsed = Number(fluxoStats.sleepTimersUsed || 0) + 1;
        unlockAchievement('sleepTimer');
    }
    saveFluxoStats();
}

function renderAchievementsPanel() {
    panelTitle.innerText = 'CONQUISTAS DO FLUXO';
    queueCounter.innerText = `${Object.keys(achievementState).length}/${FLUXO_ACHIEVEMENTS.length}`;
    resultsList.innerHTML = `
        <li class="achievement-shell">
            <section class="achievement-hero">
                <div>
                    <span class="changelog-kicker">Perfil local</span>
                    <h3>${Object.keys(achievementState).length} conquistas desbloqueadas</h3>
                    <p>${Number(fluxoStats.tracksPlayed || 0)} musicas tocadas, ${Number(fluxoStats.playlistsSaved || 0)} playlists salvas e ${Number(fluxoStats.sessionsCreated || 0) + Number(fluxoStats.sessionsJoined || 0)} sessoes usadas.</p>
                </div>
                <button class="btn-action" id="btnBackFromAchievements"><i class="ph ph-arrow-left"></i> VOLTAR</button>
            </section>
            <section class="achievement-grid">
                ${FLUXO_ACHIEVEMENTS.map(item => {
                    const unlocked = achievementState[item.id];
                    return `
                        <article class="achievement-card ${unlocked ? 'unlocked' : ''}">
                            <i class="ph ${item.icon}"></i>
                            <strong>${escapeHtml(item.title)}</strong>
                            <span>${escapeHtml(item.desc)}</span>
                            <small>${unlocked ? new Date(unlocked.unlockedAt).toLocaleString('pt-BR') : 'Bloqueada'}</small>
                        </article>
                    `;
                }).join('')}
            </section>
        </li>
    `;
    document.getElementById('btnBackFromAchievements').onclick = renderFluxoLab;
}

function setMiniPlayerVariant(variant) {
    const allowed = new Set(['compact', 'horizontal', 'cinema']);
    miniPlayerVariant = allowed.has(variant) ? variant : 'horizontal';
    document.body.classList.remove('mini-compact', 'mini-horizontal', 'mini-cinema');
    document.body.classList.add(`mini-${miniPlayerVariant}`);
    localStorage.setItem('fluxo_mini_variant', miniPlayerVariant);
    syncMiniVariantButtons();
}

function syncMiniVariantButtons() {
    const buttons = {
        compact: document.getElementById('btnMiniCompact'),
        horizontal: document.getElementById('btnMiniHorizontal'),
        cinema: document.getElementById('btnMiniCinema')
    };

    Object.entries(buttons).forEach(([variant, button]) => {
        if (!button) return;
        const active = miniPlayerVariant === variant;
        button.classList.toggle('active', active);
        button.classList.toggle('active-pink', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

function enterMiniPlayer(variant = miniPlayerVariant) {
    if (variant) setMiniPlayerVariant(variant);
    isMiniPlayerActive = true;
    document.body.classList.add('mini-mode');
    setVideoModeEnabled(isVideoMode);
    window.electronAPI?.toggleMiniPlayer?.(true);
}

function exitMiniPlayer() {
    isMiniPlayerActive = false;
    document.body.classList.remove('mini-mode');
    setVideoModeEnabled(isVideoMode);
    window.electronAPI?.toggleMiniPlayer?.(false);
}

function toggleMiniPlayerMode() {
    if (document.body.classList.contains('mini-mode') || isMiniPlayerActive) {
        exitMiniPlayer();
    } else {
        enterMiniPlayer();
    }
}

function resetCompactModes() {
    setMiniPlayerVariant('horizontal');
    isLibraryCompact = false;
    localStorage.setItem('fluxo_library_compact', 'false');
}

async function runRecoveryMode() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
    } catch {}

    try {
        exitMiniPlayer();
    } catch {
        document.body.classList.remove('mini-mode');
        window.electronAPI?.toggleMiniPlayer?.(false);
    }

    document.body.classList.remove('party-mode', 'focus-mode', 'ambient-mode', 'podcast-mode', 'pip-active', 'video-mode');
    document.querySelectorAll('.pl-dropdown').forEach(drop => drop.remove());
    closeGlobalSearchOverlay?.();
    resetCompactModes();
    setAmbientMode(false);
    setPodcastMode(false);
    localStorage.setItem('fluxo_focus_mode', 'false');
    localStorage.setItem('fluxo_theme', 'default');
    applyThemeClass('default');

    if (typeof setVideoUiState === 'function') {
        setVideoUiState(false);
    } else {
        setVideoModeEnabled(false);
    }

    if (typeof restoreFloatingVideo === 'function' && typeof isVideoMode !== 'undefined') {
        try { restoreFloatingVideo(); } catch {}
    }

    isPinned = false;
    window.electronAPI?.toggleAlwaysOnTop?.(false);
    document.getElementById('btnQueueView')?.click();
    updateNowPlayingWidget();
}

function setAmbientMode(enabled) {
    isAmbientMode = Boolean(enabled);
    document.body.classList.toggle('ambient-mode', isAmbientMode);
    localStorage.setItem('fluxo_ambient_mode', String(isAmbientMode));
}

function setPodcastMode(enabled, persist = true) {
    isPodcastMode = Boolean(enabled);
    document.body.classList.toggle('podcast-mode', isPodcastMode);
    if (persist) localStorage.setItem('fluxo_podcast_mode', String(isPodcastMode));

    if (isPodcastMode) {
        initEQ();
        applyEqPreset('vocal', true);
        setPitchPreserve(true, true);
        setReverbMix(0.04, true);
        setPlaybackRate(1, true);
    }
}

function getCurrentTrackCommentBucket(track = queue[currentIndex]) {
    const key = getTrackKey(track);
    if (!key) return [];
    if (!Array.isArray(trackComments[key])) trackComments[key] = [];
    return trackComments[key];
}

function addTrackComment(track, text) {
    const key = getTrackKey(track);
    const value = String(text || '').trim();
    if (!key || !value) return false;
    if (!Array.isArray(trackComments[key])) trackComments[key] = [];
    trackComments[key].unshift({
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: value.slice(0, 900),
        createdAt: Date.now()
    });
    saveTrackComments();
    return true;
}

function deleteTrackComment(track, commentId) {
    const key = getTrackKey(track);
    if (!key || !Array.isArray(trackComments[key])) return;
    trackComments[key] = trackComments[key].filter(comment => comment.id !== commentId);
    if (!trackComments[key].length) delete trackComments[key];
    saveTrackComments();
}

function getTrackKey(track) {
    const normalized = normalizeTrack(track);
    if (!normalized) return '';
    return normalized.videoId || normalized.id || normalized.url || getTrackFingerprint(normalized);
}

function addToMusicInbox(track, source = 'manual') {
    const normalized = normalizeTrack(track);
    const key = getTrackKey(normalized);
    if (!normalized || !key) return false;

    trackInbox = [
        {
            ...normalized,
            inboxSource: source,
            inboxAddedAt: Date.now()
        },
        ...trackInbox.filter(item => getTrackKey(item) !== key)
    ].slice(0, 200);
    saveTrackInbox();
    return true;
}

function removeFromMusicInbox(track) {
    const key = getTrackKey(track);
    if (!key) return;
    trackInbox = trackInbox.filter(item => getTrackKey(item) !== key);
    saveTrackInbox();
}

const MUSIC_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function stableHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
}

function estimateTrackKey(track) {
    const explicit = track?.musicalKey || track?.key;
    if (explicit) return String(explicit).slice(0, 12);
    const haystack = normalizeLookupText(`${track?.title || ''} ${track?.artist || ''}`);
    const keyMatch = haystack.match(/\b([a-g](?:#|b)?)[\s_-]?(major|minor|maj|min|maior|menor)\b/i);
    if (keyMatch) {
        const root = keyMatch[1].replace(/^./, char => char.toUpperCase());
        const mode = /minor|min|menor/i.test(keyMatch[2]) ? 'min' : 'maj';
        return `${root} ${mode}`;
    }
    const hash = stableHash(getTrackFingerprint(track) || getTrackKey(track));
    const root = MUSIC_KEYS[hash % MUSIC_KEYS.length];
    const mode = ((hash >> 4) % 10) < 6 ? 'min' : 'maj';
    return `${root} ${mode}`;
}

function getTrackMusicAnalysis(track, force = false) {
    const normalized = normalizeTrack(track);
    const key = getTrackKey(normalized);
    if (!normalized || !key) return null;
    if (!force && trackAnalysis[key]) return trackAnalysis[key];

    const bpm = estimateTrackBpm(normalized);
    const musicalKey = estimateTrackKey(normalized);
    const haystack = normalizeLookupText(`${normalized.title} ${normalized.artist}`);
    const confidence = /\b(bpm|key|major|minor|maj|min|nightcore|sped up|slowed|phonk|lofi|dnb|hardstyle)\b/.test(haystack) ? 'media' : 'estimada';
    const analysis = {
        bpm,
        key: musicalKey,
        energy: bpm >= 145 ? 'alta' : (bpm <= 95 ? 'baixa' : 'media'),
        confidence,
        source: 'heuristica local',
        updatedAt: Date.now()
    };

    trackAnalysis[key] = analysis;
    saveTrackAnalysis();
    return analysis;
}

function classifyMediaError(error, fallback = 'Falha ao carregar a midia.') {
    const message = String(error?.reason || error?.message || error?.stderr || error || '').toLowerCase();
    if (message.includes('drm')) return 'Midia protegida por DRM. O YouTube nao libera stream tocavel.';
    if (message.includes('private')) return 'Video privado ou inacessivel.';
    if (message.includes('unavailable') || message.includes('not available') || message.includes('indisponivel')) return 'Video indisponivel, bloqueado por regiao ou removido.';
    if (message.includes('sign in') || message.includes('age')) return 'Video bloqueado por login, idade ou restricao regional.';
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) return 'Falha de rede ao resolver a midia.';
    if (message.includes('stream')) return 'Nao foi possivel gerar um stream tocavel para essa faixa.';
    return fallback;
}

async function resolvePlayableStreamForTrack(track, preferredMode = 'audio', options = {}) {
    if (!window.electronAPI?.getStreamUrl) throw new Error('Motor de stream indisponivel.');

    const normalized = normalizeTrack(track);
    const trackId = getTrackStreamId(normalized);
    if (!trackId) throw new Error('Faixa sem identificador de stream.');

    const modes = preferredMode === 'audio' ? ['audio'] : [preferredMode, 'audio'];
    const triedKeys = new Set();
    let lastError = null;

    for (const mode of modes) {
        const key = `${trackId}::${mode}`;
        if (triedKeys.has(key)) continue;
        triedKeys.add(key);

        try {
            const resolved = await resolveTrackStreamCached(normalized, mode, { forceRefresh: Boolean(options.forceRefresh) });
            const url = resolved?.url;
            if (url) return { url, mode: resolved?.quality || mode, track: normalized, target: resolved?.target || trackId, source: resolved?.source || 'direct' };
            throw new Error('Stream indisponivel.');
        } catch (error) {
            lastError = error;
            if (mode !== 'audio') {
                console.log('Video indisponivel, tentando audio:', error.message || error);
            }
        }
    }

    throw lastError || new Error('Nao foi possivel gerar stream para essa faixa.');
}

function recordMediaIssue(track, reason, context = 'audio', details = {}) {
    const normalized = normalizeTrack(track);
    const issue = {
        id: `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        track: normalized,
        trackKey: getTrackKey(normalized),
        reason: String(reason || 'Falha de midia desconhecida.').slice(0, 280),
        context,
        details: {
            quality: details.quality || context,
            raw: String(details.raw || details.message || '').slice(0, 600)
        },
        createdAt: Date.now()
    };

    mediaIssues = [
        issue,
        ...mediaIssues.filter(item => item.trackKey !== issue.trackKey || item.context !== issue.context)
    ].slice(0, 80);
    saveMediaIssues();
    return issue;
}

function clearMediaFailureAction() {
    document.getElementById('mediaFailureAction')?.remove();
}

function showMediaFailureAction(track, reason = '', mode = 'audio') {
    clearMediaFailureAction();
    const normalized = normalizeTrack(track);
    if (!normalized) return;

    const host = document.querySelector('.now-playing') || document.querySelector('.player-deck');
    if (!host) return;

    const button = document.createElement('button');
    button.id = 'mediaFailureAction';
    button.className = 'btn-action';
    button.title = reason || 'Diagnosticar erro de stream';
    button.style.cssText = 'margin-left:8px; padding:8px 10px; white-space:nowrap; color:var(--neon-pink); border-color:var(--neon-pink);';
    button.innerHTML = '<i class="ph ph-stethoscope"></i> POR QUE FALHOU?';
    button.onclick = async event => {
        event.stopPropagation();
        button.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i> TESTANDO...';
        await diagnoseTrackMedia(normalized, mode);
        renderMediaDiagnosticsPanel();
    };
    host.appendChild(button);
}

function isFavoriteTrack(track) {
    const key = getTrackKey(track);
    return Boolean(key && favoriteTracks.some(item => getTrackKey(item) === key));
}

function toggleFavoriteTrack(track) {
    const normalized = normalizeTrack(track);
    const key = getTrackKey(normalized);
    if (!key) return false;

    if (isFavoriteTrack(normalized)) {
        favoriteTracks = favoriteTracks.filter(item => getTrackKey(item) !== key);
    } else {
        favoriteTracks.unshift(normalized);
    }

    saveFavorites();
    return isFavoriteTrack(normalized);
}

function getFavoriteButtonHtml(track) {
    const active = isFavoriteTrack(track);
    return `<button class="btn-action btn-favorite ${active ? 'active' : ''}" title="${active ? 'Remover dos favoritos' : 'Favoritar'}" style="margin-left: 10px; padding: 10px;"><i class="ph ${active ? 'ph-heart-fill' : 'ph-heart'}"></i></button>`;
}

function bindFavoriteButton(root, track) {
    const button = root.querySelector('.btn-favorite');
    if (!button) return;

    button.onclick = (event) => {
        event.stopPropagation();
        const active = toggleFavoriteTrack(track);
        button.classList.toggle('active', active);
        button.title = active ? 'Remover dos favoritos' : 'Favoritar';
        button.innerHTML = `<i class="ph ${active ? 'ph-heart-fill' : 'ph-heart'}"></i>`;
    };
}

function enqueueTrack(track, mode = 'end') {
    const normalized = normalizeTrack(track);
    if (!normalized) return false;
    addToMusicInbox(normalized, mode === 'next' ? 'tocar a seguir' : 'fila');
    const wasQueueEmpty = queue.length === 0;

    if (mode === 'next' && queue.length > 0) {
        const insertAt = Math.min(queue.length, currentIndex + 1);
        queue.splice(insertAt, 0, normalized);
        originalQueue.splice(insertAt, 0, normalized);
    } else {
        queue.push(normalized);
        originalQueue.push(normalized);
    }

    prefetchStream(normalized, isVideoMode ? 'video' : 'audio');
    if (wasQueueEmpty && (!audioPlayer.src || !audioPlayer.dataset.id)) loadAndPlayTrack(0);
    else publishRoomState();
    return true;
}

function playTrackNow(track) {
    const normalized = normalizeTrack(track);
    if (!normalized) return;
    addToMusicInbox(normalized, 'tocada agora');
    queue = [normalized];
    originalQueue = [normalized];
    currentIndex = 0;
    prefetchStream(normalized, isVideoMode ? 'video' : 'audio');
    loadAndPlayTrack(0);
    document.getElementById('btnQueueView')?.click();
}

function getAllKnownTracks() {
    const all = [
        ...favoriteTracks,
        ...trackInbox,
        ...playHistory,
        ...savedPlaylists.flatMap(pl => Array.isArray(pl.tracks) ? pl.tracks : []),
        ...queue
    ].map(normalizeTrack).filter(Boolean);
    const seen = new Set();
    return all.filter(track => {
        const key = getTrackKey(track);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function generateDurationQueue(targetMinutes) {
    const targetSeconds = Math.max(60, Number(targetMinutes) * 60 || 1800);
    const source = shuffleTracks(getAllKnownTracks()).filter(track => parseDurationSeconds(track.duration) > 0);
    const picked = [];
    let total = 0;

    for (const track of source) {
        const seconds = parseDurationSeconds(track.duration);
        if (picked.length > 0 && total + seconds > targetSeconds + 180) continue;
        picked.push(track);
        total += seconds;
        if (total >= targetSeconds) break;
    }

    return { tracks: picked, totalSeconds: total };
}

function formatDateKey(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function cleanCssStringValue(value) {
    return String(value || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/\\"/g, '"')
        .trim();
}

function readFirstCssVariable(style, names, fallback = '') {
    for (const name of names) {
        const value = style.getPropertyValue(name).trim();
        if (value) return value;
    }
    return fallback;
}

function getCurrentThemePayload() {
    const themeId = localStorage.getItem('fluxo_theme') || 'default';
    const style = getComputedStyle(document.body);
    const badge = readFirstCssVariable(style, ['--fx-badge'], themeId === 'default' ? 'CYBER DECK' : 'FLUXO THEME');
    const partyLabel = readFirstCssVariable(style, ['--fx-party-label', '--legacy-party-label'], badge);

    return {
        id: themeId,
        badge: cleanCssStringValue(badge),
        partyLabel: cleanCssStringValue(partyLabel),
        sigil: cleanCssStringValue(readFirstCssVariable(style, ['--fx-sigil'], 'FLX')),
        palette: {
            accent: readFirstCssVariable(style, ['--fx-a', '--legacy-a', '--neon-cyan'], '#00ffcc'),
            secondary: readFirstCssVariable(style, ['--fx-b', '--legacy-b', '--neon-pink'], '#ff0055'),
            tertiary: readFirstCssVariable(style, ['--fx-c', '--neon-purple'], '#ff00ff'),
            text: readFirstCssVariable(style, ['--fx-ink', '--text-main'], '#f4f7fb'),
            muted: readFirstCssVariable(style, ['--fx-muted', '--text-muted'], '#aeb6c2'),
            bg: readFirstCssVariable(style, ['--fx-bg', '--bg-base'], '#05070c'),
            panel: readFirstCssVariable(style, ['--fx-panel', '--legacy-eq-card', '--bg-panel'], 'rgba(5,7,12,.92)'),
            overlay: readFirstCssVariable(style, ['--fx-overlay', '--legacy-party-bg', '--fx-panel', '--bg-panel'], 'rgba(5,7,12,.92)'),
            partyBg: readFirstCssVariable(style, ['--fx-party-bg', '--legacy-party-bg', '--fx-overlay', '--bg-panel'], 'rgba(5,7,12,.92)'),
            partyFx: readFirstCssVariable(style, ['--fx-party-fx', '--legacy-party-fx'], 'linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent)'),
            line: readFirstCssVariable(style, ['--fx-line', '--border-tech'], '1px solid #333'),
            radius: readFirstCssVariable(style, ['--fx-radius', '--item-radius'], '10px'),
            font: readFirstCssVariable(style, ['--fx-font', '--global-font'], '"Segoe UI", Arial, sans-serif'),
            coverRadius: readFirstCssVariable(style, ['--fx-cover-radius', '--fx-radius', '--item-radius'], '10px'),
            coverBorder: readFirstCssVariable(style, ['--fx-cover-border', '--fx-line', '--border-tech'], '1px solid #00ffcc'),
            coverFilter: readFirstCssVariable(style, ['--fx-cover-filter'], 'none'),
            meterFill: readFirstCssVariable(style, ['--fx-meter-fill'], '')
        }
    };
}

function getCurrentTrackPayload() {
    const theme = getCurrentThemePayload();
    const track = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    if (!track) {
        return {
            title: 'Fluxo Music',
            artist: 'Aguardando musica',
            thumbnail: '',
            currentTimeLabel: '0:00',
            durationLabel: '0:00',
            progressPercent: 0,
            theme
        };
    }
    const duration = Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0 ? audioPlayer.duration : parseDurationSeconds(track.duration);
    const current = Math.max(0, Number(audioPlayer.currentTime) || 0);
    return {
        title: track.title,
        artist: track.artist,
        thumbnail: track.thumbnail,
        currentTimeLabel: formatPresenceTime(current),
        durationLabel: formatPresenceTime(duration),
        progressPercent: duration > 0 ? (current / duration) * 100 : 0,
        theme
    };
}

function updateNowPlayingWidget() {
    const payload = getCurrentTrackPayload();
    if (payload) window.electronAPI?.updateNowPlayingWidget?.(payload);
}

function estimateTrackBpm(track) {
    const title = normalizeLookupText(track?.title || '');
    if (track?.bpm) return Number(track.bpm);
    if (/\b(nightcore|speed up|sped up|drum and bass|dnb)\b/.test(title)) return 165;
    if (/\b(phonk|hardstyle|gym|rage)\b/.test(title)) return 145;
    if (/\b(slowed|reverb|lofi|chill|sad)\b/.test(title)) return 82;
    const duration = parseDurationSeconds(track?.duration);
    if (duration && duration < 150) return 132;
    if (duration && duration > 420) return 92;
    return 120;
}

function getSmartFadeDuration(nextTrack) {
    if (!isBpmTransitionEnabled || !queue[currentIndex] || !nextTrack) return 850;
    const currentBpm = estimateTrackBpm(queue[currentIndex]);
    const nextBpm = estimateTrackBpm(nextTrack);
    const diff = Math.abs(currentBpm - nextBpm);
    const averageBpm = Math.max(60, (currentBpm + nextBpm) / 2);
    const beatMs = 60000 / averageBpm;
    const phraseMs = beatMs * (diff <= 8 ? 8 : diff <= 22 ? 12 : 16);
    return Math.round(clampNumber(phraseMs, 650, 2400, 1100));
}

function getBeatSyncDelay(nextTrack) {
    if (!isBpmTransitionEnabled || !audioPlayer.duration || !nextTrack) return 0;
    const bpm = estimateTrackBpm(queue[currentIndex]);
    const beatSeconds = 60 / Math.max(60, bpm);
    const remaining = Math.max(0, audioPlayer.duration - audioPlayer.currentTime);
    const remainder = remaining % beatSeconds;
    return remainder > 0.08 && remainder < 0.55 ? remainder * 1000 : 0;
}

function getTrackFingerprint(track) {
    const normalized = normalizeTrack(track);
    if (!normalized) return '';
    const title = normalizeLookupText(sanitizeMetadata(normalized.title));
    const artist = normalizeLookupText(sanitizeMetadata(normalized.artist));
    return `${artist}|${title}`.replace(/^\|+|\|+$/g, '');
}

function rememberAutoMixTrack(track) {
    const fingerprint = getTrackFingerprint(track);
    if (!fingerprint) return;

    autoMixMemory = [
        { fingerprint, id: normalizeTrack(track)?.id || '', playedAt: Date.now() },
        ...autoMixMemory.filter(item => item.fingerprint !== fingerprint && item.id !== normalizeTrack(track)?.id)
    ].slice(0, 140);
    localStorage.setItem('fluxo_automix_memory', JSON.stringify(autoMixMemory));
}

function isLikelyBadAutoMixCandidate(track) {
    const text = normalizeLookupText(`${track?.title || ''} ${track?.artist || track?.author || ''}`);
    return /\b(playlist|mix|full album|album completo|reaction|review|tutorial|karaoke|instrumental|extended|compilation|coletanea|top 10|ranking|type beat|cover)\b/.test(text)
        || /\b(1|2|3|4|8|10)\s*(hour|hours|hora|horas)\b/.test(text);
}

function parseDurationSeconds(duration) {
    if (typeof duration === 'number') return duration;
    const parts = String(duration || '').split(':').map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
}

const AUTOMIX_GENERIC_TERMS = new Set([
    'official', 'video', 'audio', 'lyrics', 'lyric', 'visualizer', 'remaster', 'remastered',
    'hd', '4k', 'topic', 'vevo', 'music', 'song', 'songs', 'track', 'full', 'album',
    'feat', 'ft', 'prod', 'live', 'edit', 'version', 'original', 'soundtrack', 'ost',
    'tema', 'trilha', 'musica', 'music video', 'clipe', 'oficial', 'desconhecido', 'unknown'
]);

function getAutoMixTokenSet(value) {
    return new Set(
        normalizeLookupText(value)
            .split(' ')
            .filter(token => token.length > 2 && !AUTOMIX_GENERIC_TERMS.has(token))
    );
}

function countTokenOverlap(left, right) {
    let count = 0;
    left.forEach(token => {
        if (right.has(token)) count += 1;
    });
    return count;
}

function getAutoMixStyle(track) {
    const text = normalizeLookupText(`${track?.title || ''} ${track?.artist || track?.author || ''}`);
    const buckets = [
        { id: 'anime', pattern: /\b(anime|opening|ending|ost|jpop|j rock|jrock|vocaloid)\b/ },
        { id: 'phonk', pattern: /\b(phonk|drift|bruxaria|mandela)\b/ },
        { id: 'lofi', pattern: /\b(lofi|lo fi|chill|study|beats|jazzhop)\b/ },
        { id: 'rap', pattern: /\b(rap|trap|hip hop|hiphop|drill|plug|boombap)\b/ },
        { id: 'rock', pattern: /\b(rock|metal|punk|emo|hardcore|grunge)\b/ },
        { id: 'electronic', pattern: /\b(electronic|edm|house|techno|dubstep|synthwave|trance)\b/ },
        { id: 'funk', pattern: /\b(funk|mtg|automotivo|beat fino)\b/ },
        { id: 'sped', pattern: /\b(nightcore|sped up|slowed|reverb)\b/ }
    ];
    return buckets.find(bucket => bucket.pattern.test(text))?.id || '';
}

function getAutoMixProfile(track) {
    const normalized = normalizeTrack(track) || {};
    const artistTokens = getAutoMixTokenSet(sanitizeMetadata(normalized.artist || normalized.author || ''));
    const titleTokens = getAutoMixTokenSet(sanitizeMetadata(normalized.title || ''));
    return {
        artistTokens,
        titleTokens,
        allTokens: new Set([...artistTokens, ...titleTokens]),
        style: getAutoMixStyle(normalized)
    };
}

function getAutoMixRelation(candidateTrack, currentTrack, seedTrack) {
    const candidate = getAutoMixProfile(candidateTrack);
    const anchors = [currentTrack, seedTrack]
        .map(normalizeTrack)
        .filter(Boolean)
        .filter((track, index, list) => list.findIndex(item => getTrackFingerprint(item) === getTrackFingerprint(track)) === index);

    let score = 0;
    let hasRelation = false;

    anchors.forEach(anchorTrack => {
        const anchor = getAutoMixProfile(anchorTrack);
        const artistOverlap = countTokenOverlap(candidate.artistTokens, anchor.artistTokens);
        const titleOverlap = countTokenOverlap(candidate.titleTokens, anchor.titleTokens);
        const totalOverlap = countTokenOverlap(candidate.allTokens, anchor.allTokens);
        const sameStyle = candidate.style && candidate.style === anchor.style;

        if (artistOverlap > 0) {
            hasRelation = true;
            score = Math.max(score, 34 + artistOverlap * 10);
        }
        if (titleOverlap >= 2) {
            hasRelation = true;
            score = Math.max(score, 26 + titleOverlap * 8);
        }
        if (totalOverlap >= 3) {
            hasRelation = true;
            score = Math.max(score, 22 + totalOverlap * 6);
        }
        if (sameStyle) {
            score = Math.max(score, 18);
        }
    });

    return { hasRelation, score };
}

function getSeenTrackSets() {
    const tracks = [...queue, ...playHistory].map(normalizeTrack).filter(Boolean);
    return {
        ids: new Set([
            ...tracks.map(track => track.id).filter(Boolean),
            ...autoMixMemory.map(item => item.id).filter(Boolean)
        ]),
        fingerprints: new Set([
            ...tracks.map(getTrackFingerprint).filter(Boolean),
            ...autoMixMemory.map(item => item.fingerprint).filter(Boolean)
        ])
    };
}

function scoreAutoMixCandidate(track, currentTrack, seen, seedTrack = currentTrack) {
    const normalized = normalizeTrack(track);
    const fingerprint = getTrackFingerprint(normalized);
    if (!normalized || !fingerprint) return -9999;
    if (seen.ids.has(normalized.id) || seen.fingerprints.has(fingerprint)) return -9999;
    if (fingerprint === getTrackFingerprint(currentTrack)) return -9999;
    if (isLikelyBadAutoMixCandidate(normalized)) return -9999;

    const relation = getAutoMixRelation(normalized, currentTrack, seedTrack);
    if (!relation.hasRelation) return -9999;

    let score = 70 + relation.score;
    const title = normalizeLookupText(normalized.title);
    const currentTitle = normalizeLookupText(currentTrack?.title);
    const artist = normalizeLookupText(normalized.artist);
    const currentArtist = normalizeLookupText(currentTrack?.artist);
    const duration = parseDurationSeconds(normalized.duration);

    if (title && currentTitle && (title.includes(currentTitle) || currentTitle.includes(title))) score -= 75;
    if (artist && currentArtist && artist === currentArtist) score += 10;
    if (duration && duration < 85) return -9999;
    if (duration && duration > 660) return -9999;
    if (duration && duration > 480) score -= 25;
    if (/\b(official audio|official video|visualizer)\b/i.test(normalized.title)) score += 10;
    if (normalized.thumbnail) score += 4;

    return score >= 76 ? score : -9999;
}

function buildAutoMixQueries(currentTrack, seedTrack = autoMixSeedTrack) {
    const current = normalizeTrack(currentTrack) || {};
    const seed = normalizeTrack(seedTrack) || current;
    const artistRaw = sanitizeMetadata(current.artist || '');
    const title = sanitizeMetadata(current.title || '');
    const seedArtistRaw = sanitizeMetadata(seed.artist || '');
    const seedTitle = sanitizeMetadata(seed.title || '');
    const artist = /^desconhecido$/i.test(artistRaw) ? '' : artistRaw;
    const seedArtist = /^desconhecido$/i.test(seedArtistRaw) ? '' : seedArtistRaw;
    const base = [artist, title].filter(Boolean).join(' ').trim();
    const seedBase = [seedArtist, seedTitle].filter(Boolean).join(' ').trim();
    const queries = [];
    const addQuery = (query) => {
        const clean = String(query || '').replace(/\s+/g, ' ').trim();
        if (clean && !queries.includes(clean)) queries.push(clean);
    };

    addQuery(base && `${base} similar songs official audio`);
    addQuery(artist && `${artist} official audio`);
    addQuery(artist && `${artist} top songs audio`);
    addQuery(artist && title && `${artist} ${title} radio audio`);
    addQuery(seedBase && seedBase !== base && `${seedBase} similar songs audio`);
    addQuery(seedArtist && seedArtist !== artist && `${seedArtist} ${artist || 'similar'} songs audio`);

    const style = getAutoMixStyle(current);
    addQuery(style && artist && `${artist} ${style} audio`);

    return queries.slice(0, 7);
}

async function getSmartAutoMixTrack(currentTrack, seedTrack = autoMixSeedTrack) {
    const seen = getSeenTrackSets();
    const collected = [];
    const collectedKeys = new Set();
    const anchorTrack = normalizeTrack(seedTrack) || normalizeTrack(queue[0]) || normalizeTrack(currentTrack);

    for (const query of buildAutoMixQueries(currentTrack, anchorTrack)) {
        try {
            const data = await searchAudioTracks(query);
            for (const track of data.tracks || []) {
                const normalized = normalizeTrack(track);
                const key = getTrackFingerprint(normalized) || normalized?.id;
                const score = scoreAutoMixCandidate(normalized, currentTrack, seen, anchorTrack);
                if (score > -9999 && key && !collectedKeys.has(key)) {
                    collectedKeys.add(key);
                    collected.push({ track: normalized, score });
                }
            }
            if (collected.length >= 16) break;
        } catch (error) {
            console.log('Auto-Mix busca falhou:', error.message);
        }
    }

    if (collected.length === 0) return null;

    collected.sort((a, b) => b.score - a.score);
    const top = collected.slice(0, Math.min(6, collected.length));
    const weighted = top.flatMap((item, index) => Array(Math.max(1, top.length - index)).fill(item.track));
    return weighted[Math.floor(Math.random() * weighted.length)];
}

function getTrackWebUrl(track) {
    const streamId = getTrackStreamId(track);
    const videoId = track?.videoId || getYouTubeVideoIdFromValue(streamId);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    if (/^https?:\/\//i.test(streamId)) return streamId;
    return '';
}

function getFluxoRpcUrl() {
    return 'https://github.com/Harleyzinn/fluxo';
}

function formatPresenceTime(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateDiscordNowPlaying(state = audioPlayer.paused ? 'paused' : 'playing') {
    updateNowPlayingWidget();
    if (!window.electronAPI?.updateDiscordPresence || !queue[currentIndex]) return;
    const track = normalizeTrack(queue[currentIndex]);
    const currentTime = Math.max(0, Number(audioPlayer.currentTime) || 0);
    const duration = Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0
        ? audioPlayer.duration
        : parseDurationSeconds(track.duration);
    const progressText = duration > 0
        ? `${formatPresenceTime(currentTime)} / ${formatPresenceTime(duration)}${audioPlayer.playbackRate && audioPlayer.playbackRate !== 1 ? ` (${audioPlayer.playbackRate.toFixed(2)}x)` : ''}`
        : '';
    const rate = clampNumber(audioPlayer.playbackRate, 0.5, 1.6, 1);

    window.electronAPI.updateDiscordPresence({
        title: track.title,
        artist: track.artist,
        thumbnail: track.thumbnail,
        url: getTrackWebUrl(track),
        fluxoUrl: getFluxoRpcUrl(),
        currentTime,
        duration,
        progressText,
        startedAt: Date.now() - (currentTime / rate) * 1000,
        endsAt: duration > currentTime ? Date.now() + ((duration - currentTime) / rate) * 1000 : 0
    }, state);
}

async function startRadioFromTrack(track) {
    if (!canControl('skip')) return;
    const seed = normalizeTrack(track);
    if (!seed) return;

    isAutoMix = true;
    autoMixSeedTrack = seed;
    document.getElementById('autoMixBtn')?.classList.add('active');
    queue = [seed];
    originalQueue = [seed];
    currentIndex = 0;

    await loadAndPlayTrack(0);

    const firstSuggestion = await getSmartAutoMixTrack(seed, seed);
    if (firstSuggestion) {
        queue.push(firstSuggestion);
        originalQueue.push(firstSuggestion);
        publishRoomState();
    }

    document.getElementById('btnQueueView').click();
}

// ========================================================
// CONTROLE DE VOLUME (FIX: PERSISTÊNCIA REAL)
// ========================================================
const volumeSlider = document.getElementById('volumeSlider');
const volIcon = document.getElementById('volIcon');

const initialVolume = localStorage.getItem('fluxo_volume') !== null ? parseFloat(localStorage.getItem('fluxo_volume')) : 0.5;
audioPlayer.volume = initialVolume;
previewPlayer.volume = initialVolume;
volumeSlider.value = initialVolume;

function updateVolumeIcon(vol) {
    if (vol === 0) volIcon.className = 'ph ph-speaker-none';
    else if (vol < 0.5) volIcon.className = 'ph ph-speaker-low';
    else volIcon.className = 'ph ph-speaker-high';
}
updateVolumeIcon(initialVolume);

volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    audioPlayer.volume = vol;
    previewPlayer.volume = vol;
    updateVolumeIcon(vol);
    localStorage.setItem('fluxo_volume', vol);
});

// ========================================================
// SANITIZAÇÃO DE METADADOS E MÓDULO DE LETRAS
// ========================================================
function sanitizeMetadata(text) {
    return text
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/official video/gi, '')
        .replace(/clipe oficial/gi, '')
        .replace(/video oficial/gi, '')
        .replace(/lyric video/gi, '')
        .replace(/audio/gi, '')
        .replace(/lyrics/gi, '')
        .replace(/feat\..*/gi, '')
        .replace(/ft\..*/gi, '')
        .replace(/\|.*/g, '')
        .trim();
}

// ========================================================
// SANITIZAÇÃO E MÓDULO DE LETRAS INTELIGENTE
// ========================================================
function sanitizeMetadata(text) {
    return text.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/official video/gi, '').replace(/clipe oficial/gi, '').replace(/video oficial/gi, '').replace(/lyric video/gi, '').replace(/audio/gi, '').replace(/lyrics/gi, '').replace(/feat\..*/gi, '').replace(/ft\..*/gi, '').replace(/\|.*/g, '').trim();
}

document.getElementById('btnLyrics').addEventListener('click', () => { renderLyricsPanel(); });

function normalizeLookupText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanLyricField(value) {
    return String(value || '')
        .replace(/\b(official|video|visualizer|remaster(?:ed)?|hd|4k|lyrics?|audio|clipe oficial|tradu[cç][aã]o|legendado)\b/gi, '')
        .replace(/\b(feat|ft|prod)\.?\s+.*$/gi, '')
        .replace(/\((?:[^()]*)\)/g, '')
        .replace(/\[(?:[^\[\]]*)\]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[-|•]+$/g, '')
        .trim();
}

function inferLyricMetadata(track) {
    const normalized = normalizeTrack(track) || {};
    let title = cleanLyricField(normalized.title);
    let artist = cleanLyricField(normalized.artist);

    const separators = [' - ', ' – ', ' — ', ' | '];
    for (const separator of separators) {
        if (title.includes(separator)) {
            const [left, ...rest] = title.split(separator);
            const right = rest.join(separator).trim();
            if (left && right) {
                const leftLooksArtist = !artist || normalizeLookupText(artist) === 'youtube' || normalizeLookupText(artist) === normalizeLookupText(left);
                if (leftLooksArtist) artist = cleanLyricField(left);
                title = cleanLyricField(right);
                break;
            }
        }
    }

    return { artist, title };
}

function lyricScore(result, artist, title) {
    const resultTitle = normalizeLookupText(result?.trackName || result?.name || result?.title);
    const resultArtist = normalizeLookupText(result?.artistName || result?.artist || result?.artist_name);
    const targetTitle = normalizeLookupText(title);
    const targetArtist = normalizeLookupText(artist);
    let score = 0;

    if (resultTitle === targetTitle) score += 80;
    else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) score += 45;

    if (targetArtist && resultArtist === targetArtist) score += 60;
    else if (targetArtist && (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist))) score += 30;

    if (result?.plainLyrics) score += 20;
    if (result?.syncedLyrics) score += 6;
    return score;
}

function buildLyricQueries(artist, title) {
    const cleanArtist = cleanLyricField(artist);
    const cleanTitle = cleanLyricField(title);
    const queries = [];

    if (cleanArtist && cleanTitle) {
        queries.push({ artist: cleanArtist, title: cleanTitle, exact: true });
        queries.push({ q: `${cleanArtist} ${cleanTitle}` });
        queries.push({ q: `${cleanTitle} ${cleanArtist}` });
    }
    if (cleanTitle) queries.push({ q: cleanTitle });

    return queries.filter((query, index, all) => {
        const key = query.exact ? `${query.artist}|${query.title}` : query.q;
        return key && all.findIndex(other => (other.exact ? `${other.artist}|${other.title}` : other.q) === key) === index;
    });
}

function loadLyricCache() {
    try {
        return JSON.parse(localStorage.getItem('fluxo_lyrics_cache') || '{}') || {};
    } catch {
        return {};
    }
}

function getLyricCacheKey(artist, title) {
    return `${normalizeLookupText(artist)}|${normalizeLookupText(title)}`;
}

function saveLyricCache() {
    const entries = Object.entries(lyricCache)
        .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
        .slice(0, 300);
    lyricCache = Object.fromEntries(entries);
    localStorage.setItem('fluxo_lyrics_cache', JSON.stringify(lyricCache));
}

function rememberLyricCache(cacheKey, lyrics) {
    if (!cacheKey || !lyrics) return;
    lyricCache[cacheKey] = { lyrics, savedAt: Date.now() };
    saveLyricCache();
}

async function fetchLyricCandidate(query, artist, title) {
    if (query.exact) {
        const res = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(query.artist)}&track_name=${encodeURIComponent(query.title)}`);
        if (res.ok) {
            const data = await res.json();
            if (data?.plainLyrics || data?.syncedLyrics) return data;
        }
        return null;
    }

    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query.q)}`);
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    return results
        .filter(item => item?.plainLyrics || item?.syncedLyrics)
        .sort((a, b) => lyricScore(b, artist, title) - lyricScore(a, artist, title))[0] || null;
}

async function findLyrics(artist, title) {
    const queries = buildLyricQueries(artist, title);
    const cacheKey = getLyricCacheKey(artist, title);
    if (cacheKey && lyricCache[cacheKey]?.lyrics) {
        return lyricCache[cacheKey].lyrics;
    }

    for (const query of queries) {
        try {
            const candidate = await fetchLyricCandidate(query, artist, title);
            if (candidate?.plainLyrics || candidate?.syncedLyrics) {
                const lyrics = candidate.plainLyrics || candidate.syncedLyrics;
                rememberLyricCache(cacheKey, lyrics);
                return lyrics;
            }
        } catch (error) {
            console.log('Tentativa de letra falhou:', error.message);
        }
    }

    return null;
}

async function loadLyricsIntoPanel(artist, title) {
    const content = document.getElementById('lyricContent');
    if (!content) return;

    try {
        const lyrics = await findLyrics(artist, title);
        if (lyrics) {
            content.innerText = lyrics;
        } else {
            content.innerHTML = 'Letra não encontrada automaticamente.<br><small style="color:var(--neon-pink)">Ajuste a busca manual se essa faixa tiver nome incomum.</small>';
        }
    } catch {
        content.innerHTML = 'Falha na conexão com o banco de letras.';
    }
}

function renderLyricsPanel(manualQuery = null) {
    let sTitle = "", sArtist = "";
    
    if (manualQuery) {
        const parts = manualQuery.split('-');
        if(parts.length > 1) { sArtist = parts[0].trim(); sTitle = parts.slice(1).join('-').trim(); } 
        else { sTitle = manualQuery.trim(); }
    } else if (queue.length > 0 && queue[currentIndex]) {
        const inferred = inferLyricMetadata(queue[currentIndex]);
        sTitle = inferred.title;
        sArtist = inferred.artist;
    }

    panelTitle.innerText = `DECODIFICADOR DE LETRAS`;
    resultsList.innerHTML = `
        <li style="padding: 15px; border-bottom: var(--border-tech); display: flex; gap: 10px; background: rgba(0,0,0,0.2);">
            <input type="text" id="manualLyricSearch" class="inline-input" style="flex:1;" placeholder="Busca Manual (Ex: Artista - Nome da Música)" value="${sArtist ? sArtist + ' - ' : ''}${sTitle}">
            <button class="btn-confirm" id="btnManualLyricSearch"><i class="ph ph-magnifying-glass"></i> BUSCAR</button>
        </li>
        <li id="lyricContent" style="padding: 40px; text-align: center; white-space: pre-wrap; line-height: 2.2; font-size: 1.15rem; color: var(--text-main);">
            ${sTitle ? '<i class="ph ph-spinner-gap ph-spin" style="font-size:2rem; color:var(--neon-cyan);"></i><br>Minerando servidores...' : 'Digite o nome da música acima ou toque uma faixa.'}
        </li>
    `;

    document.getElementById('btnManualLyricSearch').onclick = () => renderLyricsPanel(document.getElementById('manualLyricSearch').value);
    document.getElementById('manualLyricSearch').onkeypress = (e) => { if(e.key === 'Enter') document.getElementById('btnManualLyricSearch').click(); };

    if (sTitle) loadLyricsIntoPanel(sArtist, sTitle);
}
// ========================================================
// SESSÃO COMPARTILHADA
// ========================================================
document.getElementById('btnMultiplayer').addEventListener('click', renderMultiplayerPanel);

function renderMultiplayerPanel() {
    if (!db) {
        renderMultiplayerUnavailable();
        return;
    }

    if (!myName) {
        panelTitle.innerText = "SESSÃO COMPARTILHADA (IDENTIFICAÇÃO)";
        resultsList.innerHTML = `
            <li style="padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 20px; border-bottom: none;">
                <i class="ph ph-identification-badge" style="font-size: 4rem; color: var(--neon-cyan);"></i>
                <div style="color: var(--text-main); font-size: 1.1rem; text-align: center;">Identifique-se no terminal para acessar a rede.</div>
                <input type="text" id="mpNicknameInput" class="inline-input" placeholder="SEU NICKNAME" style="width: 250px; text-align: center; text-transform: uppercase;" maxlength="15">
                <button id="btnSaveNickname" class="btn-confirm" style="width: 250px; justify-content: center;">LOGAR <i class="ph ph-arrow-right"></i></button>
            </li>
        `;
        document.getElementById('btnSaveNickname').addEventListener('click', () => {
            const nick = document.getElementById('mpNicknameInput').value.trim().toUpperCase();
            if(nick.length > 1) { myName = nick; localStorage.setItem('fluxo_name', myName); renderMultiplayerPanel(); }
        });
        return;
    }

    if (!currentRoom) {
        panelTitle.innerText = "SESSÃO COMPARTILHADA (LOBBY)";
        resultsList.innerHTML = `
            <li style="padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 20px; border-bottom: none;">
                <i class="ph ph-users-three" style="font-size: 4rem; color: var(--neon-cyan);"></i>
                <div style="display: flex; gap: 20px; margin-top: 10px; width: 100%; justify-content: center;">
                    <div style="background: rgba(0,0,0,0.2); border: var(--border-tech); padding: 20px; border-radius: var(--item-radius); text-align: center; flex: 1; max-width: 250px;">
                        <h3 style="color: var(--neon-pink); margin-bottom: 15px;">NOVA SESSÃO</h3>
                        <button id="btnCreateRoom" class="btn-confirm" style="width: 100%; justify-content: center;"><i class="ph ph-plus"></i> CRIAR SALA</button>
                    </div>
                    <div style="background: rgba(0,0,0,0.2); border: var(--border-tech); padding: 20px; border-radius: var(--item-radius); text-align: center; flex: 1; max-width: 250px;">
                        <h3 style="color: var(--neon-cyan); margin-bottom: 15px;">ENTRAR</h3>
                        <input type="text" id="roomCodeInput" class="inline-input" placeholder="CÓDIGO" style="width: 100%; margin-bottom: 10px; text-align: center; text-transform: uppercase;" maxlength="4">
                        <button id="btnJoinRoom" class="btn-action" style="width: 100%; justify-content: center;"><i class="ph ph-sign-in"></i> CONECTAR</button>
                    </div>
                </div>
                <button class="btn-abort" style="margin-top: 15px; border: none; background: transparent; font-size: 0.8rem; opacity: 0.5;" onclick="localStorage.removeItem('fluxo_name'); myName=''; renderMultiplayerPanel();">ALTERAR IDENTIDADE</button>
            </li>
        `;
        
        document.getElementById('btnCreateRoom').onclick = async () => {
            const btnCreate = document.getElementById('btnCreateRoom');
            const originalHTML = btnCreate.innerHTML;
            btnCreate.disabled = true;
            btnCreate.innerHTML = "<i class='ph ph-spinner-gap ph-spin'></i> CRIANDO...";

            currentRoom = generateRoomCode();
            isHost = true;
            roomSettings = normalizeRoomSettings({ videoEnabled: isVideoMode });
            sessionPlayedTracks = [];
            if (queue[currentIndex]) rememberSessionPlayedTrack(queue[currentIndex]);

            try {
                const now = Date.now();
                const eq = getSessionEqPayload();
                await db.ref('rooms/' + currentRoom).set({
                    createdAt: now,
                    state: audioPlayer.paused ? 'paused' : 'playing',
                    time: audioPlayer.currentTime || 0,
                    track: queue[currentIndex] || null,
                    queue: queue.map(normalizeTrack).filter(Boolean),
                    played: sessionPlayedTracks.map(normalizeTrack).filter(Boolean),
                    settings: { ...roomSettings },
                    pinnedTrackKey: '',
                    ...(eq ? { eq } : {}),
                    updatedAt: now
                });
                await db.ref(`rooms/${currentRoom}/users/${myUid}`).set({ name: myName, isReady: true, isHost: true });
                updateAchievementProgress('sessionHost');
                renderMultiplayerPanel();
                setupRoomListeners();
            } catch (error) {
                resetMultiplayerSessionState();
                btnCreate.disabled = false;
                btnCreate.innerHTML = originalHTML;
                handleMultiplayerFirebaseError(error, 'criar sala');
            }
        };

        document.getElementById('btnJoinRoom').onclick = async () => {
            const code = document.getElementById('roomCodeInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (code.length !== 4) return;
            const btnJoin = document.getElementById('btnJoinRoom');
            const originalHTML = btnJoin.innerHTML;
            btnJoin.disabled = true;
            btnJoin.innerHTML = "<i class='ph ph-spinner-gap ph-spin'></i> SOLICITANDO...";

            try {
                const snapshot = await db.ref('rooms/' + code).once('value');
                if(snapshot.exists()) {
                    const reqRef = db.ref(`rooms/${code}/entryRequests/${myUid}`);
                    await reqRef.set({ name: myName, status: 'pending' });
                    btnJoin.innerHTML = "<i class='ph ph-hourglass-medium'></i> AGUARDANDO HOST...";
                    reqRef.on('value', async reqSnap => {
                        const rd = reqSnap.val();
                        if (rd && rd.status === 'accepted') {
                            reqRef.off();
                            reqRef.remove().catch(error => console.warn('[Fluxo multiplayer] Falha ao limpar pedido aceito:', error));
                            currentRoom = code; isHost = false;
                            try {
                                await db.ref(`rooms/${currentRoom}/users/${myUid}`).set({ name: myName, isReady: false, isHost: false });
                                updateAchievementProgress('sessionGuest');
                                renderMultiplayerPanel();
                                setupRoomListeners();
                            } catch (error) {
                                resetMultiplayerSessionState();
                                handleMultiplayerFirebaseError(error, 'entrar na sala');
                            }
                        } else if (rd && rd.status === 'rejected') {
                            reqRef.off();
                            reqRef.remove().catch(error => console.warn('[Fluxo multiplayer] Falha ao limpar pedido recusado:', error));
                            btnJoin.disabled = false;
                            btnJoin.innerHTML = originalHTML; // Reseta botão
                            document.getElementById('roomCodeInput').value = ''; // Limpa input
                            renderKickedUI("ACESSO NEGADO PELO ANFITRIÃO");
                        }
                    }, error => {
                        btnJoin.disabled = false;
                        btnJoin.innerHTML = originalHTML;
                        handleMultiplayerFirebaseError(error, 'acompanhar pedido de entrada');
                    });
                } else { 
                    btnJoin.disabled = false;
                    btnJoin.innerHTML = "<i class='ph ph-warning'></i> SALA INVÁLIDA";
                    btnJoin.style.color = "var(--neon-pink)";
                    btnJoin.style.borderColor = "var(--neon-pink)";
                    setTimeout(() => {
                        btnJoin.innerHTML = originalHTML;
                        btnJoin.style.color = "";
                        btnJoin.style.borderColor = "";
                        document.getElementById('roomCodeInput').value = '';
                    }, 2000);
                }
            } catch (error) {
                btnJoin.disabled = false;
                btnJoin.innerHTML = originalHTML;
                handleMultiplayerFirebaseError(error, 'procurar sala');
            }
        };
    } else {
        const availableTabs = ['mp-info', 'mp-queue', 'mp-chat', 'mp-users', 'mp-ranking', 'mp-lyrics', 'mp-requests'];
        if (isHost) availableTabs.push('mp-entry');
        if (!availableTabs.includes(activeMpTab)) activeMpTab = 'mp-info';
        const memberCount = Math.max(1, Object.keys(sessionUsers || {}).length);
        const voteCount = Object.keys(sessionSkipVotes || {}).length;
        const voteNeeded = Math.max(1, Math.ceil(memberCount * 0.5));
        const currentTrack = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;

        panelTitle.innerText = `SALA ${currentRoom} - ${isHost ? 'HOST' : 'CONVIDADO'}`;
        resultsList.innerHTML = `
            <li class="mp-shell">
            <section class="mp-room-hero">
                <div class="mp-code-card">
                    <span>CODIGO DA SALA</span>
                    <strong>${escapeHtml(currentRoom)}</strong>
                    <small>${memberCount} membro${memberCount === 1 ? '' : 's'} conectado${memberCount === 1 ? '' : 's'}</small>
                </div>
                <div class="mp-now-card">
                    <span class="mp-kicker">${isHost ? 'Voce controla a sessao' : 'Sincronizado com o host'}</span>
                    <h3>${escapeHtml(currentTrack?.title || 'Sala sem faixa')}</h3>
                    <p>${escapeHtml(currentTrack?.artist || 'Aguardando a primeira musica')}</p>
                    <div class="mp-status-strip">
                        <span id="syncStatusUI">SYNC ATIVO</span>
                        <span>${roomSettings.videoEnabled ? 'VIDEO' : 'AUDIO'}</span>
                        <span>${roomSettings.sessionRadioEnabled ? 'RADIO ON' : 'RADIO OFF'}</span>
                    </div>
                </div>
                <button id="btnLeaveRoom" class="btn-abort mp-leave"><i class="ph ph-sign-out"></i> SAIR</button>
            </section>

            <div class="mp-tabs">
                <div class="mp-tab ${activeMpTab === 'mp-info' ? 'active' : ''}" data-target="mp-info"><i class="ph ph-sliders-horizontal"></i> CONTROLE</div>
                <div class="mp-tab ${activeMpTab === 'mp-queue' ? 'active' : ''}" data-target="mp-queue"><i class="ph ph-list-bullets"></i> FILA</div>
                <div class="mp-tab ${activeMpTab === 'mp-chat' ? 'active' : ''}" data-target="mp-chat"><i class="ph ph-chat-circle-text"></i> CHAT</div>
                <div class="mp-tab ${activeMpTab === 'mp-users' ? 'active' : ''}" data-target="mp-users"><i class="ph ph-users-three"></i> MEMBROS</div>
                <div class="mp-tab ${activeMpTab === 'mp-ranking' ? 'active' : ''}" data-target="mp-ranking"><i class="ph ph-trophy"></i> RANKING</div>
                <div class="mp-tab ${activeMpTab === 'mp-lyrics' ? 'active' : ''}" data-target="mp-lyrics"><i class="ph ph-microphone-stage"></i> LETRA</div>
                ${isHost ? `<div class="mp-tab ${activeMpTab === 'mp-entry' ? 'active' : ''}" data-target="mp-entry"><i class="ph ph-door-open"></i> ENTRADAS <span id="entryBadge" class="mp-badge" style="display:none;">0</span></div>` : ''}
                <div class="mp-tab ${activeMpTab === 'mp-requests' ? 'active' : ''}" data-target="mp-requests"><i class="ph ph-music-notes-plus"></i> PEDIDOS <span id="reqBadge" class="mp-badge" style="display:none;">0</span></div>
            </div>

            <div class="mp-pane ${activeMpTab === 'mp-info' ? 'active' : ''}" id="mp-info">
                ${isHost ? `
                    <div class="mp-settings-grid">
                        <label class="mp-switch"><input type="checkbox" id="cbControls" ${roomSettings.controlsEnabled ? 'checked' : ''}><span><strong>Controles livres</strong><small>Convidados podem pausar, voltar e avancar.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbGuestPlayPause" ${roomSettings.allowGuestPlayPause ? 'checked' : ''}><span><strong>Play/Pause liberado</strong><small>Convidados podem pausar ou continuar a sessao.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbGuestSeek" ${roomSettings.allowGuestSeek ? 'checked' : ''}><span><strong>Seek liberado</strong><small>Convidados podem mexer na barra da musica.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbGuestSkip" ${roomSettings.allowGuestSkip ? 'checked' : ''}><span><strong>Skip liberado</strong><small>Convidados podem avancar, voltar, loop e shuffle.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbDirectQueue" ${roomSettings.directQueueEnabled ? 'checked' : ''}><span><strong>Convidado manda a proxima</strong><small>Adicionar musica entra direto depois da atual.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbRequestsMuted" ${roomSettings.requestsMuted ? 'checked' : ''}><span><strong>Pedidos silenciados</strong><small>Fecha sugestoes moderadas sem derrubar a sala.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbPriorityQueue" ${roomSettings.priorityQueueEnabled ? 'checked' : ''}><span><strong>Fila prioritaria</strong><small>Votos sobem musicas e pin do host fica acima.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbReactions" ${roomSettings.reactionsEnabled ? 'checked' : ''}><span><strong>Reacoes ao vivo</strong><small>Permite hype, braba, feels e replay na sala.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbQueue" ${roomSettings.queueVisible ? 'checked' : ''}><span><strong>Fila visivel</strong><small>Todo mundo ve e pode salvar a fila da sessao.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbSessionRadio" ${roomSettings.sessionRadioEnabled ? 'checked' : ''}><span><strong>Infinite Radio da sala</strong><small>O host alimenta a sessao quando a fila acabar.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbSessionVideo" ${roomSettings.videoEnabled ? 'checked' : ''}><span><strong>Video para todo mundo</strong><small>Sincroniza audio/video da sessao.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbSkipVoting" ${roomSettings.skipVotingEnabled ? 'checked' : ''}><span><strong>Votacao para pular</strong><small>50% dos membros pulam a faixa.</small></span></label>
                        <label class="mp-switch"><input type="checkbox" id="cbHostBypass" ${roomSettings.hostCanSkipVote ? 'checked' : ''}><span><strong>Host ignora votacao</strong><small>O dono pode pular direto.</small></span></label>
                    </div>
                ` : `
                    <div class="mp-guest-grid">
                        <div class="mp-permission-card ${roomSettings.directQueueEnabled ? 'on' : ''}"><i class="ph ph-queue"></i><strong>${roomSettings.directQueueEnabled ? 'Proxima liberada' : 'Pedidos moderados'}</strong><span>${roomSettings.directQueueEnabled ? 'Seu ADD entra direto na proxima.' : 'Suas musicas passam pelo host.'}</span></div>
                        <div class="mp-permission-card ${roomSettings.allowGuestPlayPause ? 'on' : ''}"><i class="ph ph-play-pause"></i><strong>${roomSettings.allowGuestPlayPause ? 'Play/Pause liberado' : 'Play/Pause bloqueado'}</strong><span>Permissao separada do host.</span></div>
                        <div class="mp-permission-card ${roomSettings.allowGuestSeek ? 'on' : ''}"><i class="ph ph-gauge"></i><strong>${roomSettings.allowGuestSeek ? 'Seek liberado' : 'Seek bloqueado'}</strong><span>Barra de progresso da sala.</span></div>
                        <div class="mp-permission-card ${roomSettings.allowGuestSkip ? 'on' : ''}"><i class="ph ph-skip-forward"></i><strong>${roomSettings.allowGuestSkip ? 'Skip liberado' : 'Skip por voto'}</strong><span>${roomSettings.skipVotingEnabled ? 'Use voto para pular se skip estiver bloqueado.' : 'O host comanda as trocas.'}</span></div>
                        <div class="mp-permission-card ${roomSettings.videoEnabled ? 'on' : ''}"><i class="ph ph-video-camera"></i><strong>${roomSettings.videoEnabled ? 'Video ligado' : 'Modo audio'}</strong><span>O modo vem do host da sessao.</span></div>
                    </div>
                `}
                <div class="mp-vote-card">
                    <div>
                        <span>Pular musica</span>
                        <strong>${voteCount}/${voteNeeded} voto${voteNeeded === 1 ? '' : 's'}</strong>
                    </div>
                    <button id="btnVoteSkip" class="btn-action"><i class="ph ph-skip-forward-circle"></i> ${isHost && roomSettings.hostCanSkipVote ? 'PULAR AGORA' : 'VOTAR PARA PULAR'}</button>
                </div>
                <div class="mp-reactions-card ${roomSettings.reactionsEnabled ? '' : 'disabled'}">
                    <div class="mp-pane-head compact">
                        <div><strong>Reacoes ao vivo</strong><span>${roomSettings.reactionsEnabled ? 'Marca a vibe da faixa atual.' : 'Reacoes desligadas pelo host.'}</span></div>
                    </div>
                    <div class="mp-reaction-buttons">
                        ${SESSION_REACTION_TYPES.map(reaction => `
                            <button class="btn-action mp-reaction-btn" data-reaction="${reaction.id}" ${roomSettings.reactionsEnabled ? '' : 'disabled'}>
                                <i class="ph ${reaction.icon}"></i> ${reaction.label}
                            </button>
                        `).join('')}
                    </div>
                    <div id="sessionReactionFeed" class="mp-reaction-feed"></div>
                </div>
            </div>

            <div class="mp-pane ${activeMpTab === 'mp-queue' ? 'active' : ''}" id="mp-queue">
                <div class="mp-pane-head">
                    <div><strong>Fila da sessao</strong><span>O que vai tocar para todo mundo.</span></div>
                    <div class="mp-pane-actions">
                        <button id="btnSaveSessionQueue" class="btn-confirm"><i class="ph ph-floppy-disk"></i> SALVAR FILA</button>
                        <button id="btnSaveSessionPlayed" class="btn-action"><i class="ph ph-clock-counter-clockwise"></i> SALVAR TOCADAS</button>
                    </div>
                </div>
                <div id="sessionQueueList" class="mp-track-list"></div>
                <div class="mp-pane-head compact"><div><strong>Tocadas nesta sessao</strong><span>Historico compartilhado desta sala.</span></div></div>
                <div id="sessionPlayedList" class="mp-track-list compact"></div>
            </div>

            <div class="mp-pane ${activeMpTab === 'mp-chat' ? 'active' : ''}" id="mp-chat">
                <div id="chatBox" class="mp-chat-box"></div>
                <div class="mp-chat-input">
                    <input type="text" id="chatInput" class="inline-input" style="flex:1;" placeholder="Sua mensagem...">
                    <button id="btnSendChat" class="btn-action"><i class="ph ph-paper-plane-right"></i></button>
                </div>
            </div>

            <div class="mp-pane ${activeMpTab === 'mp-users' ? 'active' : ''}" id="mp-users"><ul id="usersList" class="mp-users-list"></ul></div>

            <div class="mp-pane ${activeMpTab === 'mp-ranking' ? 'active' : ''}" id="mp-ranking">
                <div class="mp-pane-head">
                    <div><strong>Ranking da sessao</strong><span>Pedidos, reacoes e replay automatico.</span></div>
                    <button id="btnSaveSessionReplay" class="btn-confirm"><i class="ph ph-repeat"></i> SALVAR REPLAY</button>
                </div>
                <div id="sessionRankingBox" class="mp-ranking-grid"></div>
            </div>
            
            <div class="mp-pane ${activeMpTab === 'mp-lyrics' ? 'active' : ''}" id="mp-lyrics">
                <button class="btn-confirm" id="btnSyncLyrics"><i class="ph ph-microphone-stage"></i> CARREGAR LETRA DA FAIXA ATUAL</button>
                <div id="mpLyricsContent" class="mp-lyrics-box">${currentLyrics}</div>
            </div>

            ${isHost ? `<div class="mp-pane ${activeMpTab === 'mp-entry' ? 'active' : ''}" id="mp-entry"><div id="entryRequestsList" class="mp-request-list"></div></div>` : ''}
            <div class="mp-pane ${activeMpTab === 'mp-requests' ? 'active' : ''}" id="mp-requests"><div id="requestsList" class="mp-request-list">Aguardando pedidos de musica...</div></div>
            </li>
        `;

        document.querySelectorAll('.mp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.mp-tab, .mp-pane').forEach(el => el.classList.remove('active'));
                tab.classList.add('active');
                activeMpTab = tab.getAttribute('data-target'); // SALVA A ABA ATUAL
                document.getElementById(activeMpTab).classList.add('active');
                if(activeMpTab === 'mp-entry') document.getElementById('entryBadge') && (document.getElementById('entryBadge').style.display = 'none');
                if(activeMpTab === 'mp-requests') document.getElementById('reqBadge') && (document.getElementById('reqBadge').style.display = 'none');
            });
        });
        renderSessionQueueList(queue, sessionPlayedTracks);
        renderSessionReactionFeed();
        renderSessionRanking();

        document.getElementById('btnSyncLyrics').onclick = async () => {
            const content = document.getElementById('mpLyricsContent');
            content.innerHTML = "Minerando dados...";
            const inferred = inferLyricMetadata(queue[currentIndex] || { title: titleEl.innerText, artist: artistEl.innerText });
            const sTitle = inferred.title || sanitizeMetadata(titleEl.innerText);
            const sArtist = inferred.artist || sanitizeMetadata(artistEl.innerText);
            try {
                const lyrics = await findLyrics(sArtist, sTitle);
                if(lyrics){
                    currentLyrics = lyrics; // SALVA A LETRA
                    content.innerText = currentLyrics;
                } else {
                    currentLyrics = "Letra não disponível.";
                    content.innerText = currentLyrics;
                }
            } catch { 
                currentLyrics = "Erro na rede.";
                content.innerText = currentLyrics; 
            }
        };

        document.getElementById('btnLeaveRoom').onclick = disconnectFromRoom;
        document.getElementById('btnSendChat').onclick = sendChatMessage;
        document.getElementById('chatInput').onkeypress = (e) => { if(e.key === 'Enter') sendChatMessage(); };
        document.getElementById('btnVoteSkip').onclick = requestSessionSkipVote;
        document.querySelectorAll('.mp-reaction-btn').forEach(button => {
            button.onclick = () => sendSessionReaction(button.dataset.reaction);
        });
        document.getElementById('btnSaveSessionQueue').onclick = () => {
            if (saveSessionTracksAsPlaylist('queue')) document.getElementById('btnSaveSessionQueue').innerHTML = '<i class="ph ph-check"></i> SALVA';
        };
        document.getElementById('btnSaveSessionPlayed').onclick = () => {
            if (saveSessionTracksAsPlaylist('played')) document.getElementById('btnSaveSessionPlayed').innerHTML = '<i class="ph ph-check"></i> SALVAS';
        };
        document.getElementById('btnSaveSessionReplay')?.addEventListener('click', () => {
            if (saveSessionReplayPlaylist()) document.getElementById('btnSaveSessionReplay').innerHTML = '<i class="ph ph-check"></i> REPLAY SALVO';
        });
        
        if(isHost) {
            const bindSettingToggle = (id, key, afterChange = null) => {
                const input = document.getElementById(id);
                if (!input) return;
                input.onchange = async (e) => {
                    roomSettings = normalizeRoomSettings({ ...roomSettings, [key]: e.target.checked });
                    publishRoomState({ settings: roomSettings });
                    if (afterChange) await afterChange(e.target.checked);
                };
            };
            const cbControls = document.getElementById('cbControls');
            if (cbControls) {
                cbControls.onchange = (e) => {
                    const enabled = e.target.checked;
                    roomSettings = normalizeRoomSettings({
                        ...roomSettings,
                        controlsEnabled: enabled,
                        allowGuestPlayPause: enabled,
                        allowGuestSeek: enabled,
                        allowGuestSkip: enabled
                    });
                    publishRoomState({ settings: roomSettings });
                    renderMultiplayerPanel();
                };
            }
            bindSettingToggle('cbGuestPlayPause', 'allowGuestPlayPause');
            bindSettingToggle('cbGuestSeek', 'allowGuestSeek');
            bindSettingToggle('cbGuestSkip', 'allowGuestSkip');
            bindSettingToggle('cbDirectQueue', 'directQueueEnabled');
            bindSettingToggle('cbRequestsMuted', 'requestsMuted');
            bindSettingToggle('cbPriorityQueue', 'priorityQueueEnabled', () => sortSessionQueueByPriority());
            bindSettingToggle('cbReactions', 'reactionsEnabled');
            bindSettingToggle('cbQueue', 'queueVisible');
            bindSettingToggle('cbSessionRadio', 'sessionRadioEnabled', (enabled) => {
                isAutoMix = enabled;
                document.getElementById('autoMixBtn')?.classList.toggle('active', enabled);
                if (enabled) {
                    autoMixSeedTrack = normalizeTrack(queue[currentIndex]) || normalizeTrack(queue[0]) || null;
                    ensureAutoMixNextTrack().catch(error => console.log('Infinite radio da sessao falhou:', error.message));
                }
            });
            bindSettingToggle('cbSessionVideo', 'videoEnabled', async (enabled) => {
                setVideoUiState(enabled);
                const changed = await reloadCurrentPlaybackStream(enabled ? 'video' : 'audio');
                if (!changed) {
                    roomSettings.videoEnabled = !enabled;
                    publishRoomState({ settings: roomSettings });
                    renderMultiplayerPanel();
                } else if (enabled && !isVideoMode) {
                    roomSettings = normalizeRoomSettings({ ...roomSettings, videoEnabled: false });
                    publishRoomState({ settings: roomSettings });
                    renderMultiplayerPanel();
                }
            });
            bindSettingToggle('cbSkipVoting', 'skipVotingEnabled');
            bindSettingToggle('cbHostBypass', 'hostCanSkipVote');
        }
    }
}

function disconnectFromRoom() {
    if(currentRoom && db) {
        const roomRef = db.ref('rooms/' + currentRoom);
        if (isHost) {
            roomRef.remove().catch(error => console.warn('[Fluxo multiplayer] Falha ao remover sala:', error));
        } else {
            roomRef.child(`users/${myUid}`).remove().catch(error => console.warn('[Fluxo multiplayer] Falha ao sair da sala:', error));
        }
        roomRef.off();
        roomRef.child(`users/${myUid}`).off();
        roomRef.child('entryRequests').off();
        roomRef.child('musicRequests').off();
        roomRef.child('chat').off();
        roomRef.child('users').off();
        roomRef.child('directQueue').off();
        roomRef.child('skipVotes').off();
        roomRef.child('queueVotes').off();
        roomRef.child('reactions').off();
    }
    currentRoom = null; isHost = false; 
    document.getElementById('deckHardwareButtons').style.display = 'flex';
    document.getElementById('progressBar').style.pointerEvents = 'auto';
    audioPlayer.pause(); renderMultiplayerPanel();
}

function renderKickedUI(reason) {
    disconnectFromRoom();
    panelTitle.innerText = "AVISO DE CONEXÃO";
    resultsList.innerHTML = `<li style="padding:60px; text-align:center;">
        <i class="ph ph-warning-octagon" style="font-size:4rem; color:var(--neon-pink);"></i><br><br>
        <div style="font-size:1.2rem; border:1px solid var(--neon-pink); padding:10px;">${reason}</div><br>
        <button class="btn-confirm" onclick="renderMultiplayerPanel()">VOLTAR AO LOBBY</button>
    </li>`;
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (text && currentRoom && db) {
        trackMultiplayerPromise(
            db.ref(`rooms/${currentRoom}/chat`).push({ sender: myName, text: text, createdAt: Date.now() }),
            'enviar mensagem no chat'
        ).then(result => {
            if (result) input.value = '';
        });
    }
}

function sendSessionSystemMessage(text) {
    if (!currentRoom || !db || !text) return;
    trackMultiplayerPromise(
        db.ref(`rooms/${currentRoom}/chat`).push({ sender: 'Fluxo', text, createdAt: Date.now(), system: true }),
        'enviar aviso da sessao'
    );
}

function requestSessionSkipVote() {
    if (!currentRoom || !db) return;

    if (isHost && (!roomSettings.skipVotingEnabled || roomSettings.hostCanSkipVote)) {
        skipToNextFromSessionVote('host');
        return;
    }

    if (!roomSettings.skipVotingEnabled) return;

    trackMultiplayerPromise(
        db.ref(`rooms/${currentRoom}/skipVotes/${myUid}`).set({ name: myName, votedAt: Date.now() }),
        'votar para pular musica'
    );
}

function skipToNextFromSessionVote(source = 'vote') {
    if (!isHost || skipVoteInProgress) return;
    skipVoteInProgress = true;
    noteManualPlaybackControl();
    try {
        if (currentIndex < queue.length - 1) {
            transitionToTrack(currentIndex + 1, isCrossfade);
        } else if (roomSettings.sessionRadioEnabled || isAutoMix) {
            ensureAutoMixNextTrack().then(() => {
                if (currentIndex < queue.length - 1) transitionToTrack(currentIndex + 1, false);
            }).catch(error => console.log('Radio da sessao falhou ao pular:', error.message));
        } else if (loopMode === 1 && queue.length > 0) {
            transitionToTrack(0, false);
        }

        if (db && currentRoom) db.ref(`rooms/${currentRoom}/skipVotes`).remove().catch(() => {});
    } finally {
        setTimeout(() => { skipVoteInProgress = false; }, source === 'host' ? 900 : 1500);
    }
}

function evaluateSessionSkipVotes() {
    if (!isHost || !roomSettings.skipVotingEnabled) return;
    const members = Math.max(1, Object.keys(sessionUsers || {}).length);
    const needed = Math.max(1, Math.ceil(members * 0.5));
    const votes = Object.keys(sessionSkipVotes || {}).length;
    if (votes >= needed) skipToNextFromSessionVote('vote');
}

function submitSessionDirectTrack(track) {
    const normalized = normalizeTrack(track);
    if (!normalized || !currentRoom || !db) return Promise.resolve(false);
    return trackMultiplayerPromise(
        db.ref(`rooms/${currentRoom}/directQueue`).push({
            track: normalized,
            sender: myName,
            createdAt: Date.now()
        }),
        'adicionar proxima musica direto'
    ).then(Boolean);
}

// ========================================================
// LISTENERS DO MULTIPLAYER
// ========================================================
function setupRoomListeners() {
    if (!db || !currentRoom) return;
    const roomRef = db.ref('rooms/' + currentRoom);

    roomRef.off();
    roomRef.child(`users/${myUid}`).off();
    roomRef.child('entryRequests').off();
    roomRef.child('musicRequests').off();
    roomRef.child('chat').off();
    roomRef.child('users').off();
    roomRef.child('directQueue').off();
    roomRef.child('skipVotes').off();
    roomRef.child('queueVotes').off();
    roomRef.child('reactions').off();

    roomRef.child(`users/${myUid}`).on('value', snap => {
        if(!snap.exists() && currentRoom) renderKickedUI("VOCÊ FOI REMOVIDO PELO ANFITRIÃO");
    }, error => handleMultiplayerFirebaseError(error, 'ler sua presenca na sala'));

    if (isHost) {
        roomRef.child('entryRequests').on('value', snap => {
            const reqs = snap.val() || {};
            const list = document.getElementById('entryRequestsList');
            if (!list) return;
            list.innerHTML = '';
            Object.keys(reqs).forEach(uid => {
                if (reqs[uid].status === 'pending') {
                    const item = document.createElement('div');
                    item.className = "result-item";
                    item.style.padding = "12px";
                    item.innerHTML = `<div><i class="ph ph-user-plus"></i> ${reqs[uid].name}</div><div style="display:flex; gap:10px;"><button class="btn-confirm" onclick="acceptEntry('${uid}')">ACEITAR</button><button class="btn-abort" onclick="rejectEntry('${uid}')">RECUSAR</button></div>`;
                    list.appendChild(item);
                    if(!document.querySelector('.mp-tab[data-target="mp-entry"]').classList.contains('active')) document.getElementById('entryBadge').style.display = 'inline';
                }
            });
        }, error => handleMultiplayerFirebaseError(error, 'ler pedidos de entrada'));

        roomRef.child('musicRequests').on('value', snap => {
            const reqs = snap.val() || {};
            const list = document.getElementById('requestsList');
            if(!list) return;
            list.innerHTML = '';
            let pendingCount = 0;
            Object.keys(reqs).forEach(rid => {
                if(reqs[rid].status === 'pending') {
                    pendingCount++;
                    const item = document.createElement('div');
                    item.className = "result-item";
                    item.innerHTML = `<div class="result-info"><span>${reqs[rid].track.title}</span><br><small>Por: ${reqs[rid].sender} - "${reqs[rid].message}"</small></div><div style="display:flex; gap:10px;"><button class="btn-confirm" onclick="acceptMusic('${rid}')">ADD</button><button class="btn-abort" onclick="rejectMusic('${rid}')">X</button></div>`;
                    list.appendChild(item);
                }
            });
            const badge = document.getElementById('reqBadge');
            if (badge) {
                badge.innerText = String(pendingCount);
                badge.style.display = pendingCount && !document.querySelector('.mp-tab[data-target="mp-requests"]')?.classList.contains('active') ? 'inline-flex' : 'none';
            }
            if(list.innerHTML === '') list.innerHTML = "Nenhuma sugestão pendente.";
        }, error => handleMultiplayerFirebaseError(error, 'ler sugestoes de musica'));

        roomRef.child('directQueue').on('child_added', snap => {
            const req = snap.val();
            const directTrack = normalizeTrack(req?.track);
            if (directTrack) {
                enqueueTrack({ ...directTrack, requestedBy: req?.sender || 'Convidado', requestedAt: Date.now() }, 'next');
                sortSessionQueueByPriority();
                sendSessionSystemMessage(`${req?.sender || 'Convidado'} colocou "${directTrack.title}" como proxima.`);
            }
            snap.ref.remove().catch(() => {});
        }, error => handleMultiplayerFirebaseError(error, 'ler fila direta'));
    }

    roomRef.child('users').on('value', snap => {
        sessionUsers = snap.val() || {};
        const list = document.getElementById('usersList');
        if (list) {
            const userEntries = Object.entries(sessionUsers);
            list.innerHTML = userEntries.length ? userEntries.map(([uid, user]) => `
                <li class="mp-user-row">
                    <div><i class="ph ${user.isHost ? 'ph-crown-simple' : 'ph-user'}"></i><span>${escapeHtml(user.name || 'USER')}</span>${user.isHost ? '<small>HOST</small>' : ''}</div>
                    ${isHost && uid !== myUid ? `<button class="btn-abort" onclick="kickUser('${uid}')">KICK</button>` : ''}
                </li>
            `).join('') : '<li class="mp-empty">Nenhum membro listado.</li>';
        }
    }, error => handleMultiplayerFirebaseError(error, 'ler membros da sala'));

    roomRef.child('skipVotes').on('value', snap => {
        sessionSkipVotes = snap.val() || {};
        evaluateSessionSkipVotes();
        const voteCard = document.querySelector('.mp-vote-card strong');
        if (voteCard) {
            const members = Math.max(1, Object.keys(sessionUsers || {}).length);
            const needed = Math.max(1, Math.ceil(members * 0.5));
            voteCard.innerText = `${Object.keys(sessionSkipVotes).length}/${needed} votos`;
        }
    }, error => handleMultiplayerFirebaseError(error, 'ler votos para pular'));

    roomRef.child('queueVotes').on('value', snap => {
        sessionQueueVotes = snap.val() || {};
        renderSessionQueueList(queue, sessionPlayedTracks);
        if (isHost && roomSettings.priorityQueueEnabled) sortSessionQueueByPriority();
    }, error => handleMultiplayerFirebaseError(error, 'ler votos da fila'));

    roomRef.child('reactions').limitToLast(90).on('value', snap => {
        sessionReactions = snap.val() || {};
        renderSessionReactionFeed();
        renderSessionQueueList(queue, sessionPlayedTracks);
        renderSessionRanking();
    }, error => handleMultiplayerFirebaseError(error, 'ler reacoes da sessao'));

    roomRef.child('chat').on('child_added', snap => {
        const msg = snap.val();
        const box = document.getElementById('chatBox');
        if (box) {
            const cls = msg.system ? 'mp-chat-msg system' : 'mp-chat-msg';
            box.innerHTML += `<div class="${cls}"><b>${escapeHtml(msg.sender || 'USER')}:</b> ${escapeHtml(msg.text || '')}</div>`;
            box.scrollTop = box.scrollHeight;
        }
    }, error => handleMultiplayerFirebaseError(error, 'ler chat'));

    roomRef.on('value', snap => {
        const data = snap.val(); 
        if(!data) { 
            if(!isHost && currentRoom) renderKickedUI("A SALA FOI ENCERRADA PELO ANFITRIÃO"); 
            return; 
        }
        
        if (data.settings) roomSettings = normalizeRoomSettings(data.settings);
        sessionPinnedTrackKey = String(data.pinnedTrackKey || '');
        if (isHost && roomSettings.sessionRadioEnabled && !isAutoMix) {
            isAutoMix = true;
            document.getElementById('autoMixBtn')?.classList.add('active');
        }
        sessionPlayedTracks = Array.isArray(data.played) ? data.played.map(normalizeTrack).filter(Boolean) : sessionPlayedTracks;
        const sharedQueue = Array.isArray(data.queue) ? data.queue.map(normalizeTrack).filter(Boolean) : [];
        if (sharedQueue.length) {
            if (isHost) syncHostQueueFromSharedQueue(sharedQueue);
            else {
                queue = sharedQueue;
                originalQueue = sharedQueue.slice();
            }
        }
        renderSharedQueue(sharedQueue, roomSettings.queueVisible);
        renderSessionQueueList(sharedQueue.length ? sharedQueue : queue, sessionPlayedTracks);
        renderSessionRanking();

        if (!isHost && data.eq) {
            const eqStamp = JSON.stringify({
                p: data.eq.eqPreset,
                d: data.eq.dspProfile,
                r: data.eq.playbackRate,
                v: data.eq.reverbMix,
                g: data.eq.eqGains,
                c: data.eq.compressor
            });
            if (eqStamp !== lastAppliedSessionEqStamp) {
                try {
                    applySharedPresetPayload({ ...data.eq, type: 'sound-preset' });
                    lastAppliedSessionEqStamp = eqStamp;
                } catch (error) {
                    console.warn('Falha ao aplicar EQ da sessao:', error);
                }
            }
        }

        if (!isHost && lastAppliedSessionVideoMode !== roomSettings.videoEnabled) {
            lastAppliedSessionVideoMode = roomSettings.videoEnabled;
            setVideoUiState(Boolean(roomSettings.videoEnabled));
            if (audioPlayer.src && sharedTrackIdMatches(data.track)) {
                reloadCurrentPlaybackStream(roomSettings.videoEnabled ? 'video' : 'audio').catch(error => console.warn('Falha ao sincronizar modo video:', error));
            }
        }

        if (!isHost && !data.track) {
            withRemotePlaybackGuard(async () => {
                audioPlayer.pause();
                destroyHlsController('main');
                audioPlayer.src = '';
            });
            audioPlayer.dataset.id = '';
            titleEl.innerText = "SALA SEM FAIXA";
            artistEl.innerText = "Aguardando o anfitrião";
            coverEl.style.backgroundImage = '';
            if (coverIcon) coverIcon.style.display = 'block';
            return;
        }

        const sharedTrack = normalizeTrack(data.track);

        if (!isHost && sharedTrack && sharedTrack.id !== audioPlayer.dataset.id) {
            audioPlayer.dataset.id = sharedTrack.id; 
            const queueIndex = findTrackIndexByIdentity(queue, sharedTrack);
            if (queueIndex >= 0) currentIndex = queueIndex;
            
            if(previewPlayer && !previewPlayer.paused) previewPlayer.pause();
            withRemotePlaybackGuard(async () => audioPlayer.pause());
            destroyHlsController('main');
            audioPlayer.src = ''; 
            
            titleEl.innerText = "SINCRO: " + sharedTrack.title; 
            artistEl.innerText = sharedTrack.artist;
            coverEl.style.backgroundImage = sharedTrack.thumbnail ? `url('${sharedTrack.thumbnail}')` : '';
            
            const sessionPlaybackMode = roomSettings.videoEnabled ? 'video' : 'audio';
            setVideoUiState(Boolean(roomSettings.videoEnabled));
            resolvePlayableStreamForTrack(sharedTrack, sessionPlaybackMode).then(async resolvedStream => {
                if (audioPlayer.dataset.id === sharedTrack.id && resolvedStream?.url) {
                    if (sessionPlaybackMode !== 'audio' && resolvedStream.mode === 'audio') {
                        setVideoUiState(false);
                    }
                    setMediaElementSource(audioPlayer, resolvedStream.url, 'main');
                    await waitForMediaMetadata(audioPlayer).catch(() => {});
                    titleEl.innerText = sharedTrack.title; 
                    const expectedTime = getSharedExpectedTime(data);
                    if (data.state === 'playing') {
                        if (Number.isFinite(audioPlayer.duration) && audioPlayer.duration > expectedTime + 0.5) {
                            audioPlayer.currentTime = expectedTime;
                        }
                        if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
                        withRemotePlaybackGuard(() => audioPlayer.play().catch(e => console.log("Sincro Play Error:", e)));
                    } else {
                        audioPlayer.currentTime = Math.min(expectedTime, Math.max(0, (audioPlayer.duration || expectedTime + 1) - 0.5));
                    }
                }
            }).catch(error => {
                if (audioPlayer.dataset.id !== sharedTrack.id) return;
                const reason = classifyMediaError(error, 'Nao foi possivel sincronizar o stream da sala.');
                titleEl.innerText = 'ERRO DE STREAM DA SALA';
                artistEl.innerText = reason;
                recordMediaIssue(sharedTrack, reason, sessionPlaybackMode, error);
            });
            return; 
        }

        if (!isHost && !ignoreSync && sharedTrack && audioPlayer.dataset.id === sharedTrack.id && audioPlayer.src) {
            ignoreSync = true;
            
            let expectedTime = getSharedExpectedTime(data);

            const diff = Math.abs(audioPlayer.currentTime - expectedTime);
            
            if (data.state === 'playing') {
                if (diff > 0.9) audioPlayer.currentTime = expectedTime;
                if (audioPlayer.paused && audioPlayer.readyState >= 3) {
                    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
                    withRemotePlaybackGuard(() => audioPlayer.play().catch(e => console.log("Play sync error:", e)));
                }
            } else {
                if (!audioPlayer.paused) withRemotePlaybackGuard(async () => audioPlayer.pause());
                if (diff > 0.9) audioPlayer.currentTime = expectedTime;
            }
            setTimeout(() => ignoreSync = false, 500);
        }
    }, error => handleMultiplayerFirebaseError(error, 'ler estado da sala'));
}

window.acceptEntry = (uid) => trackMultiplayerPromise(
    db.ref(`rooms/${currentRoom}/entryRequests/${uid}`).update({ status: 'accepted' }),
    'aceitar entrada'
);
window.rejectEntry = (uid) => trackMultiplayerPromise(
    db.ref(`rooms/${currentRoom}/entryRequests/${uid}`).update({ status: 'rejected' }),
    'recusar entrada'
);
window.kickUser = (uid) => trackMultiplayerPromise(
    db.ref(`rooms/${currentRoom}/users/${uid}`).remove(),
    'remover membro'
);

window.acceptMusic = (rid) => {
    db.ref(`rooms/${currentRoom}/musicRequests/${rid}`).once('value', s => {
        const r = s.val();
        if(r) { 
            const acceptedTrack = normalizeTrack(r.track);
            enqueueTrack({ ...acceptedTrack, requestedBy: r.sender || 'Convidado', requestedAt: Date.now() }, 'next');
            sortSessionQueueByPriority();
            sendSessionSystemMessage(`${r.sender || 'Convidado'} teve "${acceptedTrack.title}" adicionada pelo host.`);
        }
        return trackMultiplayerPromise(
            db.ref(`rooms/${currentRoom}/musicRequests/${rid}`).update({status:'accepted'}),
            'aceitar sugestao de musica'
        );
    }).catch(error => handleMultiplayerFirebaseError(error, 'ler sugestao de musica'));
};
window.rejectMusic = (rid) => trackMultiplayerPromise(
    db.ref(`rooms/${currentRoom}/musicRequests/${rid}`).update({status:'rejected'}),
    'recusar sugestao de musica'
);

// ========================================================
// MOTOR DE BUSCA (AGORA COM SPOTIFY, DOWNLOAD E PROTEÇÃO)
// ========================================================
let isSearchRunning = false;

function setSearchBusy(isBusy) {
    if (!btnSearch) return;
    btnSearch.disabled = isBusy;
    btnSearch.classList.toggle('is-loading', isBusy);
    btnSearch.innerHTML = isBusy
        ? '<i class="ph ph-spinner-gap ph-spin"></i>'
        : '<i class="ph ph-magnifying-glass"></i>';
}

function getSearchUrlKind(value) {
    const raw = String(value || '').trim();
    const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i);
    if (!urlMatch) return { type: '', isCollection: false };

    let parsed;
    try {
        parsed = new URL(urlMatch[0].replace(/[)\],.;]+$/g, ''));
    } catch {
        return { type: '', isCollection: false };
    }

    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const isYouTube = host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com');
    const isSoundCloud = host === 'soundcloud.com'
        || host.endsWith('.soundcloud.com')
        || host === 'on.soundcloud.com'
        || host.endsWith('.on.soundcloud.com')
        || host === 'snd.sc'
        || host.endsWith('.snd.sc')
        || host === 'soundcloud.app.goo.gl'
        || host.endsWith('.soundcloud.app.goo.gl');

    if (isYouTube) {
        return {
            type: 'youtube',
            isCollection: Boolean(parsed.searchParams.get('list')) || /^\/playlist\/?$/i.test(parsed.pathname) || /^\/mix\/?$/i.test(parsed.pathname)
        };
    }

    if (isSoundCloud) {
        return {
            type: 'soundcloud',
            isCollection: /\/sets\//i.test(parsed.pathname)
                || /(?:^|\.)on\.soundcloud\.com$/i.test(host)
                || /(?:^|\.)snd\.sc$/i.test(host)
                || /soundcloud\.app\.goo\.gl$/i.test(host)
        };
    }

    return { type: '', isCollection: false };
}

async function executeSearch() {
    const rawQuery = searchInput ? searchInput.value.trim() : '';
    if (!rawQuery) {
        if (searchInput) searchInput.focus();
        return;
    }
    if (isSearchRunning) return;

    if (!window.electronAPI?.searchAudio) {
        resultsList.innerHTML = '<li style="padding: 20px; text-align: center; color: var(--neon-pink);">A busca precisa ser executada dentro do Fluxo Music.</li>';
        return;
    }

    isSearchRunning = true;
    setSearchBusy(true);
    try {
        resultsList.innerHTML = '<li style="padding: 20px; text-align: center;"><i class="ph ph-spinner-gap ph-spin" style="font-size:2rem; color:var(--neon-cyan)"></i><br>A Processar dados...</li>';
        
        let query = rawQuery;

        // SE DETECTAR LINK DO SPOTIFY
        if (query.includes('spotify.com') || query.includes('spotify.link')) {
            resultsList.innerHTML = '<li style="padding: 20px; text-align: center;"><i class="ph ph-spinner-gap ph-spin" style="font-size:2rem; color:var(--neon-cyan)"></i><br>Clonando base de dados do Spotify...</li>';

            try {
                const spData = await window.electronAPI.getSpotifyInfo(query);

                if (spData && spData.searchQueries && spData.searchQueries.length > 0) {
                    if (spData.searchQueries.length > 1) {
                        let ghostTracks = spData.searchQueries.map((q, index) => ({
                            id: 'ghost_' + Math.random().toString(36).substr(2, 9),
                            title: q,
                            artist: "Importado do Spotify",
                            thumbnail: "https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png",
                            isGhost: true,
                            query: q 
                        }));
                        renderPlaylistPreview({ title: spData.title, tracks: ghostTracks });
                        return; 
                    } else {
                        query = spData.searchQueries[0]; 
                    }
                } else {
                    resultsList.innerHTML = '<li style="padding: 20px; text-align: center; color: var(--neon-pink);">Falha ao ler as faixas. A playlist é privada?</li>';
                    return;
                }
            } catch (err) {
                console.error("Erro no Spotify:", err);
                resultsList.innerHTML = '<li style="padding: 20px; text-align: center; color: var(--neon-pink);">Erro de conexão com a API do Spotify.</li>';
                return;
            }
        }

        const urlKind = getSearchUrlKind(query);
        if (urlKind.type === 'soundcloud') {
            resultsList.innerHTML = '<li style="padding: 20px; text-align: center;"><i class="ph ph-spinner-gap ph-spin" style="font-size:2rem; color:var(--neon-cyan)"></i><br>Importando faixa, set ou playlist do SoundCloud...</li>';
        } else if (urlKind.type === 'youtube') {
            resultsList.innerHTML = `<li style="padding: 20px; text-align: center;"><i class="ph ph-spinner-gap ph-spin" style="font-size:2rem; color:var(--neon-cyan)"></i><br>${urlKind.isCollection ? 'Importando playlist ou mix do YouTube...' : 'Importando link do YouTube...'}</li>`;
        }

        // BUSCA PADRÃO (YOUTUBE / TERMOS)
        try {
            const data = await searchAudioTracks(query);
            resultsList.innerHTML = '';
            
            // Graças ao interceptador no topo, 'data' sempre terá .tracks
            const faixas = data?.tracks || [];

            if (faixas.length === 0) {
                resultsList.innerHTML = '<li style="padding: 20px; text-align: center; color: var(--neon-pink);">Nenhum resultado encontrado.</li>';
                return;
            }

            if (data?.isCollection && faixas.length > 1) {
                warmTrackStreams(faixas, 'audio', 3);
                renderPlaylistPreview({
                    title: data.title || (data.source ? `${data.source} importado` : 'Playlist importada'),
                    tracks: faixas
                });
                return;
            }

            warmTrackStreams(faixas, 'audio', 3);

            faixas.forEach(t => {
                const li = document.createElement('li'); li.className = 'result-item';
                
                li.innerHTML = `
                    <div class="result-thumb" style="background-image:url('${t.thumbnail}'); position: relative; cursor: pointer;">
                        <div class="preview-overlay" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); opacity:0; transition:0.2s; border-radius:inherit;">
                            <i class="ph ph-play-circle btn-preview" style="font-size:2rem; color:var(--neon-cyan);"></i>
                        </div>
                    </div>
                    <div class="result-info" style="cursor:pointer; flex:1;">
                        <span class="result-title">${t.title}</span><br>
                        <span class="result-artist" style="font-size:0.8rem; color:var(--text-muted);">${t.artist || 'Desconhecido'}</span>
                    </div>
                    
                    ${getFavoriteButtonHtml(t)}
                    <button class="btn-action btn-download" title="Descarregar Áudio" style="margin-left: 10px; padding: 10px;"><i class="ph ph-download-simple"></i></button>
                    <button class="btn-action btn-play-next" title="Tocar a seguir" style="margin-left: 10px; padding: 10px;"><i class="ph ph-arrow-bend-down-right"></i></button>
                    <button class="btn-action btn-radio-seed" title="Criar radio desta musica" style="margin-left: 10px; padding: 10px;"><i class="ph ph-broadcast"></i></button>

                    <button class="btn-save btn-playlist" title="Guardar na Playlist" style="margin-left: 10px; padding: 10px;"><i class="ph ph-list-plus"></i></button>
                    <button class="btn-confirm btn-add" title="Adicionar à Fila" style="margin-left: 10px;">${(currentRoom && !isHost) ? (roomSettings.directQueueEnabled ? 'PROXIMA' : 'SUGERIR') : 'ADD'}</button>
                `;

                li.addEventListener('mouseenter', () => prefetchStream(t, 'audio'), { once: true });
                
                // Eventos de Preview e Interface
                const thumb = li.querySelector('.result-thumb'); const overlay = li.querySelector('.preview-overlay');
                thumb.onmouseenter = () => overlay.style.opacity = '1'; thumb.onmouseleave = () => overlay.style.opacity = '0';
                const previewBtn = li.querySelector('.btn-preview');
                bindFavoriteButton(li, t);
                
                thumb.onclick = async (ev) => {
                    ev.stopPropagation(); 
                    if (previewPlayer.src && !previewPlayer.paused && previewPlayer.dataset.id === t.id) {
                        previewPlayer.pause(); previewBtn.classList.replace('ph-pause-circle', 'ph-play-circle');
                    } else {
                        document.querySelectorAll('.btn-preview').forEach(b => b.classList.replace('ph-pause-circle', 'ph-play-circle'));
                        previewBtn.classList.replace('ph-play-circle', 'ph-spinner-gap'); previewBtn.classList.add('ph-spin');
                        const resolvedPreview = await resolvePlayableStreamForTrack(t, 'audio');
                        const url = resolvedPreview?.url;
                        if(url) {
                            setMediaElementSource(previewPlayer, url, 'preview');
                            previewPlayer.dataset.id = t.id;
                            previewPlayer.play();
                        }
                        previewBtn.classList.remove('ph-spinner-gap', 'ph-spin'); previewBtn.classList.add('ph-pause-circle');
                    }
                };

                // Evento de Download
                li.querySelector('.btn-download').onclick = async (ev) => {
                    ev.stopPropagation();
                    const btn = ev.currentTarget;
                    const oldHtml = btn.innerHTML;
                    btn.innerHTML = "<i class='ph ph-spinner-gap ph-spin'></i>";
                    
                    try {
                        const res = await downloadTrack(t);
                        if (res.success) {
                            addToMusicInbox(t, 'download');
                            btn.innerHTML = "<i class='ph ph-check'></i>";
                            btn.style.color = "var(--neon-cyan)";
                            btn.style.borderColor = "var(--neon-cyan)";
                        } else throw new Error();
                    } catch (e) {
                        btn.innerHTML = "<i class='ph ph-warning'></i>";
                        btn.style.color = "var(--neon-pink)";
                        btn.style.borderColor = "var(--neon-pink)";
                    }
                    setTimeout(() => { btn.innerHTML = oldHtml; btn.style.color = ""; btn.style.borderColor = ""; }, 3000);
                };

                li.querySelector('.btn-radio-seed').onclick = async (ev) => {
                    ev.stopPropagation();
                    await startRadioFromTrack(t);
                };

                li.querySelector('.btn-play-next').onclick = (ev) => {
                    ev.stopPropagation();
                    enqueueTrack(t, 'next');
                    const btn = ev.currentTarget;
                    const oldHtml = btn.innerHTML;
                    btn.innerHTML = "<i class='ph ph-check'></i>";
                    setTimeout(() => btn.innerHTML = oldHtml, 1200);
                };

                // Tocar a música inteira ao clicar no texto
                li.querySelector('.result-info').onclick = () => { 
                    if(currentRoom && !isHost) return; 
                    playTrackNow(t);
                };

                // Salvar em Playlist Local
                li.querySelector('.btn-playlist').onclick = (ev) => {
                    ev.stopPropagation();
                    if(savedPlaylists.length === 0) {
                        const btn = ev.currentTarget;
                        const oldText = btn.innerHTML;
                        btn.innerHTML = "<i class='ph ph-warning'></i>";
                        btn.style.color = "var(--neon-pink)";
                        btn.style.borderColor = "var(--neon-pink)";
                        setTimeout(() => { btn.innerHTML = oldText; btn.style.color = ""; btn.style.borderColor = ""; }, 2000);
                        return;
                    }
                    
                    document.querySelectorAll('.pl-dropdown').forEach(el => el.remove());

                    const drop = document.createElement('div');
                    drop.className = 'pl-dropdown';
                    drop.style.cssText = "position:absolute; right:50px; top:40px; background:var(--bg-panel); border:var(--border-tech); padding:10px; z-index:999; display:flex; flex-direction:column; gap:5px; max-height:200px; overflow-y:auto; box-shadow: var(--shadow-glow); border-radius: var(--item-radius);";
                    
                    const titleDrop = document.createElement('div');
                    titleDrop.style.cssText = "color:var(--neon-cyan); font-size:0.8rem; margin-bottom:5px; font-weight:bold; text-align:center;";
                    titleDrop.innerText = "SALVAR EM:";
                    drop.appendChild(titleDrop);

                    savedPlaylists.forEach((p, idx) => {
                        const b = document.createElement('button');
                        b.className = "btn-action";
                        b.style.justifyContent = "center";
                        b.innerText = p.title;
                        b.onclick = (e2) => {
                            e2.stopPropagation();
                            if (savedPlaylists[idx].locked) {
                                alert('Playlist bloqueada. Desbloqueie antes de adicionar musicas.');
                                return;
                            }
                            savedPlaylists[idx].tracks.push(t);
                            savePlaylists();
                            drop.remove();
                            const btnSave = li.querySelector('.btn-playlist');
                            const oldText = btnSave.innerHTML;
                            btnSave.innerHTML = "<i class='ph ph-check'></i>";
                            btnSave.style.color = "var(--neon-cyan)";
                            btnSave.style.borderColor = "var(--neon-cyan)";
                            setTimeout(() => { btnSave.innerHTML = oldText; btnSave.style.color = ""; btnSave.style.borderColor = ""; }, 1500);
                        };
                        drop.appendChild(b);
                    });

                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = "btn-abort";
                    cancelBtn.style.marginTop = "5px";
                    cancelBtn.innerText = "CANCELAR";
                    cancelBtn.onclick = (e2) => { e2.stopPropagation(); drop.remove(); };
                    drop.appendChild(cancelBtn);

                    li.style.position = "relative";
                    li.appendChild(drop);
                };

                // Adicionar à Fila ou Sugerir (Multiplayer)
                li.querySelector('.btn-add').onclick = (ev) => { 
                    ev.stopPropagation(); 
                    if(currentRoom && !isHost) {
                        if (roomSettings.directQueueEnabled) {
                            submitSessionDirectTrack(t).then(sent => {
                                const btn = ev.currentTarget;
                                const oldText = btn.innerHTML;
                                btn.innerHTML = sent ? "<i class='ph ph-check'></i> PROXIMA!" : "<i class='ph ph-warning'></i> FALHOU";
                                setTimeout(() => btn.innerHTML = oldText, 1500);
                            });
                            return;
                        }
                        if (roomSettings.requestsMuted) {
                            const btn = ev.currentTarget;
                            const oldText = btn.innerHTML;
                            btn.innerHTML = "<i class='ph ph-bell-slash'></i> MUTADO";
                            setTimeout(() => btn.innerHTML = oldText, 1500);
                            return;
                        }
                        document.getElementById('reqModalTrackInfo').innerText = `${t.title} - ${t.artist}`;
                        document.getElementById('requestModal').style.display = 'flex';
                        
                        document.getElementById('btnSendRequest').onclick = async () => {
                            const comment = document.getElementById('reqModalMsg').value.trim() || "Toca essa por favor!";
                            const btnSend = document.getElementById('btnSendRequest');
                            const origText = btnSend.innerHTML;

                            btnSend.disabled = true;
                            btnSend.innerHTML = "<i class='ph ph-spinner-gap ph-spin'></i> ENVIANDO...";

                            try {
                                await db.ref(`rooms/${currentRoom}/musicRequests`).push({track: t, sender: myName, message: comment, status: 'pending'});
                                btnSend.innerHTML = "<i class='ph ph-check'></i> ENVIADO!";
                                btnSend.style.backgroundColor = "var(--neon-cyan)";
                                btnSend.style.color = "#000";

                                setTimeout(() => {
                                    document.getElementById('requestModal').style.display = 'none';
                                    document.getElementById('reqModalMsg').value = '';
                                    btnSend.innerHTML = origText;
                                    btnSend.style.backgroundColor = "";
                                    btnSend.style.color = "";
                                    btnSend.disabled = false;
                                }, 1500);
                            } catch (error) {
                                btnSend.disabled = false;
                                btnSend.innerHTML = origText;
                                handleMultiplayerFirebaseError(error, 'enviar sugestao de musica');
                            }
                        };
                    } else {
                        enqueueTrack(t, 'end');
                        
                        const btn = ev.target;
                        const oldText = btn.innerHTML;
                        btn.innerHTML = "<i class='ph ph-check'></i> ADICIONADO";
                        setTimeout(() => btn.innerHTML = oldText, 1500);
                    }
                };
                resultsList.appendChild(li);
            });
    } catch (err) {
        console.error("Erro fatal na busca principal:", err);
        resultsList.innerHTML = `
            <li class="lab-card solo-panel">
                <div class="lab-card-head">
                    <i class="ph ph-warning-circle"></i>
                    <h3>Busca indisponivel</h3>
                </div>
                <p class="lab-status">Falha ao consultar YouTube ou SoundCloud agora. Tente novamente ou rode o diagnostico de rede.</p>
                <div class="lab-actions">
                    <button class="btn-confirm" id="btnRetrySearchAfterError"><i class="ph ph-arrow-clockwise"></i> TENTAR DE NOVO</button>
                    <button class="btn-action" id="btnSearchNetworkDiag"><i class="ph ph-pulse"></i> DIAGNOSTICO</button>
                </div>
            </li>`;
        document.getElementById('btnRetrySearchAfterError')?.addEventListener('click', executeSearch);
        document.getElementById('btnSearchNetworkDiag')?.addEventListener('click', renderNetworkDiagnosticsPanel);
    }
    } finally {
        isSearchRunning = false;
        setSearchBusy(false);
    }
}

if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            executeSearch();
        }
    });
}

if (btnSearch) {
    btnSearch.addEventListener('click', (e) => {
        e.preventDefault();
        executeSearch();
    });
}

const globalSearchOverlay = document.getElementById('globalSearchOverlay');
const globalSearchInput = document.getElementById('globalSearchInput');
const globalSearchResults = document.getElementById('globalSearchResults');

function collectGlobalSearchPool() {
    const playlistTracks = savedPlaylists.flatMap(playlist => (playlist.tracks || []).map(track => ({ ...track, context: playlist.title })));
    const pools = [
        ...queue.map(track => ({ ...track, context: 'Fila atual' })),
        ...trackInbox.map(track => ({ ...track, context: 'Inbox' })),
        ...favoriteTracks.map(track => ({ ...track, context: 'Favoritas' })),
        ...playHistory.map(track => ({ ...track, context: 'Historico' })),
        ...playlistTracks
    ];
    const seen = new Set();
    return pools.map(normalizeTrack).filter(track => {
        const key = getTrackKey(track);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function closeGlobalSearchOverlay() {
    globalSearchOverlay?.classList.remove('open');
    globalSearchOverlay?.setAttribute('aria-hidden', 'true');
}

function openGlobalSearchOverlay(seed = '') {
    if (!globalSearchOverlay || !globalSearchInput) return;
    globalSearchOverlay.classList.add('open');
    globalSearchOverlay.setAttribute('aria-hidden', 'false');
    globalSearchInput.value = seed;
    renderGlobalSearchResults();
    setTimeout(() => globalSearchInput.focus(), 30);
}

function renderGlobalSearchResults() {
    if (!globalSearchResults || !globalSearchInput) return;
    const query = normalizeLookupText(globalSearchInput.value);
    const pool = collectGlobalSearchPool();
    const matches = query
        ? pool.filter(track => normalizeLookupText(`${track.title} ${track.artist}`).includes(query)).slice(0, 8)
        : pool.slice(0, 8);

    globalSearchResults.innerHTML = `
        ${matches.map(track => `
            <button class="global-result" data-key="${escapeHtml(getTrackKey(track))}">
                <span>${escapeHtml(track.title)}</span>
                <small>${escapeHtml(track.artist || 'Fluxo')}</small>
            </button>
        `).join('') || '<p class="lab-status">Digite para buscar no Fluxo ou pressione Enter para buscar no YouTube.</p>'}
        <button class="global-result global-youtube" id="btnGlobalYouTube"><span>Buscar no YouTube/SoundCloud</span><small>${escapeHtml(globalSearchInput.value || 'Digite algo')}</small></button>
    `;

    globalSearchResults.querySelectorAll('.global-result[data-key]').forEach(btn => {
        btn.onclick = () => {
            const track = pool.find(item => getTrackKey(item) === btn.dataset.key);
            if (track) playTrackNow(track);
            closeGlobalSearchOverlay();
        };
    });
    document.getElementById('btnGlobalYouTube').onclick = () => {
        searchInput.value = globalSearchInput.value;
        closeGlobalSearchOverlay();
        executeSearch();
    };
}

globalSearchInput?.addEventListener('input', renderGlobalSearchResults);
globalSearchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeGlobalSearchOverlay();
    if (event.key === 'Enter') {
        searchInput.value = globalSearchInput.value;
        closeGlobalSearchOverlay();
        executeSearch();
    }
});
document.getElementById('btnCloseGlobalSearch')?.addEventListener('click', closeGlobalSearchOverlay);
globalSearchOverlay?.addEventListener('click', event => {
    if (event.target === globalSearchOverlay) closeGlobalSearchOverlay();
});

document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target?.matches?.('input, textarea, select') || target?.isContentEditable;
    if (!typing && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        runRecoveryMode();
        return;
    }
    if (!typing && event.key === 'Escape') {
        if (document.body.classList.contains('mini-mode')) {
            event.preventDefault();
            exitMiniPlayer();
            return;
        }
        if (document.body.classList.contains('party-mode')) {
            event.preventDefault();
            document.getElementById('btnExitParty')?.click();
            return;
        }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openGlobalSearchOverlay('');
        return;
    }
    if (!typing && event.key === '/') {
        event.preventDefault();
        openGlobalSearchOverlay('');
    }
});

function getTargetVolume() {
    const slider = document.getElementById('volumeSlider');
    return clampNumber(slider?.value, 0, 1, 0.5);
}

function fadeMainVolume(targetVolume, duration = 700) {
    return new Promise(resolve => {
        const startVolume = audioPlayer.volume;
        const target = clampNumber(targetVolume, 0, 1, getTargetVolume());
        const start = performance.now();

        function step(now) {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            audioPlayer.volume = startVolume + (target - startVolume) * eased;
            if (progress < 1) requestAnimationFrame(step);
            else {
                audioPlayer.volume = target;
                resolve();
            }
        }

        requestAnimationFrame(step);
    });
}

function shuffleTracks(tracks) {
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function findTrackIndexByIdentity(tracks, targetTrack) {
    const directIndex = tracks.indexOf(targetTrack);
    if (directIndex !== -1) return directIndex;

    const normalizedTarget = normalizeTrack(targetTrack);
    const targetFingerprint = getTrackFingerprint(normalizedTarget);
    return tracks.findIndex(track => {
        const normalizedTrack = normalizeTrack(track);
        if (!normalizedTrack || !normalizedTarget) return false;
        if (normalizedTrack.id && normalizedTarget.id && normalizedTrack.id === normalizedTarget.id) return true;
        return targetFingerprint && getTrackFingerprint(normalizedTrack) === targetFingerprint;
    });
}

async function ensureAutoMixNextTrack() {
    if (!isAutoMix || currentIndex !== queue.length - 1) return false;
    if (autoMixRequestInFlight) return autoMixRequestInFlight;

    autoMixRequestInFlight = (async () => {
        const currentTrack = normalizeTrack(queue[currentIndex]);
        if (!autoMixSeedTrack) autoMixSeedTrack = normalizeTrack(queue[0]) || currentTrack;
        const nextMixTrack = await getSmartAutoMixTrack(currentTrack, autoMixSeedTrack);
        if (!nextMixTrack || currentIndex !== queue.length - 1) return false;

        queue.push(nextMixTrack);
        originalQueue.push(nextMixTrack);
        prefetchStream(nextMixTrack, isVideoMode ? 'video' : 'audio');
        publishRoomState();
        if (isQueueViewActive()) document.getElementById('btnQueueView').click();
        return true;
    })();

    try {
        return await autoMixRequestInFlight;
    } finally {
        autoMixRequestInFlight = null;
    }
}

async function transitionToTrack(index, smooth = isCrossfade) {
    if (!queue[index] || isSmoothTransitioning) return;
    isSmoothTransitioning = true;
    const fadeDuration = getSmartFadeDuration(queue[index]);
    try {
        if (smooth && !audioPlayer.paused) {
            const syncDelay = getBeatSyncDelay(queue[index]);
            if (syncDelay > 0) await new Promise(resolve => setTimeout(resolve, syncDelay));
            await fadeMainVolume(0, fadeDuration);
        }
        await loadAndPlayTrack(index, { fadeIn: smooth });
    } finally {
        isSmoothTransitioning = false;
    }
}

async function loadAndPlayTrack(index, options = {}) {
    if(!queue[index]) return;
    clearMediaFailureAction();
    if (previewPlayer && !previewPlayer.paused) { previewPlayer.pause(); document.querySelectorAll('.btn-preview').forEach(b => b.classList.replace('ph-pause-circle', 'ph-play-circle')); }
    initEQ(); 
    
    let t = normalizeTrack(queue[index]);

    if (t.isGhost) {
        titleEl.innerText = 'CONVERTENDO NO YOUTUBE...';
        try {
            t = await resolveGhostTrack(t);
            queue[index] = t;
            if (originalQueue[index]) originalQueue[index] = t;
        } catch {
            titleEl.innerText = 'FALHA NA CONVERSAO';
            setTimeout(() => document.getElementById('nextBtn').click(), 2000);
            return;
        }
    } else {
        queue[index] = t;
    }

    const analysis = getTrackMusicAnalysis(t);
    if (analysis) {
        t = { ...t, bpm: analysis.bpm, musicalKey: analysis.key };
        queue[index] = t;
    }

    if (localStorage.getItem('fluxo_eq_auto') === 'true') {
        applyEqPreset(detectEqPresetForTrack(t), false);
    }

    currentIndex = index;
    smartPrefetchUpcoming('track-start');
    
    titleEl.innerText = t.title;
    artistEl.innerText = 'Resolvendo stream...';
    coverEl.style.backgroundImage = t.thumbnail ? `url('${t.thumbnail}')` : '';
    coverIcon.style.display = t.thumbnail ? 'none' : 'block';
    audioPlayer.dataset.id = t.id; 

    audioPlayer.pause();
    const playbackMode = isVideoMode ? 'video' : 'audio';
    let url = '';
    let resolvedStream = null;
    try {
        resolvedStream = await resolvePlayableStreamForTrack(t, playbackMode);
        url = resolvedStream.url;
        artistEl.innerText = resolvedStream?.fromCache ? 'Abrindo stream quente...' : 'Abrindo stream...';

        if (playbackMode !== 'audio' && resolvedStream.mode === 'audio') {
            setVideoUiState(false);
            if (currentRoom && isHost && roomSettings.videoEnabled) {
                roomSettings = normalizeRoomSettings({ ...roomSettings, videoEnabled: false });
            }
        }
    } catch (error) {
        const reason = classifyMediaError(error, 'Nao foi possivel gerar stream para essa faixa.');
        recordMediaIssue(t, reason, playbackMode, error);
        titleEl.innerText = "ERRO DE STREAM";
        artistEl.innerText = reason;
        showMediaFailureAction(t, reason, playbackMode);
        updateDiscordNowPlaying('paused');
        return;
    }

    // Historico e automacoes so entram depois que existe stream tocavel.
    if (playHistory.length === 0 || getTrackKey(playHistory[0]) !== getTrackKey(t)) {
        playHistory.unshift({ ...t, playedAt: Date.now(), durationSeconds: parseDurationSeconds(t.duration) });
        if (playHistory.length > 250) playHistory.pop();
        localStorage.setItem('fluxo_history', JSON.stringify(playHistory));
        updateAchievementProgress('trackPlayed');
    }
    rememberAutoMixTrack(t);
    rememberSessionPlayedTrack(t);
    evaluateMusicAutomations(t);
    smartPrefetchUpcoming('track-load');

    if (isQueueViewActive()) document.getElementById('btnQueueView').click();
    
    setMediaElementSource(audioPlayer, url, 'main');
    publishRoomState({ track: t, state: 'playing', time: 0, settings: normalizeRoomSettings(roomSettings) });
    applySavedDspSettings();
    if (isPodcastMode) setPodcastMode(true, false);
    crossfadeTriggered = false; 
    
    
    // Renderiza a Capa no Disco Giratório do Modo Festa
    if (document.body.classList.contains('party-mode')) {
        const maskedCover = document.getElementById('maskedCover');
        if(maskedCover) maskedCover.style.backgroundImage = `url('${t.thumbnail}')`;
    }

    const targetVolume = getTargetVolume();
    audioPlayer.volume = options.fadeIn ? 0 : targetVolume;
    updateDiscordNowPlaying('playing');
    try {
        await audioPlayer.play();
        artistEl.innerText = t.artist;
        clearMediaFailureAction();
        currentStreamRetryKey = '';
        if (options.fadeIn) await fadeMainVolume(targetVolume, getSmartFadeDuration(t));
    } catch (e) {
        console.log(e);
    }
}
// ========================================================
// CONTROLES DE REPRODUÇÃO E REPETIÇÃO
// ========================================================
playPauseBtn.onclick = () => {
    if(!canControl('playPause')) { alert("O Anfitriao bloqueou play/pause."); return; }
    noteManualPlaybackControl('playPause');
    audioPlayer.paused ? audioPlayer.play() : audioPlayer.pause();
};

document.getElementById('nextBtn').onclick = () => {
    if(!canControl('skip')) { alert("O Anfitriao bloqueou skip manual. Use a votacao da sala."); return; }
    noteManualPlaybackControl('skip');
    if (currentIndex < queue.length - 1) {
        transitionToTrack(currentIndex + 1, isCrossfade);
    } else if (loopMode === 1 && queue.length > 0) {
        transitionToTrack(0, isCrossfade);
    }
};

document.getElementById('prevBtn').onclick = () => {
    if(!canControl('skip')) { alert("O Anfitriao bloqueou skip manual. Use a votacao da sala."); return; }
    noteManualPlaybackControl('skip');
    if(audioPlayer.currentTime > 3) { 
        audioPlayer.currentTime = 0; 
        crossfadeTriggered = false;
        if(canPublishPlaybackEvent()) updateCurrentRoomState({ time: 0, state: audioPlayer.paused ? 'paused' : 'playing', updatedAt: Date.now() }, 'sincronizar volta da faixa');
    } else { 
        if (currentIndex > 0) transitionToTrack(currentIndex - 1, isCrossfade);
        else if (loopMode === 1 && queue.length > 0) transitionToTrack(queue.length - 1, isCrossfade);
    }
};
document.getElementById('shuffleBtn').onclick = () => {
    if(!canControl('skip')) { alert("O Anfitriao bloqueou shuffle manual."); return; }
    noteManualPlaybackControl('skip');
    isShuffled = !isShuffled;
    const shuffleButton = document.getElementById('shuffleBtn');
    if (isShuffled) {
        shuffleButton.classList.add('active');
        if (queue.length > 0) {
            const currentTrack = queue[currentIndex];
            const remainingTracks = queue.filter((_, index) => index !== currentIndex);
            queue = [currentTrack, ...shuffleTracks(remainingTracks)];
            currentIndex = 0;
        }
    } else {
        shuffleButton.classList.remove('active');
        if (queue.length > 0) {
            const currentTrack = queue[currentIndex];
            queue = [...originalQueue];
            currentIndex = findTrackIndexByIdentity(queue, currentTrack);
            if (currentIndex < 0) currentIndex = 0;
        }
    }
    publishRoomState();
    if (isQueueViewActive()) document.getElementById('btnQueueView').click();
};

document.getElementById('loopBtn').onclick = () => {
    if(!canControl('skip')) { alert("O Anfitriao bloqueou loop manual."); return; }
    noteManualPlaybackControl('skip');
    loopMode = (loopMode + 1) % 3;
    const loopButton = document.getElementById('loopBtn');
    if (loopMode === 0) {
        loopButton.className = "btn";
        loopButton.innerHTML = '<i class="ph ph-repeat"></i>';
    } else if (loopMode === 1) {
        loopButton.className = "btn active";
        loopButton.innerHTML = '<i class="ph ph-repeat"></i>';
    } else {
        loopButton.className = "btn active-pink";
        loopButton.innerHTML = '<i class="ph ph-repeat-once"></i>';
    }
};

audioPlayer.onended = async () => {
    if (isSmoothTransitioning) return;
    if (sleepTimerState?.mode === 'afterTrack') {
        await finishSleepTimer();
        return;
    }
    if (loopMode === 2) {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
    } else {
        if (isAutoMix && currentIndex === queue.length - 1) {
            try {
                await ensureAutoMixNextTrack();
            } catch (error) {
                console.log('Auto-Mix falhou no fim da faixa:', error.message);
            }
        }
        if (currentIndex < queue.length - 1) {
            transitionToTrack(currentIndex + 1, false);
        } else if (loopMode === 1 && queue.length > 0) {
            transitionToTrack(0, false);
        } else {
            playPauseBtn.innerHTML = '<i class="ph ph-play-circle"></i>';
            document.getElementById('visualizer').style.opacity = '0';
            if(isHost && currentRoom) updateCurrentRoomState({state:'paused', time: 0, updatedAt: Date.now()}, 'sincronizar fim da fila');
        }
    }
};

audioPlayer.onplay = () => { 
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if(canPublishPlaybackEvent()) {
        updateCurrentRoomState({state:'playing', time: audioPlayer.currentTime, updatedAt: Date.now()}, 'sincronizar play');
    }
    playPauseBtn.innerHTML = '<i class="ph ph-pause-circle"></i>';
    document.getElementById('visualizer').style.opacity = '1';
    updateDiscordNowPlaying('playing');
};

audioPlayer.onpause = () => { 
    if(canPublishPlaybackEvent()) {
        updateCurrentRoomState({state:'paused', time: audioPlayer.currentTime, updatedAt: Date.now()}, 'sincronizar pause');
    }
    playPauseBtn.innerHTML = '<i class="ph ph-play-circle"></i>';
    document.getElementById('visualizer').style.opacity = '0';
    updateDiscordNowPlaying('paused');
};

audioPlayer.onerror = () => {
    const track = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    const code = audioPlayer.error?.code || 0;
    const reasons = {
        1: 'Carregamento de midia abortado.',
        2: 'Erro de rede durante a reproducao.',
        3: 'Formato de midia falhou ao decodificar.',
        4: 'Formato nao suportado pelo player.'
    };
    const mode = isVideoMode ? 'video' : 'audio';
    const reason = reasons[code] || 'Erro de midia desconhecido no player.';
    recordMediaIssue(track, reason, mode, { raw: `HTMLMediaElement error code ${code}` });
    showMediaFailureAction(track, reason, mode);
    retryCurrentStreamAfterMediaError(track, mode, reason);
};

async function retryCurrentStreamAfterMediaError(track, mode = 'audio', reason = '') {
    const normalized = normalizeTrack(track);
    if (!normalized || !queue[currentIndex] || getTrackKey(normalized) !== getTrackKey(queue[currentIndex])) return;

    const retryKey = `${getTrackKey(normalized)}::${mode}`;
    if (currentStreamRetryKey === retryKey) return;
    currentStreamRetryKey = retryKey;

    const resumeAt = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    const shouldResume = !audioPlayer.paused;
    artistEl.innerText = 'Renovando stream...';
    invalidateResolvedStream(normalized, mode);
    if (mode !== 'audio') invalidateResolvedStream(normalized, 'audio');

    try {
        const resolvedStream = await resolvePlayableStreamForTrack(normalized, mode, { forceRefresh: true });
        if (!resolvedStream?.url || getTrackKey(normalized) !== getTrackKey(queue[currentIndex])) return;
        setMediaElementSource(audioPlayer, resolvedStream.url, 'main');
        await waitForMediaMetadata(audioPlayer).catch(() => {});
        if (resumeAt > 1 && Number.isFinite(audioPlayer.duration) && audioPlayer.duration > resumeAt + 1) {
            audioPlayer.currentTime = resumeAt;
        }
        artistEl.innerText = normalized.artist;
        clearMediaFailureAction();
        if (shouldResume) await audioPlayer.play().catch(error => console.log('Retry de stream nao retomou:', error));
    } catch (error) {
        const friendly = classifyMediaError(error, reason || 'Falha ao renovar stream.');
        artistEl.innerText = friendly;
        recordMediaIssue(normalized, friendly, mode, error);
        showMediaFailureAction(normalized, friendly, mode);
    } finally {
        setTimeout(() => {
            if (currentStreamRetryKey === retryKey) currentStreamRetryKey = '';
        }, 12000);
    }
}

// ATIVAÇÃO DOS NOVOS BOTÕES
setInterval(() => {
    if (!audioPlayer.paused && queue[currentIndex]) {
        updateDiscordNowPlaying('playing');
    }
}, 15000);

document.getElementById('autoMixBtn').onclick = (e) => {
    if(!canControl('skip')) return;
    isAutoMix = !isAutoMix;
    e.currentTarget.classList.toggle('active', isAutoMix);
    if (isAutoMix) {
        autoMixSeedTrack = normalizeTrack(queue[currentIndex]) || normalizeTrack(queue[0]) || null;
        ensureAutoMixNextTrack().catch(error => console.log('Auto-Mix inicio falhou:', error.message));
    } else {
        autoMixSeedTrack = null;
    }
};

document.getElementById('crossfadeBtn').onclick = (e) => {
    if(!canControl('skip')) return;
    isCrossfade = !isCrossfade;
    e.currentTarget.classList.toggle('active', isCrossfade);
};

// SUBSTITUIÇÃO DO ONTIMEUPDATE (Agora com Crossfade e Auto-Mix Embutido)
audioPlayer.ontimeupdate = () => {
    const progressPercent = audioPlayer.duration ? (audioPlayer.currentTime / audioPlayer.duration * 100) : 0;
    document.getElementById('progressFill').style.width = progressPercent + '%';
    document.getElementById('currentTime').innerText = formatTime(audioPlayer.currentTime);
    document.getElementById('durationTime').innerText = formatTime(audioPlayer.duration || 0);
    updateSleepTimerCountdownUi();
    handleSleepTimerFade();
    if (Date.now() - lastWidgetUpdateAt > 1200) {
        lastWidgetUpdateAt = Date.now();
        updateNowPlayingWidget();
    }
    if (audioPlayer.duration && audioPlayer.duration - audioPlayer.currentTime < 45) {
        smartPrefetchUpcoming('near-end');
    }

    // LÓGICA DE TRANSICÃO E AUTO-MIX (Dispara quando faltarem 6 segundos para a música acabar)
    if (audioPlayer.duration && audioPlayer.currentTime >= audioPlayer.duration - 6 && !crossfadeTriggered && !isSmoothTransitioning) {
        crossfadeTriggered = true; // Trava para não disparar duas vezes seguidas

        // Criamos uma função assíncrona isolada para que o rádio não atrase o Crossfade
        const handleTransition = async () => {
            await ensureAutoMixNextTrack();
            const nextIndex = currentIndex < queue.length - 1 ? currentIndex + 1 : (loopMode === 1 && queue.length > 0 ? 0 : -1);
            if (isCrossfade && nextIndex >= 0) {
                await transitionToTrack(nextIndex, true);
            }
        };

        handleTransition().catch(error => {
            console.log('Transicao suave falhou:', error.message);
            crossfadeTriggered = false;
            audioPlayer.volume = getTargetVolume();
        });
    }
};
// NOVA ABA: HISTÓRICO RECENTE
document.getElementById('btnHistory').onclick = () => {
    panelTitle.innerText = "TOCADAS RECENTEMENTE";
    resultsList.innerHTML = '';
    if (playHistory.length === 0) { 
        resultsList.innerHTML = '<li style="padding: 20px; text-align: center;">Nenhum histórico encontrado. Ouve alguma cena primeiro!</li>'; 
        return; 
    }

    // NOVO: BOTÃO DE LIMPAR HISTÓRICO
    const clearLi = document.createElement('li');
    clearLi.style.padding = "10px 20px";
    clearLi.style.justifyContent = "center";
    clearLi.style.borderBottom = "var(--border-tech)";
    clearLi.innerHTML = `<button class="btn-abort" style="width:100%;"><i class="ph ph-trash"></i> LIMPAR HISTÓRICO</button>`;
    clearLi.querySelector('button').onclick = () => {
        playHistory = [];
        localStorage.removeItem('fluxo_history');
        document.getElementById('btnHistory').click(); // Recarrega a aba vazia
    };
    resultsList.appendChild(clearLi);

    playHistory.forEach((t, i) => {
        const li = document.createElement('li'); li.className = 'result-item';
        li.innerHTML = `
            <div class="result-thumb" style="background-image:url('${t.thumbnail}'); position: relative;"></div>
            <div class="result-info" style="flex:1;">
                <span class="result-title">${t.title}</span><br>
                <span class="result-artist" style="font-size:0.8rem; color:var(--text-muted);">${t.artist}</span>
            </div>
            <button class="btn-action btn-download" title="Descarregar Áudio" style="margin-left: 10px; padding: 10px;"><i class="ph ph-download-simple"></i></button>
            <button class="btn-action btn-radio-seed" title="Criar radio desta musica" style="margin-left: 10px; padding: 10px;"><i class="ph ph-broadcast"></i></button>
            <button class="btn-save btn-playlist" title="Guardar na Playlist" style="margin-left: 10px; padding: 10px;"><i class="ph ph-list-plus"></i></button>
            <button class="btn-confirm btn-add" title="Adicionar à Fila" style="margin-left: 10px;">ADD</button>
        `;
        
// NOVA LÓGICA DE CLIQUE NO BOTÃO DE DOWNLOAD
            li.querySelector('.btn-download').onclick = async (ev) => {
                ev.stopPropagation();
                const btn = ev.currentTarget;
                const oldHtml = btn.innerHTML;
                btn.innerHTML = "<i class='ph ph-spinner-gap ph-spin'></i>";
                
                try {
                    const res = await downloadTrack(t);
                    if (res.success) {
                        // ÍCONE DE SUCESSO NOVO
                        btn.innerHTML = "<i class='ph ph-check-circle'></i> OK";
                        btn.style.color = "var(--neon-cyan)";
                        btn.style.borderColor = "var(--neon-cyan)";
                    } else throw new Error();
                } catch (e) {
                    // SE DER ERRO NO DOWNLOAD, MOSTRA ESSE ÍCONE:
                    btn.innerHTML = "<i class='ph ph-x-circle'></i> ERRO";
                    btn.style.color = "var(--neon-pink)";
                    btn.style.borderColor = "var(--neon-pink)";
                }
                setTimeout(() => { btn.innerHTML = oldHtml; btn.style.color = ""; btn.style.borderColor = ""; }, 3000);
            };

        li.querySelector('.btn-radio-seed').onclick = async (ev) => {
            ev.stopPropagation();
            await startRadioFromTrack(t);
        };

        li.querySelector('.btn-add').onclick = (ev) => { 
            ev.stopPropagation(); queue.push(t); originalQueue.push(t); 
            if(queue.length === 1) loadAndPlayTrack(0); 
            else publishRoomState();
            const btn = ev.target; const oldText = btn.innerHTML; btn.innerHTML = "<i class='ph ph-check'></i>"; setTimeout(() => btn.innerHTML = oldText, 1500);
        };
        
        li.querySelector('.btn-playlist').onclick = (ev) => {
            ev.stopPropagation();
            if(savedPlaylists.length === 0) { alert("Nenhuma playlist criada. Cria uma primeiro a partir da tua Fila!"); return; }
            if (savedPlaylists[0].locked) { alert("A primeira playlist esta bloqueada."); return; }
            savedPlaylists[0].tracks.push(t);
            savePlaylists();
            const btnSave = li.querySelector('.btn-playlist'); const oldText = btnSave.innerHTML;
            btnSave.innerHTML = "<i class='ph ph-check'></i>"; btnSave.style.color = "var(--neon-cyan)"; btnSave.style.borderColor = "var(--neon-cyan)";
            setTimeout(() => { btnSave.innerHTML = oldText; btnSave.style.color = ""; btnSave.style.borderColor = ""; }, 1500);
        };

        li.onclick = () => { queue = [t]; originalQueue = [t]; loadAndPlayTrack(0); document.getElementById('btnQueueView').click(); };
        resultsList.appendChild(li);
    });
};
function renderHistoryCalendarPanel(selectedDate = '') {
    panelTitle.innerText = "HISTORICO COM CALENDARIO";
    queueCounter.innerText = `${playHistory.length} tocadas`;
    resultsList.innerHTML = '';

    const grouped = playHistory.reduce((acc, track) => {
        const key = formatDateKey(track.playedAt);
        if (!acc[key]) acc[key] = [];
        acc[key].push(track);
        return acc;
    }, {});
    const days = Object.keys(grouped).sort().reverse();
    const activeDate = selectedDate || days[0] || formatDateKey(Date.now());
    const tracks = grouped[activeDate] || [];

    const controls = document.createElement('li');
    controls.className = 'fluxo-tools-row';
    controls.innerHTML = `
        <input type="date" id="historyDatePicker" class="inline-input" value="${activeDate}">
        <button class="btn-confirm" id="btnReplayHistoryDay"><i class="ph ph-repeat"></i> REPLAY DO DIA</button>
        <button class="btn-abort" id="btnClearHistory"><i class="ph ph-trash"></i> LIMPAR HISTORICO</button>
    `;
    resultsList.appendChild(controls);

    document.getElementById('historyDatePicker').onchange = (event) => renderHistoryCalendarPanel(event.target.value);
    document.getElementById('btnReplayHistoryDay').onclick = () => {
        if (!tracks.length) return;
        queue = tracks.map(normalizeTrack).filter(Boolean);
        originalQueue = [...queue];
        currentIndex = 0;
        loadAndPlayTrack(0);
        document.getElementById('btnQueueView').click();
    };
    document.getElementById('btnClearHistory').onclick = () => {
        playHistory = [];
        localStorage.removeItem('fluxo_history');
        renderHistoryCalendarPanel();
    };

    if (!tracks.length) {
        const emptyHistory = document.createElement('li');
        emptyHistory.style.cssText = 'padding: 30px; text-align: center; color: var(--text-muted);';
        emptyHistory.innerText = 'Nenhuma musica registrada nesse dia.';
        resultsList.appendChild(emptyHistory);
        return;
    }

    tracks.forEach((track) => {
        const t = normalizeTrack(track);
        const li = document.createElement('li');
        li.className = 'result-item';
        li.innerHTML = `
            <div class="result-thumb" style="background-image:url('${t.thumbnail || ''}'); position: relative;"></div>
            <div class="result-info" style="flex:1;">
                <span class="result-title">${escapeHtml(t.title)}</span>
                <span class="result-artist">${escapeHtml(t.artist)} - ${new Date(track.playedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            ${getFavoriteButtonHtml(t)}
            <button class="btn-action btn-play-next" title="Tocar a seguir"><i class="ph ph-arrow-bend-down-right"></i></button>
            <button class="btn-action btn-radio-seed" title="Criar radio desta musica"><i class="ph ph-broadcast"></i></button>
            <button class="btn-confirm btn-add" title="Adicionar a fila">ADD</button>
        `;

        bindFavoriteButton(li, t);
        li.querySelector('.btn-play-next').onclick = (ev) => {
            ev.stopPropagation();
            enqueueTrack(t, 'next');
            ev.currentTarget.innerHTML = '<i class="ph ph-check"></i>';
        };
        li.querySelector('.btn-radio-seed').onclick = async (ev) => {
            ev.stopPropagation();
            await startRadioFromTrack(t);
        };
        li.querySelector('.btn-add').onclick = (ev) => {
            ev.stopPropagation();
            enqueueTrack(t);
            ev.currentTarget.innerHTML = '<i class="ph ph-check"></i>';
        };
        li.onclick = () => playTrackNow(t);
        resultsList.appendChild(li);
    });
}

document.getElementById('btnHistory').onclick = () => renderHistoryCalendarPanel();

function renderFavoritesPanel() {
    panelTitle.innerText = "MUSICAS FAVORITAS";
    queueCounter.innerText = `${favoriteTracks.length} favoritas`;
    resultsList.innerHTML = '';

    if (!favoriteTracks.length) {
        resultsList.innerHTML = '<li style="padding: 34px; text-align: center; color: var(--text-muted);">Nenhuma favorita ainda. Use o coracao nos resultados, historico ou playlists.</li>';
        return;
    }

    favoriteTracks.forEach((track) => {
        const t = normalizeTrack(track);
        const li = document.createElement('li');
        li.className = 'result-item';
        li.innerHTML = `
            <div class="result-thumb" style="background-image:url('${t.thumbnail || ''}')"></div>
            <div class="result-info">
                <span class="result-title">${escapeHtml(t.title)}</span>
                <span class="result-artist">${escapeHtml(t.artist)}</span>
            </div>
            <button class="btn-action btn-play-next" title="Tocar a seguir"><i class="ph ph-arrow-bend-down-right"></i></button>
            <button class="btn-action btn-radio-seed" title="Criar radio desta musica"><i class="ph ph-broadcast"></i></button>
            <button class="btn-confirm btn-add">ADD</button>
            <button class="btn-abort btn-remove-fav" title="Remover favorita"><i class="ph ph-heart-break"></i></button>
        `;

        li.querySelector('.btn-play-next').onclick = (event) => {
            event.stopPropagation();
            enqueueTrack(t, 'next');
            event.currentTarget.innerHTML = '<i class="ph ph-check"></i>';
        };
        li.querySelector('.btn-radio-seed').onclick = async (event) => {
            event.stopPropagation();
            await startRadioFromTrack(t);
        };
        li.querySelector('.btn-add').onclick = (event) => {
            event.stopPropagation();
            enqueueTrack(t);
            event.currentTarget.innerHTML = '<i class="ph ph-check"></i>';
        };
        li.querySelector('.btn-remove-fav').onclick = (event) => {
            event.stopPropagation();
            toggleFavoriteTrack(t);
            renderFavoritesPanel();
        };
        li.onclick = () => playTrackNow(t);
        resultsList.appendChild(li);
    });
}

function saveCurrentQueueTab(name) {
    const title = String(name || '').trim() || `Fila ${queueTabs.length + 1}`;
    const id = activeQueueTabId || `queue_${Date.now()}`;
    const snapshot = {
        id,
        title,
        updatedAt: Date.now(),
        currentIndex,
        tracks: queue.map(normalizeTrack).filter(Boolean)
    };
    const existing = queueTabs.findIndex(tab => tab.id === id);
    if (existing >= 0) queueTabs[existing] = snapshot;
    else queueTabs.unshift(snapshot);
    activeQueueTabId = id;
    saveQueueTabs();
    return snapshot;
}

function loadQueueTab(id) {
    const tab = queueTabs.find(item => item.id === id);
    if (!tab) return false;
    queue = (tab.tracks || []).map(normalizeTrack).filter(Boolean);
    originalQueue = [...queue];
    currentIndex = Math.min(Math.max(0, tab.currentIndex || 0), Math.max(0, queue.length - 1));
    activeQueueTabId = tab.id;
    saveQueueTabs();
    if (queue.length) loadAndPlayTrack(currentIndex);
    document.getElementById('btnQueueView').click();
    return true;
}

function deleteQueueTab(id) {
    queueTabs = queueTabs.filter(tab => tab.id !== id);
    if (activeQueueTabId === id) activeQueueTabId = queueTabs[0]?.id || '';
    saveQueueTabs();
}

async function refreshDiagnosticsPanel() {
    const box = document.getElementById('diagnosticsBox');
    if (!box || !window.electronAPI?.getAppInfo) return;

    const [info, rpc] = await Promise.all([
        window.electronAPI.getAppInfo().catch(() => null),
        window.electronAPI.getDiscordStatus?.().catch(() => null)
    ]);
    const status = rpc || info?.discord || {};
    const rpcButtonState = status.buttonsAccepted
        ? 'YouTube ativo'
        : status.buttonsSent
            ? 'fallback sem botao'
            : 'sem botao';

    box.innerHTML = `
        <div class="diag-line"><span>Versao</span><strong>${escapeHtml(info?.version || 'dev')}</strong></div>
        <div class="diag-line"><span>Empacotado</span><strong>${info?.isPackaged ? 'sim' : 'nao'}</strong></div>
        <div class="diag-line"><span>yt-dlp warmup</span><strong>${info?.ytDlpWarmup?.done ? (info.ytDlpWarmup.ok ? `${escapeHtml(info.ytDlpWarmup.version || 'ok')} / ${info.ytDlpWarmup.elapsedMs}ms` : 'falhou') : 'aquecendo'}</strong></div>
        <div class="diag-line"><span>Discord RPC</span><strong>${escapeHtml(status.state || 'idle')}</strong></div>
        <div class="diag-line"><span>Client ID</span><strong>${escapeHtml(status.clientId || DEFAULT_DISCORD_CLIENT_ID)}</strong></div>
        <div class="diag-line"><span>Payload RPC</span><strong>${escapeHtml(status.payloadMode || 'sem botoes')}</strong></div>
        <div class="diag-line"><span>Botao RPC</span><strong>${escapeHtml(rpcButtonState)}</strong></div>
        ${status.lastError ? `<div class="diag-error">${escapeHtml(status.lastError)}</div>` : ''}
    `;
}

function getReleaseAssistantText() {
    const selected = [
        'Fluxo Music 3.9.30 remove codigo legado inalcancavel dos controles de reproducao e reduz conflito entre permissao de sessao e comandos locais.',
        'Auto-Mix agora aquece o stream da proxima faixa assim que ela entra na fila.',
        'Falha geral da busca virou uma tela amigavel com TENTAR DE NOVO e atalho para diagnostico de rede.',
        'Fluxo Music 3.9.29 acelera o inicio do player com cache real de stream, prefetch reaproveitavel e warmup do yt-dlp no boot.',
        'Falhas de midia agora invalidam cache, tentam renovar o stream automaticamente e exibem o botao POR QUE FALHOU? para abrir diagnostico da faixa.',
        'Biblioteca ganhou backup completo e restauracao em JSON unico com playlists, favoritos, historico, inbox, alertas, tema e EQ.',
        'Fluxo Music 3.9.28 corrige a causa raiz do erro de stream recente usando proxy local temporario com CORS e suporte a Range.',
        'O instalador da 3.9.28 inclui o yt-dlp.exe fora do ASAR para evitar erro de stream no app instalado.',
        'O renderer deixa de receber URLs cruas do googlevideo, preservando carregamento, equalizador, visualizer, modo video, preview e sessao compartilhada.',
        'Fluxo Music 3.9.27 centraliza o resolvedor de stream com contexto completo da faixa, candidatos por titulo/query e fallback sem alterar a fila.',
        'A janela de ultimos apoiadores fica reservada para integracao automatica futura, sem configuracao tecnica no app.',
        'Fluxo Music 3.9.22 adiciona modo host profissional com permissoes granulares na sessao compartilhada.',
        'Fila da sessao ganhou votos de prioridade, pin do host, reacoes ao vivo, ranking e replay salvavel.',
        'Conquistas locais chegaram para plays, sessoes, playlists, replay, sleep timer e diagnostico da biblioteca.',
        'Sleep timer foi refeito com pausa por tempo, parar depois da faixa atual, fechar app e fade out configuravel.',
        'Biblioteca inteligente detecta duplicadas, faixas sem capa e suspeitas de midia quebrada.',
        'Fluxo Music 3.9.21 refaz a sessao compartilhada com UI nova, fila da sala, membros para todos e historico tocado.',
        'Host pode liberar convidados para colocar a proxima musica direto, sem passar por pedido.',
        'Sessao ganhou votacao para pular por 50% dos membros, bypass do host, Infinite Radio da sala e video sincronizado para todos.',
        'Equalizador do host agora sincroniza com convidados, e o DSP inicia em Normal por padrao.',
        'LivePix ganhou janela preparada para ultimos apoiadores sem expor segredo privado dentro do app.',
        'Novo tema Fluxo Bug satiriza bugs do projeto com visual de crash report controlado.',
        'Fluxo Music 3.9.20 destrava o multiplayer quando o Firebase bloqueia regras expiradas.',
        'Sessao compartilhada agora mostra permission_denied no painel com explicacao de regras vencidas em 30/04/2026.',
        'Novo firebase.database.rules.json entrega regras prontas para Realtime Database com salas de 4 caracteres, validacao basica e TTL de 24h.',
        'Criar sala, entrar, chat, pedidos e sync de play/pause/progresso ganharam tratamento de erro do Firebase.',
        'Fluxo Music 3.9.19 troca o QR gerado por terceiro pelo widget oficial do LivePix.',
        'A aba Apoiar Fluxo agora embute widget.livepix.gg/embed/74f064b4-5a37-4c8d-8121-013017caa1e8.',
        'Card do LivePix foi redimensionado para iframe com carregamento mais estavel.',
        'Botao principal de doacao continua abrindo livepix.gg/devpotato no navegador externo.',
        'Fluxo Music 3.9.18 adiciona uma aba Apoiar Fluxo bem visivel na sidebar.',
        'Doacoes pelo LivePix agora tem CTA dedicado, QR Code, copiar link e mensagem de compartilhamento.',
        'Link externo do LivePix abre por IPC seguro com allowlist para livepix.gg/devpotato.',
        'O app nao embute segredo privado de doacao; apenas link publico e ID publico ficam visiveis.',
        'Fluxo Music 3.9.17 reconstruiu o suporte ao SoundCloud usando API publica propria.',
        'Links on.soundcloud.com, snd.sc, soundcloud.app.goo.gl, sets e playlists agora sao reconhecidos e resolvidos.',
        'Player ganhou HLS local para streams .m3u8 do SoundCloud via hls.js.',
        'Streams protegidos do SoundCloud viram aviso de midia em vez de quebrar a busca.',
        'Fluxo Music 3.9.16 corrige a busca principal do YouTube quando o yt-dlp encontra videos DRM ou entradas nulas.',
        'Links diretos e playlists do YouTube agora usam metadados por ID/lista antes de acionar o yt-dlp.',
        'Fallback da busca ficou mais tolerante: falha individual nao derruba a tela inteira.',
        'Equalizador removeu o uso depreciado de slider-vertical no CSS.',
        'Fluxo Music 3.9.15 adiciona busca dentro da pagina de temas.',
        'Elden Ring, One Piece, Naruto, Jujutsu, Attack on Titan, Evangelion e Undertale foram refeitos com identidades mais claras.',
        'Zelda, Hollow Knight e Persona 5 ficaram preservados, como pedido.',
        'Fluxo Music 3.9.14 aceita links, mixes e playlists do YouTube direto na barra de pesquisa.',
        'Playlists e mixes do YouTube agora abrem como colecao importada, nao como um video unico.',
        'SoundCloud ganhou suporte melhor para sets, playlists e links curtos/mobile.',
        'Fluxo Music 3.9.13 recoloca o botao Ouvir no YouTube no Discord RPC.',
        'Botao YouTube agora roda no payload Ouvindo e mantem fallback caso o Discord rejeite.',
        'Central Fluxo mostra se o botao RPC foi aceito ou se caiu em fallback.',
        'Fluxo Music 3.9.12 faz o Discord RPC aparecer como Ouvindo Fluxo Music, igual atividade musical.',
        'RPC agora evita competir com Roblox e outros jogos no slot de Jogando.',
        'Central Fluxo mostra o modo real do payload RPC: ouvindo, sem thumb ou fallback.',
        'Fluxo Music 3.9.11 aplica recorte nativo na janela para arredondar as quinas externas de verdade.',
        'O raio da janela acompanha resize, maximizar e fullscreen sem comer pedaco da interface.',
        'A raiz HTML recebeu um fundo transparente tecnico para evitar o retangulo quadrado do Chromium.',
        'Fluxo Music 3.9.10 deixou as bordas externas da janela arredondadas.',
        'Janela Electron agora usa clipping arredondado no html/body e titlebar combinando.',
        'Fluxo Music 3.9.9 removeu completamente os botoes do Discord RPC para parar rejeicoes silenciosas.',
        'RPC agora tenta reconectar sozinho quando o Discord desktop ainda nao esta pronto.',
        'Presenca do Discord ficou minima e robusta: musica, artista, tempo e capa com fallback.',
        'Fluxo Music 3.9.8 com Central Fluxo ultra simplificada em status, acoes principais e gaveta avancada.',
        'RPC corrigido com reconexao depois de falha, reset real do IPC e envio de atividade com PID correto.',
        'Temas novos refeitos em camada estavel sem travar o scroll de resultados ou equalizador.',
        'Fluxo Music 3.9.7 com Central Fluxo mais simples, menos poluida e organizada por areas.',
        'Discord RPC com reset manual, envio mais conservador e diagnostico melhor para atividade.',
        'Infinite Radio mais criterioso: usa artista/titulo/estilo e evita fallback amplo que puxava coisa aleatoria.',
        'Temas recentes receberam novo passe visual para ficarem mais unicos e menos parecidos.',
        'Modo Recuperacao com Ctrl+Shift+R para destravar tema, mini-player, modo festa, foco, ambiente e compactos.',
        'Inbox de musicas para organizar faixas tocadas/adicionadas/baixadas antes de salvar em playlists.',
        'Painel BPM e Tom com estimativa de BPM, tonalidade, energia e confianca para fila e DJ.',
        'Diagnostico de Midia com teste de audio/video e historico de alertas para DRM, regiao, privado, formato e stream.',
        'Changelog automatico no primeiro boot apos atualizar.',
        'Favoritos reais com aba dedicada e botoes de coracao.',
        'Capa customizada, bloqueio e lixeira de playlists.',
        'Biblioteca compacta, fila em abas, replay do dia e historico com calendario.',
        'Central Fluxo com diagnostico, painel RPC, widget, overlay streamer, conversor e sample cutter.',
        'Widget e overlay OBS agora seguem o tema ativo, incluindo skins especiais e modo festa.',
        'SoundCloud, Plugin API, Stream Deck bridge, automacoes musicais, comentarios locais e busca global.',
        'Recap semanal, heatmap de audicao, waveform na timeline e pre-carregamento adaptativo.',
        'Mini player compacto/horizontal, tela ambiente, modo podcast e presets de EQ/DSP compartilhaveis.',
        'Tocar a seguir, playlist por duracao, modo foco, modo DJ experimental e transicao por BPM estimado.',
        'Discord RPC revisado com teste manual e estado de conexao.'
    ];
    return `Fluxo Music 3.9.30\n\nNovidades:\n${selected.map(item => `- ${item}`).join('\n')}\n\nChangelog base:\n${flattenChangelogText()}`;
}

function renderPlaylistTrashPanel() {
    panelTitle.innerText = "LIXEIRA DE PLAYLISTS";
    queueCounter.innerText = `${playlistTrash.length} itens`;
    resultsList.innerHTML = `
        <li class="fluxo-tools-row">
            <button class="btn-action" id="btnBackLab"><i class="ph ph-arrow-left"></i> VOLTAR</button>
            <button class="btn-abort" id="btnEmptyPlaylistTrash"><i class="ph ph-trash"></i> ESVAZIAR</button>
        </li>
    `;
    document.getElementById('btnBackLab').onclick = renderFluxoLab;
    document.getElementById('btnEmptyPlaylistTrash').onclick = () => {
        playlistTrash = [];
        savePlaylistTrash();
        renderPlaylistTrashPanel();
    };

    if (!playlistTrash.length) {
        resultsList.innerHTML += '<li style="padding: 30px; text-align:center; color: var(--text-muted);">Lixeira vazia.</li>';
        return;
    }

    playlistTrash.forEach((playlist, index) => {
        const li = document.createElement('li');
        li.className = 'result-item';
        li.innerHTML = `
            <div class="result-thumb"><i class="ph ph-trash"></i></div>
            <div class="result-info">
                <span class="result-title">${escapeHtml(playlist.title)}</span>
                <span class="result-artist">${(playlist.tracks || []).length} faixas</span>
            </div>
            <button class="btn-confirm btn-restore-pl"><i class="ph ph-arrow-counter-clockwise"></i> RESTAURAR</button>
            <button class="btn-abort btn-delete-forever"><i class="ph ph-x"></i></button>
        `;
        li.querySelector('.btn-restore-pl').onclick = (event) => {
            event.stopPropagation();
            savedPlaylists.unshift(playlist);
            playlistTrash.splice(index, 1);
            savePlaylists();
            savePlaylistTrash();
            renderPlaylistTrashPanel();
        };
        li.querySelector('.btn-delete-forever').onclick = (event) => {
            event.stopPropagation();
            playlistTrash.splice(index, 1);
            savePlaylistTrash();
            renderPlaylistTrashPanel();
        };
        resultsList.appendChild(li);
    });
}

function renderDjPanel() {
    panelTitle.innerText = "MODO DJ EXPERIMENTAL";
    queueCounter.innerText = isCrossfade ? 'crossfade ativo' : '';
    const current = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    if (!queue[djDeckBIndex] || djDeckBIndex === currentIndex) {
        djDeckBIndex = queue[currentIndex + 1] ? currentIndex + 1 : (queue[currentIndex - 1] ? currentIndex - 1 : currentIndex);
    }
    const next = queue[djDeckBIndex] && djDeckBIndex !== currentIndex ? normalizeTrack(queue[djDeckBIndex]) : null;
    const nextKey = next ? getTrackKey(next) : '';
    const isPreviewingNext = nextKey && previewPlayer.dataset.djId === nextKey && !previewPlayer.paused;
    const deckBOptions = queue.map((track, index) => {
        const normalized = normalizeTrack(track);
        return `<option value="${index}" ${index === djDeckBIndex ? 'selected' : ''} ${index === currentIndex ? 'disabled' : ''}>${index + 1}. ${escapeHtml(normalized?.title || 'Faixa')}</option>`;
    }).join('');
    resultsList.innerHTML = `
        <li class="dj-shell">
            <section class="dj-deck">
                <span class="changelog-kicker">Deck A - principal</span>
                <div class="dj-cover" style="background-image:url('${current?.thumbnail || ''}')"></div>
                <h3>${escapeHtml(current?.title || 'Nada tocando')}</h3>
                <p>${escapeHtml(current?.artist || 'Fluxo')}</p>
            </section>
            <section class="dj-deck">
                <span class="changelog-kicker">Deck B - independente</span>
                <div class="dj-cover" style="background-image:url('${next?.thumbnail || ''}')"></div>
                <h3>${escapeHtml(next?.title || 'Sem proxima faixa')}</h3>
                <p>${escapeHtml(next?.artist || 'Adicione musicas na fila')}</p>
                <select class="inline-input dj-deck-select" id="djDeckBSelect">${deckBOptions || '<option>Sem fila</option>'}</select>
                <div class="dj-deck-meter">
                    <span>${formatPresenceTime(previewPlayer.currentTime || 0)}</span>
                    <div><i style="width:${previewPlayer.duration ? Math.min(100, (previewPlayer.currentTime / previewPlayer.duration) * 100) : 0}%"></i></div>
                    <span>${formatPresenceTime(previewPlayer.duration || parseDurationSeconds(next?.duration))}</span>
                </div>
            </section>
            <section class="dj-controls">
                <button class="btn-action" id="btnBackLabFromDj"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                <button class="btn-confirm" id="btnPreviewDeckB" ${next ? '' : 'disabled'}><i class="ph ph-headphones"></i> ${isPreviewingNext ? 'PAUSAR B' : 'CARREGAR/TOCAR B'}</button>
                <button class="btn-action" id="btnStopDeckB" ${next ? '' : 'disabled'}><i class="ph ph-stop"></i> STOP B</button>
                <button class="btn-confirm" id="btnTakeDeckB" ${next ? '' : 'disabled'}><i class="ph ph-swap"></i> TOCAR B</button>
                <button class="btn-action" id="btnSyncDeckB" ${next ? '' : 'disabled'}><i class="ph ph-metronome"></i> SYNC BPM</button>
                <label class="dj-slider-label">Preview <input type="range" id="djPreviewVolume" min="0" max="1" step="0.01" value="${djPreviewVolume}" class="vol-slider"></label>
                <label class="dj-slider-label">Crossfader <input type="range" id="djCrossfader" min="0" max="1" step="0.01" value="0" class="vol-slider"></label>
                <span class="lab-status" id="djStatus">${next ? `Deck B armado em ${estimateTrackBpm(next)} BPM.` : 'Adicione pelo menos duas musicas na fila.'}</span>
            </section>
        </li>
    `;
    document.getElementById('btnBackLabFromDj').onclick = renderFluxoLab;
    document.getElementById('djDeckBSelect').onchange = (event) => {
        djDeckBIndex = Number(event.target.value);
        localStorage.setItem('fluxo_dj_deck_b_index', String(djDeckBIndex));
        previewPlayer.pause();
        previewPlayer.dataset.djId = '';
        renderDjPanel();
    };
    document.getElementById('btnPreviewDeckB').onclick = async () => {
        if (!next) return;
        const btn = document.getElementById('btnPreviewDeckB');
        const status = document.getElementById('djStatus');
        const key = getTrackKey(next);

        if (previewPlayer.dataset.djId === key && !previewPlayer.paused) {
            previewPlayer.pause();
            btn.innerHTML = '<i class="ph ph-headphones"></i> PREVIEW B';
            status.innerText = 'Deck B pausado.';
            return;
        }

        btn.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i> CARREGANDO';
        status.innerText = 'Resolvendo stream do Deck B...';
        try {
            const resolvedPreview = await resolvePlayableStreamForTrack(next, 'audio');
            const url = resolvedPreview?.url;
            if (!url) throw new Error('Deck B nao gerou stream. Pode ser DRM, bloqueio regional ou video indisponivel.');
            setMediaElementSource(previewPlayer, url, 'preview');
            previewPlayer.dataset.djId = key;
            previewPlayer.volume = djPreviewVolume;
            previewPlayer.playbackRate = 1;
            await previewPlayer.play();
            btn.innerHTML = '<i class="ph ph-pause"></i> PAUSAR B';
            status.innerText = 'Deck B tocando em preview.';
        } catch (error) {
            console.warn('Preview DJ falhou:', error);
            btn.innerHTML = '<i class="ph ph-headphones"></i> PREVIEW B';
            status.innerText = error.message || 'Falha ao abrir preview do Deck B.';
        }
    };
    document.getElementById('btnStopDeckB').onclick = () => {
        previewPlayer.pause();
        previewPlayer.removeAttribute('src');
        previewPlayer.dataset.djId = '';
        previewPlayer.load();
        document.getElementById('btnPreviewDeckB').innerHTML = '<i class="ph ph-headphones"></i> PREVIEW B';
        document.getElementById('djStatus').innerText = 'Deck B parado.';
    };
    document.getElementById('btnTakeDeckB').onclick = async () => {
        if (!next) return;
        const previewTime = previewPlayer.dataset.djId === getTrackKey(next) ? previewPlayer.currentTime : 0;
        previewPlayer.pause();
        document.getElementById('djStatus').innerText = 'Assumindo Deck B...';
        await transitionToTrack(djDeckBIndex, true);
        if (previewTime > 1 && Number.isFinite(audioPlayer.duration) && audioPlayer.duration > previewTime + 1) {
            audioPlayer.currentTime = previewTime;
        }
        audioPlayer.volume = getTargetVolume();
        renderDjPanel();
    };
    document.getElementById('btnSyncDeckB').onclick = () => {
        if (!next) return;
        const currentBpm = estimateTrackBpm(current);
        const nextBpm = estimateTrackBpm(next);
        const ratio = clampNumber(currentBpm / Math.max(1, nextBpm), 0.75, 1.35, 1);
        previewPlayer.playbackRate = ratio;
        document.getElementById('djStatus').innerText = `Deck B sincronizado em ${ratio.toFixed(2)}x para aproximar ${currentBpm} BPM.`;
    };
    document.getElementById('djPreviewVolume').oninput = (event) => {
        djPreviewVolume = clampNumber(event.target.value, 0, 1, 0.35);
        localStorage.setItem('fluxo_dj_preview_volume', String(djPreviewVolume));
        if (!previewPlayer.paused) previewPlayer.volume = djPreviewVolume;
    };
    document.getElementById('djCrossfader').oninput = (event) => {
        const value = Number(event.target.value) || 0;
        audioPlayer.volume = getTargetVolume() * (1 - value);
        if (!previewPlayer.paused) previewPlayer.volume = value <= 0 ? djPreviewVolume : Math.max(0.02, djPreviewVolume * value);
    };
}

function formatDateTime(timestamp) {
    return new Date(Number(timestamp) || Date.now()).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderTrackCommentsPanel() {
    const track = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    panelTitle.innerText = "COMENTARIOS LOCAIS";
    queueCounter.innerText = track ? 'por musica' : '';

    if (!track) {
        resultsList.innerHTML = `
            <li class="lab-card solo-panel">
                <button class="btn-action" id="btnBackLabFromNotes"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                <p class="lab-status">Toque uma musica para criar comentarios locais nela.</p>
            </li>
        `;
        document.getElementById('btnBackLabFromNotes').onclick = renderFluxoLab;
        return;
    }

    const comments = getCurrentTrackCommentBucket(track);
    resultsList.innerHTML = `
        <li class="lab-card solo-panel">
            <div class="lab-card-head"><i class="ph ph-chat-circle-text"></i><h3>${escapeHtml(track.title)}</h3></div>
            <textarea id="trackCommentText" class="inline-input release-textarea" placeholder="Escreva uma nota, opiniao, timestamp ou contexto dessa musica..."></textarea>
            <div class="lab-actions">
                <button class="btn-action" id="btnBackLabFromNotes"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                <button class="btn-confirm" id="btnSaveTrackComment"><i class="ph ph-plus"></i> SALVAR COMENTARIO</button>
            </div>
            <div class="comment-list">
                ${comments.length ? comments.map(comment => `
                    <article class="comment-card">
                        <p>${escapeHtml(comment.text)}</p>
                        <span>${formatDateTime(comment.createdAt)}</span>
                        <button class="btn-abort btn-delete-comment" data-id="${escapeHtml(comment.id)}"><i class="ph ph-trash"></i></button>
                    </article>
                `).join('') : '<p class="lab-status">Ainda nao tem comentario nessa faixa.</p>'}
            </div>
        </li>
    `;
    document.getElementById('btnBackLabFromNotes').onclick = renderFluxoLab;
    document.getElementById('btnSaveTrackComment').onclick = () => {
        addTrackComment(track, document.getElementById('trackCommentText').value);
        renderTrackCommentsPanel();
    };
    document.querySelectorAll('.btn-delete-comment').forEach(btn => {
        btn.onclick = () => {
            deleteTrackComment(track, btn.dataset.id);
            renderTrackCommentsPanel();
        };
    });
}

function renderMusicInboxPanel() {
    panelTitle.innerText = "INBOX DE MUSICAS";
    queueCounter.innerText = `${trackInbox.length} itens`;
    resultsList.innerHTML = `
        <li class="fluxo-tools-row">
            <button class="btn-action" id="btnBackFromInbox"><i class="ph ph-arrow-left"></i> VOLTAR</button>
            <button class="btn-abort" id="btnClearInbox"><i class="ph ph-trash"></i> LIMPAR INBOX</button>
        </li>
    `;

    document.getElementById('btnBackFromInbox').onclick = renderFluxoLab;
    document.getElementById('btnClearInbox').onclick = () => {
        trackInbox = [];
        saveTrackInbox();
        renderMusicInboxPanel();
    };

    if (!trackInbox.length) {
        resultsList.insertAdjacentHTML('beforeend', `
            <li class="lab-card solo-panel">
                <div class="lab-card-head"><i class="ph ph-tray"></i><h3>Inbox vazio</h3></div>
                <p class="lab-status">Musicas tocadas agora, adicionadas na fila ou baixadas aparecem aqui antes de virarem playlist definitiva.</p>
            </li>
        `);
        return;
    }

    trackInbox.forEach(track => {
        const normalized = normalizeTrack(track);
        const analysis = getTrackMusicAnalysis(normalized);
        const li = document.createElement('li');
        li.className = 'result-item inbox-item';
        li.dataset.key = getTrackKey(normalized);
        li.innerHTML = `
            <div class="result-thumb" style="background-image:url('${escapeHtml(normalized.thumbnail || '')}')"></div>
            <div class="result-info">
                <span class="result-title">${escapeHtml(normalized.title)}</span><br>
                <span class="result-artist">${escapeHtml(normalized.artist || 'Desconhecido')} - ${escapeHtml(track.inboxSource || 'inbox')} - ${formatDateTime(track.inboxAddedAt)}</span>
                <small class="analysis-pill">${analysis?.bpm || '--'} BPM / ${escapeHtml(analysis?.key || '--')}</small>
            </div>
            <button class="btn-confirm btn-inbox-play"><i class="ph ph-play"></i></button>
            <button class="btn-action btn-inbox-next" title="Tocar a seguir"><i class="ph ph-arrow-bend-down-right"></i></button>
            <button class="btn-action btn-inbox-diagnose" title="Diagnosticar"><i class="ph ph-stethoscope"></i></button>
            <button class="btn-abort btn-inbox-remove"><i class="ph ph-x"></i></button>
        `;
        li.querySelector('.btn-inbox-play').onclick = event => {
            event.stopPropagation();
            playTrackNow(normalized);
        };
        li.querySelector('.btn-inbox-next').onclick = event => {
            event.stopPropagation();
            enqueueTrack(normalized, 'next');
            event.currentTarget.innerHTML = '<i class="ph ph-check"></i>';
        };
        li.querySelector('.btn-inbox-diagnose').onclick = async event => {
            event.stopPropagation();
            await diagnoseTrackMedia(normalized, 'audio');
            renderMediaDiagnosticsPanel();
        };
        li.querySelector('.btn-inbox-remove').onclick = event => {
            event.stopPropagation();
            removeFromMusicInbox(normalized);
            renderMusicInboxPanel();
        };
        li.onclick = () => playTrackNow(normalized);
        resultsList.appendChild(li);
    });
}

function renderMusicAnalysisPanel() {
    const current = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    const currentAnalysis = current ? getTrackMusicAnalysis(current, true) : null;
    const candidates = [current, ...queue.slice(currentIndex + 1, currentIndex + 7)].filter(Boolean).map(normalizeTrack).filter(Boolean);
    panelTitle.innerText = "BPM E TOM";
    queueCounter.innerText = currentAnalysis ? `${currentAnalysis.bpm} BPM` : 'estimado';

    resultsList.innerHTML = `
        <li class="analysis-shell">
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-metronome"></i><h3>Faixa atual</h3></div>
                ${current ? `
                    <div class="analysis-current">
                        <div class="result-thumb" style="background-image:url('${escapeHtml(current.thumbnail || '')}')"></div>
                        <div>
                            <strong>${escapeHtml(current.title)}</strong>
                            <span>${escapeHtml(current.artist || 'Desconhecido')}</span>
                        </div>
                    </div>
                    <div class="insight-stat-grid">
                        <div><strong>${currentAnalysis.bpm}</strong><span>BPM</span></div>
                        <div><strong>${escapeHtml(currentAnalysis.key)}</strong><span>tom</span></div>
                        <div><strong>${escapeHtml(currentAnalysis.energy)}</strong><span>energia</span></div>
                        <div><strong>${escapeHtml(currentAnalysis.confidence)}</strong><span>confianca</span></div>
                    </div>
                    <p class="lab-status">Estimativa local leve: boa para DJ/crossfade e organizacao, mas nao substitui analise harmônica profissional offline.</p>
                ` : '<p class="lab-status">Toque uma musica para estimar BPM e tom.</p>'}
                <div class="lab-actions">
                    <button class="btn-action" id="btnBackLabFromAnalysis"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                    <button class="btn-confirm" id="btnRefreshAnalysis" ${current ? '' : 'disabled'}><i class="ph ph-arrow-clockwise"></i> RECALCULAR</button>
                </div>
            </section>
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-list-magnifying-glass"></i><h3>Proximas da fila</h3></div>
                <div class="analysis-list">
                    ${candidates.length ? candidates.map(track => {
                        const analysis = getTrackMusicAnalysis(track);
                        return `<p><span>${escapeHtml(track.title)}</span><strong>${analysis.bpm} BPM / ${escapeHtml(analysis.key)}</strong></p>`;
                    }).join('') : '<p class="lab-status">Fila vazia.</p>'}
                </div>
            </section>
        </li>
    `;

    document.getElementById('btnBackLabFromAnalysis').onclick = renderFluxoLab;
    document.getElementById('btnRefreshAnalysis')?.addEventListener('click', () => {
        if (current) getTrackMusicAnalysis(current, true);
        renderMusicAnalysisPanel();
    });
}

async function diagnoseTrackMedia(track, mode = 'audio') {
    const normalized = normalizeTrack(track);
    if (!normalized) return null;
    try {
        const result = await window.electronAPI?.diagnoseMedia?.(normalized, mode);
        if (!result?.ok) {
            recordMediaIssue(normalized, result?.reason || 'Diagnostico nao conseguiu gerar stream tocavel.', mode, { raw: result?.raw || result?.reason || '' });
        }
        return result;
    } catch (error) {
        recordMediaIssue(normalized, classifyMediaError(error, 'Diagnostico de midia falhou.'), mode, error);
        return { ok: false, reason: classifyMediaError(error, 'Diagnostico de midia falhou.') };
    }
}

function renderMediaDiagnosticsPanel() {
    const current = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
    panelTitle.innerText = "DIAGNOSTICO DE MIDIA";
    queueCounter.innerText = `${mediaIssues.length} alertas`;
    resultsList.innerHTML = `
        <li class="media-diagnostics-shell">
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-stethoscope"></i><h3>Teste da faixa atual</h3></div>
                ${current ? `
                    <p class="lab-status">${escapeHtml(current.title)} - ${escapeHtml(current.artist || 'Desconhecido')}</p>
                    <div class="lab-actions">
                        <button class="btn-action" id="btnBackLabFromMedia"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                        <button class="btn-confirm" id="btnDiagnoseAudio"><i class="ph ph-speaker-high"></i> TESTAR AUDIO</button>
                        <button class="btn-action" id="btnDiagnoseVideo"><i class="ph ph-video-camera"></i> TESTAR VIDEO</button>
                    </div>
                    <div id="mediaDiagResult" class="diagnostics-box"></div>
                ` : `
                    <p class="lab-status">Toque uma faixa para testar audio/video, DRM, regiao e stream.</p>
                    <button class="btn-action" id="btnBackLabFromMedia"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                `}
            </section>
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-warning-circle"></i><h3>Ultimos problemas</h3></div>
                <div class="media-issue-list">
                    ${mediaIssues.length ? mediaIssues.map((issue, issueIndex) => `
                        <article class="media-issue-card">
                            <strong>${escapeHtml(issue.track?.title || 'Faixa desconhecida')}</strong>
                            <span>${escapeHtml(issue.context)} - ${formatDateTime(issue.createdAt)}</span>
                            <p>${escapeHtml(issue.reason)}</p>
                            <button class="btn-action btn-rediagnose-issue" data-issue="${issueIndex}"><i class="ph ph-stethoscope"></i> TESTAR DE NOVO</button>
                        </article>
                    `).join('') : '<p class="lab-status">Nenhum problema de midia registrado.</p>'}
                </div>
                <button class="btn-abort" id="btnClearMediaIssues"><i class="ph ph-trash"></i> LIMPAR ALERTAS</button>
            </section>
        </li>
    `;

    document.getElementById('btnBackLabFromMedia').onclick = renderFluxoLab;
    document.getElementById('btnClearMediaIssues').onclick = () => {
        mediaIssues = [];
        saveMediaIssues();
        renderMediaDiagnosticsPanel();
    };
    document.querySelectorAll('.btn-rediagnose-issue').forEach(button => {
        button.onclick = async event => {
            const issue = mediaIssues[Number(event.currentTarget.dataset.issue)];
            if (!issue?.track) return;
            event.currentTarget.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i> TESTANDO...';
            await diagnoseTrackMedia(issue.track, issue.context || 'audio');
            renderMediaDiagnosticsPanel();
        };
    });

    const runDiagnosis = async mode => {
        const box = document.getElementById('mediaDiagResult');
        if (!box || !current) return;
        box.innerHTML = '<div class="diag-line"><span>Status</span><strong>testando...</strong></div>';
        const result = await diagnoseTrackMedia(current, mode);
        box.innerHTML = `
            <div class="diag-line"><span>Modo</span><strong>${escapeHtml(mode)}</strong></div>
            <div class="diag-line"><span>Resultado</span><strong>${result?.ok ? 'ok' : 'falhou'}</strong></div>
            <div class="diag-line"><span>Motivo</span><strong>${escapeHtml(result?.reason || 'Stream resolvido.')}</strong></div>
            ${result?.metadata?.title ? `<div class="diag-line"><span>Fonte</span><strong>${escapeHtml(result.metadata.title)}</strong></div>` : ''}
        `;
    };

    document.getElementById('btnDiagnoseAudio')?.addEventListener('click', () => runDiagnosis('audio'));
    document.getElementById('btnDiagnoseVideo')?.addEventListener('click', () => runDiagnosis('video'));
}

function getLibraryTrackEntries() {
    const entries = [];
    savedPlaylists.forEach((playlist, playlistIndex) => {
        (playlist.tracks || []).forEach((track, trackIndex) => {
            entries.push({ track: normalizeTrack(track), source: `Playlist: ${playlist.title}`, playlistIndex, trackIndex });
        });
    });
    queue.forEach((track, trackIndex) => entries.push({ track: normalizeTrack(track), source: 'Fila atual', playlistIndex: -1, trackIndex }));
    favoriteTracks.forEach((track, trackIndex) => entries.push({ track: normalizeTrack(track), source: 'Favoritos', playlistIndex: -1, trackIndex }));
    trackInbox.forEach((track, trackIndex) => entries.push({ track: normalizeTrack(track), source: 'Inbox', playlistIndex: -1, trackIndex }));
    playHistory.slice(0, 120).forEach((track, trackIndex) => entries.push({ track: normalizeTrack(track), source: 'Historico recente', playlistIndex: -1, trackIndex }));
    return entries.filter(entry => entry.track);
}

function analyzeLibraryHealth() {
    const entries = getLibraryTrackEntries();
    const byFingerprint = {};
    entries.forEach(entry => {
        const key = getTrackFingerprint(entry.track) || getTrackKey(entry.track);
        if (!key) return;
        if (!byFingerprint[key]) byFingerprint[key] = [];
        byFingerprint[key].push(entry);
    });
    const duplicates = Object.values(byFingerprint)
        .filter(group => group.length > 1)
        .sort((a, b) => b.length - a.length);
    const missingCovers = entries.filter(entry => !entry.track.thumbnail);
    const brokenSuspects = entries.filter(entry => {
        const key = getTrackKey(entry.track);
        const knownIssue = mediaIssues.some(issue => issue.trackKey === key);
        return knownIssue || !getTrackStreamId(entry.track) || entry.track.isBroken;
    });
    return { entries, duplicates, missingCovers, brokenSuspects };
}

function dedupeSavedPlaylists() {
    let removed = 0;
    savedPlaylists = savedPlaylists.map(playlist => {
        const seen = new Set();
        const tracks = [];
        (playlist.tracks || []).forEach(track => {
            const normalized = normalizeTrack(track);
            const key = getTrackFingerprint(normalized) || getTrackKey(normalized);
            if (!key || seen.has(key)) {
                removed++;
                return;
            }
            seen.add(key);
            tracks.push(normalized);
        });
        return { ...playlist, tracks };
    });
    savePlaylists();
    return removed;
}

async function diagnoseLibrarySuspects(button = null) {
    const health = analyzeLibraryHealth();
    const candidates = (health.brokenSuspects.length ? health.brokenSuspects : health.entries)
        .slice(0, 12)
        .map(entry => entry.track);
    const original = button?.innerHTML;
    let failures = 0;
    if (button) button.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i> TESTANDO...';
    for (const track of candidates) {
        const result = await diagnoseTrackMedia(track, 'audio');
        if (!result?.ok) failures++;
    }
    if (button) {
        button.innerHTML = `<i class="ph ph-check"></i> ${failures} ALERTAS`;
        setTimeout(() => { button.innerHTML = original; }, 1800);
    }
    renderLibraryDoctorPanel();
}

function renderLibraryDoctorPanel() {
    const health = analyzeLibraryHealth();
    unlockAchievement('libraryDoctor');
    queueCounter.innerText = `${health.entries.length} faixas`;
    panelTitle.innerText = 'BIBLIOTECA INTELIGENTE';
    const renderIssueList = (items, empty, renderer) => items.length
        ? items.slice(0, 10).map(renderer).join('')
        : `<div class="library-health-empty">${empty}</div>`;

    resultsList.innerHTML = `
        <li class="library-health-shell">
            <section class="library-health-hero">
                <div>
                    <span class="changelog-kicker">Diagnostico local</span>
                    <h3>${health.duplicates.length + health.missingCovers.length + health.brokenSuspects.length} pontos para revisar</h3>
                    <p>Analise segura das playlists, fila, favoritos, inbox e historico recente.</p>
                </div>
                <button class="btn-action" id="btnBackFromLibraryDoctor"><i class="ph ph-arrow-left"></i> VOLTAR</button>
            </section>
            <section class="insight-stat-grid">
                <div><strong>${health.entries.length}</strong><span>faixas</span></div>
                <div><strong>${health.duplicates.length}</strong><span>duplicadas</span></div>
                <div><strong>${health.missingCovers.length}</strong><span>sem capa</span></div>
                <div><strong>${health.brokenSuspects.length}</strong><span>suspeitas</span></div>
            </section>
            <section class="library-health-actions">
                <button class="btn-confirm" id="btnDedupeLibrary" ${health.duplicates.length ? '' : 'disabled'}><i class="ph ph-broom"></i> DEDUPLICAR PLAYLISTS</button>
                <button class="btn-action" id="btnDiagnoseLibrary"><i class="ph ph-stethoscope"></i> TESTAR STREAMS</button>
                <button class="btn-action" id="btnOpenMediaAlerts"><i class="ph ph-warning-diamond"></i> ALERTAS DE MIDIA</button>
            </section>
            <section class="library-health-grid">
                <article class="library-health-card">
                    <h4>Duplicadas</h4>
                    ${renderIssueList(health.duplicates, 'Nenhuma duplicada forte encontrada.', group => `
                        <div class="library-health-row">
                            <strong>${escapeHtml(group[0].track.title)}</strong>
                            <span>${group.length} copias - ${escapeHtml(group.map(item => item.source).slice(0, 3).join(', '))}</span>
                        </div>
                    `)}
                </article>
                <article class="library-health-card">
                    <h4>Sem capa</h4>
                    ${renderIssueList(health.missingCovers, 'Todas as faixas analisadas tem capa.', entry => `
                        <div class="library-health-row">
                            <strong>${escapeHtml(entry.track.title)}</strong>
                            <span>${escapeHtml(entry.source)}</span>
                        </div>
                    `)}
                </article>
                <article class="library-health-card">
                    <h4>Suspeitas / quebradas</h4>
                    ${renderIssueList(health.brokenSuspects, 'Nenhuma faixa suspeita marcada.', entry => `
                        <div class="library-health-row">
                            <strong>${escapeHtml(entry.track.title)}</strong>
                            <span>${escapeHtml(entry.source)}</span>
                        </div>
                    `)}
                </article>
            </section>
        </li>
    `;
    document.getElementById('btnBackFromLibraryDoctor').onclick = renderFluxoLab;
    document.getElementById('btnOpenMediaAlerts').onclick = renderMediaDiagnosticsPanel;
    document.getElementById('btnDiagnoseLibrary').onclick = event => diagnoseLibrarySuspects(event.currentTarget);
    document.getElementById('btnDedupeLibrary').onclick = () => {
        if (!confirm('Remover duplicadas dentro das playlists? O Fluxo mantem a primeira ocorrencia de cada faixa.')) return;
        const removed = dedupeSavedPlaylists();
        if (removed > 0) updateAchievementProgress('playlistSaved');
        renderLibraryDoctorPanel();
    };
}

function getHistoryWindow(days = 7) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    return playHistory.filter(item => Number(item.playedAt) >= since);
}

function renderListeningInsightsPanel() {
    const week = getHistoryWindow(7);
    const artistMap = new Map();
    const trackMap = new Map();
    const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    let totalSeconds = 0;

    week.forEach(item => {
        const track = normalizeTrack(item);
        const duration = Number(item.durationSeconds) || parseDurationSeconds(track.duration) || 180;
        totalSeconds += duration;
        artistMap.set(track.artist, (artistMap.get(track.artist) || 0) + 1);
        trackMap.set(track.title, (trackMap.get(track.title) || 0) + 1);
        const date = new Date(Number(item.playedAt) || Date.now());
        heat[date.getDay()][date.getHours()] += 1;
    });

    const topArtists = [...artistMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topTracks = [...trackMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxHeat = Math.max(1, ...heat.flat());

    panelTitle.innerText = "RECAP E HEATMAP";
    queueCounter.innerText = `${week.length} plays`;
    resultsList.innerHTML = `
        <li class="insights-shell">
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-calendar-check"></i><h3>Recap semanal</h3></div>
                <div class="insight-stat-grid">
                    <div><strong>${week.length}</strong><span>plays</span></div>
                    <div><strong>${Math.round(totalSeconds / 60)}</strong><span>minutos</span></div>
                    <div><strong>${artistMap.size}</strong><span>artistas</span></div>
                    <div><strong>${trackMap.size}</strong><span>faixas</span></div>
                </div>
                <button class="btn-action" id="btnBackLabFromInsights"><i class="ph ph-arrow-left"></i> VOLTAR</button>
            </section>
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-fire-simple"></i><h3>Heatmap de audicao</h3></div>
                <div class="heatmap-grid">
                    ${heat.map((day, dayIndex) => `
                        <div class="heatmap-row">
                            <span>${['D','S','T','Q','Q','S','S'][dayIndex]}</span>
                            ${day.map(count => `<i style="opacity:${0.14 + (count / maxHeat) * 0.86}" title="${count} plays"></i>`).join('')}
                        </div>
                    `).join('')}
                </div>
            </section>
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-ranking"></i><h3>Mais fortes</h3></div>
                <div class="rank-list">
                    <h4>Artistas</h4>
                    ${topArtists.map(([name, count]) => `<p><span>${escapeHtml(name)}</span><strong>${count}</strong></p>`).join('') || '<p class="lab-status">Sem dados.</p>'}
                    <h4>Faixas</h4>
                    ${topTracks.map(([name, count]) => `<p><span>${escapeHtml(name)}</span><strong>${count}</strong></p>`).join('') || '<p class="lab-status">Sem dados.</p>'}
                </div>
            </section>
        </li>
    `;
    document.getElementById('btnBackLabFromInsights').onclick = renderFluxoLab;
}

async function renderNetworkDiagnosticsPanel() {
    panelTitle.innerText = "DIAGNOSTICO DE REDE";
    queueCounter.innerText = "yt-dlp, RPC, bridge";
    resultsList.innerHTML = '<li class="lab-card solo-panel"><i class="ph ph-spinner-gap ph-spin"></i> Testando conexoes...</li>';
    const diag = await window.electronAPI?.runNetworkDiagnostics?.();
    resultsList.innerHTML = `
        <li class="lab-card solo-panel">
            <div class="lab-card-head"><i class="ph ph-pulse"></i><h3>Saude do Fluxo</h3></div>
            <div class="diagnostics-box">
                <div class="diag-line"><span>Online</span><strong>${diag?.online ? 'sim' : 'nao'}</strong></div>
                <div class="diag-line"><span>Cache de streams</span><strong>${diag?.streamCacheSize ?? 0}</strong></div>
                <div class="diag-line"><span>yt-dlp</span><strong>${diag?.ytDlpExists ? 'ok' : 'nao encontrado'}</strong></div>
                <div class="diag-line"><span>Warmup yt-dlp</span><strong>${diag?.ytDlpWarmup?.done ? (diag.ytDlpWarmup.ok ? `${escapeHtml(diag.ytDlpWarmup.version || 'ok')} / ${diag.ytDlpWarmup.elapsedMs}ms` : 'falhou') : 'aquecendo'}</strong></div>
                <div class="diag-line"><span>Stream Deck bridge</span><strong>${escapeHtml(diag?.controlServer?.url || 'offline')}</strong></div>
                ${(diag?.checks || []).map(check => `
                    <div class="diag-line"><span>${escapeHtml(check.url.replace(/^https?:\/\//, ''))}</span><strong>${check.ok ? `${check.ms}ms` : escapeHtml(check.error || 'falhou')}</strong></div>
                `).join('')}
            </div>
            <div class="lab-actions">
                <button class="btn-action" id="btnBackLabFromNetwork"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                <button class="btn-confirm" id="btnRunNetworkAgain"><i class="ph ph-arrow-clockwise"></i> TESTAR DE NOVO</button>
            </div>
        </li>
    `;
    document.getElementById('btnBackLabFromNetwork').onclick = renderFluxoLab;
    document.getElementById('btnRunNetworkAgain').onclick = renderNetworkDiagnosticsPanel;
}

function executePluginAction(action = {}) {
    const type = String(action.type || '').toLowerCase();
    const value = action.value ?? action.query ?? '';
    if (type === 'search') {
        searchInput.value = String(action.query || value);
        executeSearch();
    } else if (type === 'theme') {
        applyThemeClass(String(value || 'default'));
        localStorage.setItem('fluxo_theme', String(value || 'default'));
        updateNowPlayingWidget();
    } else if (type === 'eq') {
        initEQ();
        applyEqPreset(String(value || 'flat'), true);
    } else if (type === 'dsp') {
        applyDspProfile(String(value || 'normal'));
    } else if (type === 'podcast') {
        setPodcastMode(value !== false && value !== 'false');
    } else if (type === 'url' && /^https?:\/\//i.test(String(value))) {
        window.open(String(value), '_blank');
    }
}

async function renderPluginPanel() {
    panelTitle.innerText = "PLUGIN API";
    queueCounter.innerText = "json seguro";
    resultsList.innerHTML = '<li class="lab-card solo-panel"><i class="ph ph-spinner-gap ph-spin"></i> Lendo plugins...</li>';
    const data = await window.electronAPI?.listPlugins?.();
    const plugins = data?.plugins || [];
    resultsList.innerHTML = `
        <li class="plugin-shell">
            <section class="lab-card">
                <div class="lab-card-head"><i class="ph ph-plugs-connected"></i><h3>Plugins declarativos</h3></div>
                <p class="lab-status">Pasta: ${escapeHtml(data?.directory || '')}</p>
                <div class="lab-actions">
                    <button class="btn-action" id="btnBackLabFromPlugins"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                    <button class="btn-confirm" id="btnOpenPluginsFolder"><i class="ph ph-folder-open"></i> ABRIR PASTA</button>
                    <button class="btn-action" id="btnReloadPlugins"><i class="ph ph-arrow-clockwise"></i> RECARREGAR</button>
                </div>
            </section>
            ${plugins.map(plugin => `
                <section class="lab-card plugin-card ${plugin.error ? 'plugin-error' : ''}">
                    <div class="lab-card-head"><i class="ph ph-puzzle-piece"></i><h3>${escapeHtml(plugin.name)}</h3></div>
                    <p class="lab-status">${escapeHtml(plugin.description || plugin.file)}</p>
                    <div class="lab-actions">
                        ${(plugin.commands || []).map(command => `<button class="btn-action plugin-command" data-plugin="${escapeHtml(plugin.id)}" data-command="${escapeHtml(command.id)}">${escapeHtml(command.label)}</button>`).join('') || '<span class="lab-status">Sem comandos.</span>'}
                    </div>
                </section>
            `).join('')}
        </li>
    `;
    document.getElementById('btnBackLabFromPlugins').onclick = renderFluxoLab;
    document.getElementById('btnReloadPlugins').onclick = renderPluginPanel;
    document.getElementById('btnOpenPluginsFolder').onclick = () => window.electronAPI?.openPluginsFolder?.();
    document.querySelectorAll('.plugin-command').forEach(btn => {
        btn.onclick = () => {
            const plugin = plugins.find(item => item.id === btn.dataset.plugin);
            const command = plugin?.commands?.find(item => item.id === btn.dataset.command);
            executePluginAction(command?.action);
        };
    });
}

function getStreamDeckActions(baseUrl) {
    return ['play-pause', 'next', 'prev', 'vol-up', 'vol-down', 'toggle-video', 'fullscreen', 'party', 'mini', 'focus', 'ambient']
        .map(action => ({ action, url: `${baseUrl}/action/${action}` }));
}

async function renderStreamDeckPanel() {
    const info = await window.electronAPI?.getAppInfo?.();
    const baseUrl = info?.controlServer?.url || 'http://127.0.0.1:38995';
    panelTitle.innerText = "STREAM DECK BRIDGE";
    queueCounter.innerText = info?.controlServer?.enabled ? 'online' : 'offline';
    resultsList.innerHTML = `
        <li class="lab-card solo-panel">
            <div class="lab-card-head"><i class="ph ph-squares-four"></i><h3>Controle externo local</h3></div>
            <p class="lab-status">No Stream Deck, use a acao Open URL com estes links locais.</p>
            <div class="streamdeck-grid">
                ${getStreamDeckActions(baseUrl).map(item => `
                    <button class="btn-action streamdeck-copy" data-url="${escapeHtml(item.url)}">${escapeHtml(item.action)}</button>
                `).join('')}
            </div>
            <div class="lab-actions">
                <button class="btn-action" id="btnBackLabFromStreamDeck"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                <button class="btn-confirm" id="btnOpenStreamDeckPage"><i class="ph ph-browser"></i> ABRIR GUIA LOCAL</button>
            </div>
        </li>
    `;
    document.getElementById('btnBackLabFromStreamDeck').onclick = renderFluxoLab;
    document.getElementById('btnOpenStreamDeckPage').onclick = () => window.open(`${baseUrl}/streamdeck`, '_blank');
    document.querySelectorAll('.streamdeck-copy').forEach(btn => {
        btn.onclick = async () => {
            await navigator.clipboard.writeText(btn.dataset.url);
            btn.innerText = 'copiado';
        };
    });
}

function runAutomationAction(rule, track) {
    const action = String(rule.action || '').toLowerCase();
    const value = String(rule.value || '').trim();
    if (action === 'theme') {
        applyThemeClass(value || 'default');
        localStorage.setItem('fluxo_theme', value || 'default');
        updateNowPlayingWidget();
    } else if (action === 'eq') {
        initEQ();
        applyEqPreset(value || detectEqPresetForTrack(track), true);
    } else if (action === 'dsp') {
        applyDspProfile(value || 'normal');
    } else if (action === 'podcast') {
        setPodcastMode(true);
    } else if (action === 'party') {
        document.body.classList.add('party-mode');
    } else if (action === 'focus') {
        document.body.classList.add('focus-mode');
        localStorage.setItem('fluxo_focus_mode', 'true');
    } else if (action === 'crossfade') {
        isCrossfade = true;
        document.getElementById('crossfadeBtn')?.classList.add('active');
    }
}

function evaluateMusicAutomations(track) {
    const normalized = normalizeTrack(track);
    if (!normalized || !musicAutomations.length) return;
    const haystack = normalizeLookupText(`${normalized.title} ${normalized.artist}`);
    const trackKey = getTrackKey(normalized);

    musicAutomations
        .filter(rule => rule.enabled !== false && String(rule.keyword || '').trim())
        .forEach(rule => {
            const keyword = normalizeLookupText(rule.keyword);
            const memoryKey = `${rule.id}:${trackKey}`;
            if (keyword && haystack.includes(keyword) && automationRunMemory[memoryKey] !== true) {
                automationRunMemory[memoryKey] = true;
                runAutomationAction(rule, normalized);
            }
        });
}

function renderAutomationPanel() {
    panelTitle.innerText = "AUTOMACOES MUSICAIS";
    queueCounter.innerText = `${musicAutomations.length} regras`;
    resultsList.innerHTML = `
        <li class="lab-card solo-panel">
            <div class="lab-card-head"><i class="ph ph-flow-arrow"></i><h3>Quando tocar algo...</h3></div>
            <div class="lab-inline">
                <input id="automationKeyword" class="inline-input" placeholder="palavra no titulo/artista">
                <select id="automationAction" class="inline-input">
                    <option value="eq">Aplicar EQ</option>
                    <option value="dsp">Aplicar DSP</option>
                    <option value="theme">Trocar tema</option>
                    <option value="podcast">Ativar podcast</option>
                    <option value="party">Entrar modo festa</option>
                    <option value="focus">Entrar modo foco</option>
                    <option value="crossfade">Ativar crossfade</option>
                </select>
                <input id="automationValue" class="inline-input" placeholder="valor: vocal, matrix, slowed...">
                <button class="btn-confirm" id="btnAddAutomation">CRIAR</button>
            </div>
            <div class="automation-list">
                ${musicAutomations.map(rule => `
                    <article class="automation-card">
                        <span>Se tiver <strong>${escapeHtml(rule.keyword)}</strong>, ${escapeHtml(rule.action)} ${escapeHtml(rule.value || '')}</span>
                        <button class="btn-action btn-toggle-automation" data-id="${escapeHtml(rule.id)}">${rule.enabled === false ? 'OFF' : 'ON'}</button>
                        <button class="btn-abort btn-delete-automation" data-id="${escapeHtml(rule.id)}"><i class="ph ph-trash"></i></button>
                    </article>
                `).join('') || '<p class="lab-status">Nenhuma regra criada.</p>'}
            </div>
            <button class="btn-action" id="btnBackLabFromAutomation"><i class="ph ph-arrow-left"></i> VOLTAR</button>
        </li>
    `;
    document.getElementById('btnBackLabFromAutomation').onclick = renderFluxoLab;
    document.getElementById('btnAddAutomation').onclick = () => {
        const keyword = document.getElementById('automationKeyword').value.trim();
        if (!keyword) return;
        musicAutomations.unshift({
            id: `auto_${Date.now()}`,
            keyword,
            action: document.getElementById('automationAction').value,
            value: document.getElementById('automationValue').value.trim(),
            enabled: true
        });
        saveMusicAutomations();
        renderAutomationPanel();
    };
    document.querySelectorAll('.btn-toggle-automation').forEach(btn => {
        btn.onclick = () => {
            const rule = musicAutomations.find(item => item.id === btn.dataset.id);
            if (rule) rule.enabled = rule.enabled === false;
            saveMusicAutomations();
            renderAutomationPanel();
        };
    });
    document.querySelectorAll('.btn-delete-automation').forEach(btn => {
        btn.onclick = () => {
            musicAutomations = musicAutomations.filter(item => item.id !== btn.dataset.id);
            saveMusicAutomations();
            renderAutomationPanel();
        };
    });
}

function buildSharedPresetPayload() {
    let eqGains = normalizeEqGains(null);
    try {
        const parsed = JSON.parse(localStorage.getItem('fluxo_eq_gains') || 'null');
        eqGains = normalizeEqGains(parsed);
    } catch {}
    const compressor = getCompressorSettings();

    return {
        app: 'Fluxo Music',
        type: 'sound-preset',
        version: 2,
        exportedAt: new Date().toISOString(),
        eqPreset: localStorage.getItem('fluxo_eq_preset') || 'custom',
        eqGains,
        dspProfile: localStorage.getItem('fluxo_dsp_profile') || 'custom',
        playbackRate: localStorage.getItem('fluxo_playback_rate') || '1',
        reverbMix: localStorage.getItem('fluxo_reverb_mix') || '0',
        preservePitch: localStorage.getItem('fluxo_preserve_pitch') !== 'false',
        masterGain: localStorage.getItem('fluxo_master_gain') || '1',
        stereoPan: localStorage.getItem('fluxo_stereo_pan') || '0',
        compressor
    };
}

function applySharedPresetPayload(payload) {
    if (!payload || payload.type !== 'sound-preset') throw new Error('Preset invalido.');
    initEQ();
    if (Array.isArray(payload.eqGains)) {
        const nextGains = normalizeEqGains(payload.eqGains);
        nextGains.forEach((gain, index) => {
            if (filters[index]) filters[index].gain.value = gain;
            const slider = document.querySelectorAll('.eq-slider')[index];
            const label = document.getElementById(`eqVal${index}`);
            if (slider) slider.value = gain;
            if (label) label.innerText = formatDb(gain);
        });
        localStorage.setItem('fluxo_eq_gains', JSON.stringify(nextGains));
    }
    localStorage.setItem('fluxo_eq_preset', payload.eqPreset || 'custom');
    localStorage.setItem('fluxo_dsp_profile', payload.dspProfile || 'custom');
    setPlaybackRate(payload.playbackRate, true);
    setReverbMix(payload.reverbMix, true);
    setPitchPreserve(payload.preservePitch !== false, true);
    setMasterGain(payload.masterGain ?? 1, true);
    setStereoPan(payload.stereoPan ?? 0, true);
    if (payload.compressor && typeof payload.compressor === 'object') {
        setCompressorEnabled(payload.compressor.enabled === true, true);
        setCompressorParam('threshold', payload.compressor.threshold, true);
        setCompressorParam('ratio', payload.compressor.ratio, true);
        setCompressorParam('attack', payload.compressor.attack, true);
        setCompressorParam('release', payload.compressor.release, true);
    }
    updateDspUi();
}

function renderSharedPresetsPanel() {
    panelTitle.innerText = "PRESETS COMPARTILHAVEIS";
    queueCounter.innerText = "EQ/DSP";
    resultsList.innerHTML = `
        <li class="lab-card solo-panel">
            <div class="lab-card-head"><i class="ph ph-share-network"></i><h3>Exportar e importar som</h3></div>
            <textarea id="sharedPresetText" class="inline-input release-textarea">${escapeHtml(JSON.stringify(buildSharedPresetPayload(), null, 2))}</textarea>
            <div class="lab-actions">
                <button class="btn-action" id="btnBackLabFromPresets"><i class="ph ph-arrow-left"></i> VOLTAR</button>
                <button class="btn-confirm" id="btnCopySharedPreset">COPIAR</button>
                <button class="btn-action" id="btnApplySharedPreset">APLICAR TEXTO</button>
            </div>
            <span class="lab-status" id="sharedPresetStatus"></span>
        </li>
    `;
    document.getElementById('btnBackLabFromPresets').onclick = renderFluxoLab;
    document.getElementById('btnCopySharedPreset').onclick = async () => {
        await navigator.clipboard.writeText(document.getElementById('sharedPresetText').value);
        document.getElementById('sharedPresetStatus').innerText = 'Preset copiado.';
    };
    document.getElementById('btnApplySharedPreset').onclick = () => {
        try {
            applySharedPresetPayload(JSON.parse(document.getElementById('sharedPresetText').value));
            document.getElementById('sharedPresetStatus').innerText = 'Preset aplicado.';
        } catch (error) {
            document.getElementById('sharedPresetStatus').innerText = error.message || 'Falha ao aplicar.';
        }
    };
}

function renderFluxoLab() {
    panelTitle.innerText = "CENTRAL FLUXO";
    queueCounter.innerText = "ferramentas";
    const queueTabOptions = queueTabs.map(tab => `<option value="${tab.id}" ${tab.id === activeQueueTabId ? 'selected' : ''}>${escapeHtml(tab.title)}</option>`).join('');
    resultsList.innerHTML = `
        <li class="fluxo-lab fluxo-lab-simple fluxo-lab-ultra">
            <section class="lab-hero-simple">
                <div>
                    <span class="changelog-kicker">Central Fluxo</span>
                    <h3>Resolver rapido</h3>
                </div>
                <button class="btn-abort" id="btnRecoveryMode"><i class="ph ph-first-aid-kit"></i> RECUPERAR UI</button>
            </section>

            <section class="lab-rpc-strip">
                <div id="diagnosticsBox" class="diagnostics-box">Carregando...</div>
                <div class="lab-primary-actions">
                    <button class="btn-confirm" id="btnTestRpc"><i class="ph ph-discord-logo"></i> TESTAR RPC</button>
                    <button class="btn-abort" id="btnResetRpc"><i class="ph ph-plug-charging"></i> RESET RPC</button>
                    <button class="btn-action" id="btnRefreshDiagnostics"><i class="ph ph-arrows-clockwise"></i> STATUS</button>
                </div>
            </section>

            <section class="lab-action-board">
                <button class="btn-action" id="btnOpenDj"><i class="ph ph-sliders-horizontal"></i><span>Modo DJ</span></button>
                <button class="btn-action" id="btnMusicAnalysis"><i class="ph ph-metronome"></i><span>BPM / Tom</span></button>
                <button class="btn-action" id="btnMediaDiagnostics"><i class="ph ph-stethoscope"></i><span>Midia</span></button>
                <button class="btn-action" id="btnLibraryDoctor"><i class="ph ph-broom"></i><span>Biblioteca</span></button>
                <button class="btn-action" id="btnAchievements"><i class="ph ph-trophy"></i><span>Conquistas</span></button>
                <button class="btn-action" id="btnMusicInbox"><i class="ph ph-tray"></i><span>Inbox</span></button>
                <button class="btn-action" id="btnOpenWidget"><i class="ph ph-picture-in-picture"></i><span>Widget</span></button>
                <button class="btn-action" id="btnOpenStreamer"><i class="ph ph-broadcast"></i><span>OBS</span></button>
            </section>

            <details class="lab-details lab-advanced-tools">
                <summary>Ferramentas avancadas</summary>
                <div class="lab-advanced-grid">
                    <div class="lab-group">
                        <strong>Fila</strong>
                        <div class="lab-actions">
                            <button class="btn-action" id="btnOpenTrash">LIXEIRA (${playlistTrash.length})</button>
                            <button class="btn-action" id="btnToggleCompactLibrary">${isLibraryCompact ? 'BIBLIOTECA NORMAL' : 'BIBLIOTECA COMPACTA'}</button>
                        </div>
                        <div class="lab-inline">
                            <input id="durationQueueMinutes" class="inline-input" type="number" min="5" value="60">
                            <button class="btn-confirm" id="btnDurationQueue">GERAR POR DURACAO</button>
                        </div>
                        <div class="lab-inline">
                            <input id="queueTabName" class="inline-input" placeholder="Nome da aba">
                            <button class="btn-action" id="btnSaveQueueTab">SALVAR ABA</button>
                        </div>
                        <div class="lab-inline">
                            <select id="queueTabSelect" class="inline-input">${queueTabOptions || '<option value="">Nenhuma aba salva</option>'}</select>
                            <button class="btn-confirm" id="btnLoadQueueTab">CARREGAR</button>
                            <button class="btn-abort" id="btnDeleteQueueTab">EXCLUIR</button>
                        </div>
                    </div>

                    <div class="lab-group">
                        <strong>Audio</strong>
                        <div class="lab-actions">
                            <button class="btn-action" id="btnToggleBpm">${isBpmTransitionEnabled ? 'BPM TRANSITION ON' : 'BPM TRANSITION OFF'}</button>
                            <button class="btn-action" id="btnTogglePodcast">${isPodcastMode ? 'PODCAST ON' : 'MODO PODCAST'}</button>
                            <button class="btn-action" id="btnOpenSharedPresets">PRESETS SHARE</button>
                        </div>
                        <div class="lab-inline">
                            <select id="convertFormat" class="inline-input">
                                <option value="mp3">MP3</option>
                                <option value="m4a">M4A</option>
                                <option value="wav">WAV</option>
                                <option value="opus">OPUS</option>
                            </select>
                            <button class="btn-confirm" id="btnConvertCurrent">CONVERTER</button>
                        </div>
                        <div class="lab-inline">
                            <input id="sampleStart" class="inline-input" type="number" min="0" value="${Math.floor(audioPlayer.currentTime || 0)}">
                            <input id="sampleEnd" class="inline-input" type="number" min="1" value="${Math.floor((audioPlayer.currentTime || 0) + 30)}">
                            <button class="btn-action" id="btnExportSample">CORTAR</button>
                        </div>
                        <span id="audioLabStatus" class="lab-status"></span>
                    </div>

                    <div class="lab-group">
                        <strong>Interface</strong>
                        <div class="lab-actions">
                            <button class="btn-confirm" id="btnToggleFocus">${document.body.classList.contains('focus-mode') ? 'SAIR DO FOCO' : 'MODO FOCO'}</button>
                            <button class="btn-action ${miniPlayerVariant === 'compact' ? 'active active-pink' : ''}" id="btnMiniCompact">MINI COMPACTO</button>
                            <button class="btn-action ${miniPlayerVariant === 'horizontal' ? 'active active-pink' : ''}" id="btnMiniHorizontal">MINI HORIZONTAL</button>
                            <button class="btn-action ${miniPlayerVariant === 'cinema' ? 'active active-pink' : ''}" id="btnMiniCinema">MINI CINEMA</button>
                            <button class="btn-abort" id="btnResetCompactModes">SAIR DOS COMPACTOS</button>
                            <button class="btn-action" id="btnToggleAmbient">${isAmbientMode ? 'SAIR AMBIENTE' : 'TELA AMBIENTE'}</button>
                        </div>
                    </div>

                    <div class="lab-group">
                        <strong>Extras</strong>
                        <div class="lab-actions">
                            <button class="btn-action" id="btnNetworkDiagnostics">REDE</button>
                            <button class="btn-action" id="btnStreamDeckPanel">STREAM DECK</button>
                            <button class="btn-action" id="btnTrackComments">COMENTARIOS</button>
                            <button class="btn-action" id="btnListeningInsights">RECAP + HEATMAP</button>
                            <button class="btn-action" id="btnPluginApi">PLUGIN API</button>
                            <button class="btn-action" id="btnAutomationPanel">AUTOMACOES</button>
                        </div>
                        <div class="lab-inline">
                            <select id="adaptivePreloadMode" class="inline-input">
                                <option value="off" ${adaptivePreloadMode === 'off' ? 'selected' : ''}>Preload off</option>
                                <option value="light" ${adaptivePreloadMode === 'light' ? 'selected' : ''}>Preload leve</option>
                                <option value="balanced" ${adaptivePreloadMode === 'balanced' ? 'selected' : ''}>Preload balanceado</option>
                                <option value="aggressive" ${adaptivePreloadMode === 'aggressive' ? 'selected' : ''}>Preload agressivo</option>
                            </select>
                        </div>
                        <button class="btn-action" id="btnCopyRelease">COPIAR RELEASE NOTES</button>
                        <textarea id="releaseAssistantText" class="inline-input release-textarea" readonly>${escapeHtml(getReleaseAssistantText())}</textarea>
                    </div>
                </div>
            </details>
        </li>
    `;

    refreshDiagnosticsPanel();
    document.getElementById('btnRefreshDiagnostics').onclick = refreshDiagnosticsPanel;
    document.getElementById('btnNetworkDiagnostics').onclick = renderNetworkDiagnosticsPanel;
    document.getElementById('btnStreamDeckPanel').onclick = renderStreamDeckPanel;
    document.getElementById('btnTestRpc').onclick = async () => {
        await window.electronAPI?.testDiscordPresence?.();
        refreshDiagnosticsPanel();
    };
    document.getElementById('btnResetRpc').onclick = async () => {
        await window.electronAPI?.resetDiscordPresence?.();
        await window.electronAPI?.testDiscordPresence?.();
        refreshDiagnosticsPanel();
    };
    document.getElementById('btnOpenWidget').onclick = () => {
        updateNowPlayingWidget();
        window.electronAPI?.openNowPlayingWidget?.('widget');
    };
    document.getElementById('btnOpenStreamer').onclick = () => {
        updateNowPlayingWidget();
        window.electronAPI?.openNowPlayingWidget?.('streamer');
    };
    document.getElementById('btnDurationQueue').onclick = () => {
        const result = generateDurationQueue(document.getElementById('durationQueueMinutes').value);
        if (!result.tracks.length) return;
        queue = result.tracks;
        originalQueue = [...queue];
        currentIndex = 0;
        loadAndPlayTrack(0);
        document.getElementById('btnQueueView').click();
    };
    document.getElementById('btnSaveQueueTab').onclick = () => {
        saveCurrentQueueTab(document.getElementById('queueTabName').value);
        renderFluxoLab();
    };
    document.getElementById('btnLoadQueueTab').onclick = () => loadQueueTab(document.getElementById('queueTabSelect').value);
    document.getElementById('btnDeleteQueueTab').onclick = () => {
        deleteQueueTab(document.getElementById('queueTabSelect').value);
        renderFluxoLab();
    };
    document.getElementById('btnOpenTrash').onclick = renderPlaylistTrashPanel;
    document.getElementById('btnToggleCompactLibrary').onclick = () => {
        isLibraryCompact = !isLibraryCompact;
        localStorage.setItem('fluxo_library_compact', String(isLibraryCompact));
        renderFluxoLab();
    };
    document.getElementById('btnToggleBpm').onclick = () => {
        isBpmTransitionEnabled = !isBpmTransitionEnabled;
        localStorage.setItem('fluxo_bpm_transition', String(isBpmTransitionEnabled));
        renderFluxoLab();
    };
    document.getElementById('btnMusicAnalysis').onclick = renderMusicAnalysisPanel;
    document.getElementById('btnMediaDiagnostics').onclick = renderMediaDiagnosticsPanel;
    document.getElementById('btnLibraryDoctor').onclick = renderLibraryDoctorPanel;
    document.getElementById('btnAchievements').onclick = renderAchievementsPanel;
    document.getElementById('btnOpenDj').onclick = renderDjPanel;
    document.getElementById('btnTogglePodcast').onclick = () => {
        setPodcastMode(!isPodcastMode);
        renderFluxoLab();
    };
    document.getElementById('btnOpenSharedPresets').onclick = renderSharedPresetsPanel;
    document.getElementById('btnToggleFocus').onclick = () => {
        document.body.classList.toggle('focus-mode');
        localStorage.setItem('fluxo_focus_mode', String(document.body.classList.contains('focus-mode')));
        renderFluxoLab();
    };
    document.getElementById('btnMiniCompact').onclick = () => {
        setMiniPlayerVariant('compact');
        renderFluxoLab();
    };
    document.getElementById('btnMiniHorizontal').onclick = () => {
        setMiniPlayerVariant('horizontal');
        renderFluxoLab();
    };
    document.getElementById('btnMiniCinema').onclick = () => {
        setMiniPlayerVariant('cinema');
        renderFluxoLab();
    };
    document.getElementById('btnResetCompactModes').onclick = () => {
        resetCompactModes();
        renderFluxoLab();
    };
    document.getElementById('btnRecoveryMode').onclick = async () => {
        await runRecoveryMode();
        renderFluxoLab();
    };
    document.getElementById('btnToggleAmbient').onclick = () => {
        setAmbientMode(!isAmbientMode);
        renderFluxoLab();
    };
    document.getElementById('btnMusicInbox').onclick = renderMusicInboxPanel;
    document.getElementById('btnTrackComments').onclick = renderTrackCommentsPanel;
    document.getElementById('btnListeningInsights').onclick = renderListeningInsightsPanel;
    document.getElementById('btnPluginApi').onclick = renderPluginPanel;
    document.getElementById('btnAutomationPanel').onclick = renderAutomationPanel;
    document.getElementById('adaptivePreloadMode').onchange = (event) => {
        adaptivePreloadMode = event.target.value;
        localStorage.setItem('fluxo_adaptive_preload', adaptivePreloadMode);
        smartPrefetchUpcoming('track-load');
    };
    document.getElementById('btnCopyRelease').onclick = async () => {
        await navigator.clipboard.writeText(getReleaseAssistantText());
        document.getElementById('btnCopyRelease').innerHTML = '<i class="ph ph-check"></i> COPIADO';
    };
    document.getElementById('btnConvertCurrent').onclick = async () => {
        const status = document.getElementById('audioLabStatus');
        const track = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
        if (!track) return;
        status.innerText = 'Convertendo...';
        const result = await window.electronAPI?.convertCurrentTrack?.(track, document.getElementById('convertFormat').value);
        status.innerText = result?.success ? `Salvo em: ${result.path}` : `Erro: ${result?.error || 'falha desconhecida'}`;
    };
    document.getElementById('btnExportSample').onclick = async () => {
        const status = document.getElementById('audioLabStatus');
        const track = queue[currentIndex] ? normalizeTrack(queue[currentIndex]) : null;
        if (!track) return;
        status.innerText = 'Cortando sample...';
        const result = await window.electronAPI?.exportTrackSample?.(track, document.getElementById('sampleStart').value, document.getElementById('sampleEnd').value);
        status.innerText = result?.success ? `Sample salvo em: ${result.path}` : `Erro: ${result?.error || 'falha desconhecida'}`;
    };
}

document.getElementById('btnFavorites')?.addEventListener('click', renderFavoritesPanel);
document.getElementById('btnInbox')?.addEventListener('click', renderMusicInboxPanel);
document.getElementById('btnFluxoLab')?.addEventListener('click', renderFluxoLab);

document.getElementById('progressBar').onclick = function(e) { 
    if(!canControl('seek')) return;
    noteManualPlaybackControl('seek');
    const newTime = audioPlayer.duration * ((e.clientX - this.getBoundingClientRect().left) / this.getBoundingClientRect().width);
    audioPlayer.currentTime = newTime;
    updateDiscordNowPlaying(audioPlayer.paused ? 'paused' : 'playing');
    
    // Rearma a trava se você arrastar o tempo para antes dos últimos 6 segundos
    if (newTime < audioPlayer.duration - 6) {
        crossfadeTriggered = false; 
    }

    if(canPublishPlaybackEvent()) updateCurrentRoomState({ time: newTime, state: audioPlayer.paused ? 'paused' : 'playing', updatedAt: Date.now() }, 'sincronizar progresso');
};
function formatTime(s) { const m = Math.floor(s/60); const r = Math.floor(s%60); return `${m}:${r<10?'0':''}${r}`; }

// ========================================================
// EQUALIZADOR, DSP E VISUALIZADOR
// ========================================================
let audioCtx, analyser, dataArray, filters = [], eqInitialized = false;
let dryGainNode = null, wetGainNode = null, reverbNode = null, compressorNode = null, masterGainNode = null, stereoPanNode = null;
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_LABELS = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
const eqPresets = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rock: [4, 5, 4, 2, -1, -1, 2, 4, 5, 4],
    metal: [5, 5, 3, 0, -2, -1, 3, 5, 6, 4],
    trap: [7, 7, 5, 2, 0, -1, 1, 2, 5, 6],
    phonk: [9, 8, 5, 1, -2, -2, 2, 5, 7, 5],
    bass: [9, 8, 6, 3, 0, 0, 0, 1, 2, 2],
    edm: [6, 7, 4, 1, -1, 0, 2, 4, 6, 5],
    vocal: [-4, -3, -1, 1, 3, 5, 5, 3, 1, 0],
    podcast: [-5, -4, -2, 1, 4, 6, 5, 2, -1, -2],
    lofi: [3, 4, 3, 1, -1, -2, -1, 0, -2, -4],
    acoustic: [1, 2, 1, 0, 1, 3, 4, 3, 2, 1],
    pop: [3, 4, 2, 0, 1, 2, 3, 4, 4, 3],
    funk: [5, 6, 4, 1, -1, 0, 2, 4, 5, 3],
    jazz: [2, 3, 2, 1, 1, 2, 2, 1, 2, 1],
    classical: [1, 1, 0, 0, 1, 2, 2, 2, 3, 3],
    cinema: [6, 5, 3, 1, 0, 1, 2, 3, 5, 6],
    slowed: [5, 5, 3, 1, -1, -2, -1, 1, 3, 2],
    nightcore: [0, 1, 1, 0, 0, 1, 3, 5, 6, 7],
    vaporwave: [5, 4, 2, 0, -3, -3, -1, 0, 2, 1],
    speaker: [-6, -4, -1, 2, 4, 5, 4, 2, -1, -3]
};
const eqPresetLabels = {
    flat: 'Flat / Normal',
    rock: 'Rock',
    metal: 'Metal',
    trap: 'Trap / Bass',
    phonk: 'Phonk / Drift',
    bass: 'Bass Boost',
    edm: 'EDM / Club',
    vocal: 'Vocal',
    podcast: 'Podcast / Voz',
    lofi: 'Lo-fi',
    acoustic: 'Acustico',
    pop: 'Pop',
    funk: 'Funk',
    jazz: 'Jazz',
    classical: 'Classico',
    cinema: 'Cinema',
    slowed: 'Slowed Warm',
    nightcore: 'Nightcore Shine',
    vaporwave: 'Vaporwave',
    speaker: 'Caixa pequena'
};

const dspProfiles = {
    normal: { label: 'Normal', rate: 1, reverb: 0, preservePitch: true, eq: 'flat', compressor: false, threshold: -18, ratio: 4, attack: 0.003, release: 0.25, masterGain: 1, stereoPan: 0 },
    slowed: { label: 'Slowed + Reverb', rate: 0.82, reverb: 0.42, preservePitch: false, eq: 'slowed', compressor: true, threshold: -22, ratio: 3 },
    nightcore: { label: 'Nightcore', rate: 1.25, reverb: 0.06, preservePitch: false, eq: 'nightcore', compressor: true, threshold: -16, ratio: 2.5 },
    vaporwave: { label: 'Vaporwave', rate: 0.74, reverb: 0.48, preservePitch: false, eq: 'vaporwave', stereoPan: 0 },
    cinema: { label: 'Cinema', rate: 1, reverb: 0.26, preservePitch: true, eq: 'cinema', compressor: true, threshold: -24, ratio: 4, masterGain: 1.08 },
    podcast: { label: 'Podcast Clean', rate: 1, reverb: 0.02, preservePitch: true, eq: 'podcast', compressor: true, threshold: -28, ratio: 5, masterGain: 1.04 },
    club: { label: 'Club Punch', rate: 1, reverb: 0.12, preservePitch: true, eq: 'edm', compressor: true, threshold: -18, ratio: 3, masterGain: 1.1 },
    bassBoost: { label: 'Bass Boost', rate: 1, reverb: 0.04, preservePitch: true, eq: 'bass', compressor: true, threshold: -20, ratio: 3.5, masterGain: 1.02 },
    cleanVocal: { label: 'Voz na Frente', rate: 1, reverb: 0.03, preservePitch: true, eq: 'vocal', compressor: true, threshold: -26, ratio: 4 },
    lateNight: { label: 'Madrugada', rate: 0.96, reverb: 0.08, preservePitch: true, eq: 'lofi', compressor: true, threshold: -30, ratio: 2, masterGain: 0.82 }
};

function ensureNormalDspDefault() {
    const marker = 'fluxo_dsp_normal_default_v3921';
    if (localStorage.getItem(marker) === 'true') return;
    const profile = dspProfiles.normal;
    localStorage.setItem('fluxo_dsp_profile', 'normal');
    localStorage.setItem('fluxo_eq_preset', profile.eq);
    localStorage.setItem('fluxo_eq_gains', JSON.stringify(normalizeEqGains(eqPresets[profile.eq])));
    localStorage.setItem('fluxo_playback_rate', String(profile.rate));
    localStorage.setItem('fluxo_reverb_mix', String(profile.reverb));
    localStorage.setItem('fluxo_preserve_pitch', String(profile.preservePitch));
    localStorage.setItem('fluxo_master_gain', String(profile.masterGain));
    localStorage.setItem('fluxo_stereo_pan', String(profile.stereoPan));
    localStorage.setItem('fluxo_compressor_enabled', String(profile.compressor));
    localStorage.setItem('fluxo_compressor_threshold', String(profile.threshold));
    localStorage.setItem('fluxo_compressor_ratio', String(profile.ratio));
    localStorage.setItem('fluxo_compressor_attack', String(profile.attack));
    localStorage.setItem('fluxo_compressor_release', String(profile.release));
    localStorage.setItem(marker, 'true');
}

ensureNormalDspDefault();

function detectEqPresetForTrack(track) {
    const haystack = normalizeLookupText(`${track?.title || ''} ${track?.artist || ''}`);
    if (/\b(podcast|voz|voice|audiobook|entrevista|talk)\b/.test(haystack)) return 'podcast';
    if (/\b(lofi|lo-fi|chillhop|study|sleep|rain)\b/.test(haystack)) return 'lofi';
    if (/\b(acoustic|acustico|unplugged|cover|ao vivo|live)\b/.test(haystack)) return 'acoustic';
    if (/\b(jazz|swing|bebop|sax)\b/.test(haystack)) return 'jazz';
    if (/\b(classical|orchestra|piano|violin|symphony|ost)\b/.test(haystack)) return 'classical';
    if (/\b(phonk|drift|brazilian funk|funk mandelao|funk mtg)\b/.test(haystack)) return 'phonk';
    if (/\b(deathcore|nu metal|metalcore|metal)\b/.test(haystack)) return 'metal';
    if (/\b(rock|punk|hardcore|grunge)\b/.test(haystack)) return 'rock';
    if (/\b(trap|rap|hip hop|drill|rnb|plug|rage)\b/.test(haystack)) return 'trap';
    if (/\b(dubstep|edm|house|techno|eletronica|electronic|club)\b/.test(haystack)) return 'edm';
    if (/\b(bass boosted|subwoofer|grave)\b/.test(haystack)) return 'bass';
    if (/\b(funk|funky|groove)\b/.test(haystack)) return 'funk';
    if (/\b(pop|dance)\b/.test(haystack)) return 'pop';
    if (/\b(vocal|voz)\b/.test(haystack)) return 'vocal';
    return 'flat';
}

function applyEqPreset(preset, persist = true) {
    if (!eqPresets[preset] || !filters.length) return;
    const gains = normalizeEqGains(eqPresets[preset]);

    gains.forEach((gain, i) => {
        if (!filters[i]) return;
        filters[i].gain.value = gain;
        const slider = document.querySelectorAll('.eq-slider')[i];
        const label = document.getElementById(`eqVal${i}`);
        if (slider) slider.value = gain;
        if (label) label.innerText = formatDb(gain);
    });

    const select = document.getElementById('eqPresetSelect');
    if (select) select.value = preset;

    if (persist) {
        localStorage.setItem('fluxo_eq_preset', preset);
        localStorage.setItem('fluxo_eq_gains', JSON.stringify(gains));
    }
    publishSessionEqState('sincronizar preset de EQ');
}

function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

function formatDb(value) {
    const gain = clampNumber(value, -15, 15, 0);
    const rounded = Math.round(gain * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${rounded}dB`;
}

function normalizeEqGains(gains, fallbackPreset = 'flat') {
    const fallback = eqPresets[fallbackPreset] || eqPresets.flat;
    const source = Array.isArray(gains) ? gains : fallback;
    if (source.length === EQ_FREQUENCIES.length) {
        return source.map(gain => clampNumber(gain, -15, 15, 0));
    }
    if (source.length === 5) {
        const legacy = source.map(gain => clampNumber(gain, -15, 15, 0));
        return [
            legacy[0], legacy[0],
            legacy[1], legacy[1],
            legacy[2], legacy[2],
            legacy[3], legacy[3],
            legacy[4], legacy[4]
        ];
    }
    return EQ_FREQUENCIES.map((_, index) => clampNumber(source[index], -15, 15, fallback[index] || 0));
}

function createReverbImpulse(ctx, duration = 2.8, decay = 2.6) {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            const progress = i / length;
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - progress, decay);
        }
    }

    return impulse;
}

function setPitchPreserve(enabled, persist = true) {
    const value = Boolean(enabled);
    audioPlayer.preservesPitch = value;
    audioPlayer.mozPreservesPitch = value;
    audioPlayer.webkitPreservesPitch = value;
    if (persist) localStorage.setItem('fluxo_preserve_pitch', String(value));
    updateDspUi();
    if (persist) publishSessionEqState('sincronizar pitch do EQ');
}

function setPlaybackRate(rate, persist = true) {
    const nextRate = clampNumber(rate, 0.5, 1.6, 1);
    audioPlayer.playbackRate = nextRate;
    audioPlayer.defaultPlaybackRate = nextRate;
    if (persist) localStorage.setItem('fluxo_playback_rate', String(nextRate));
    updateDspUi();
    updateDiscordNowPlaying(audioPlayer.paused ? 'paused' : 'playing');
    if (persist) publishSessionEqState('sincronizar velocidade do EQ');
}

function setReverbMix(mix, persist = true) {
    const nextMix = clampNumber(mix, 0, 0.75, 0);
    if (wetGainNode && dryGainNode) {
        wetGainNode.gain.value = nextMix;
        dryGainNode.gain.value = 1 - Math.min(0.42, nextMix * 0.55);
    }
    if (persist) localStorage.setItem('fluxo_reverb_mix', String(nextMix));
    updateDspUi();
    if (persist) publishSessionEqState('sincronizar reverb do EQ');
}

function getCompressorSettings() {
    return {
        enabled: localStorage.getItem('fluxo_compressor_enabled') === 'true',
        threshold: clampNumber(localStorage.getItem('fluxo_compressor_threshold'), -60, 0, -18),
        ratio: clampNumber(localStorage.getItem('fluxo_compressor_ratio'), 1, 20, 4),
        attack: clampNumber(localStorage.getItem('fluxo_compressor_attack'), 0, 1, 0.003),
        release: clampNumber(localStorage.getItem('fluxo_compressor_release'), 0.05, 1, 0.25)
    };
}

function applyCompressorSettings() {
    if (!compressorNode) return;
    const settings = getCompressorSettings();
    compressorNode.threshold.value = settings.enabled ? settings.threshold : 0;
    compressorNode.knee.value = settings.enabled ? 18 : 0;
    compressorNode.ratio.value = settings.enabled ? settings.ratio : 1;
    compressorNode.attack.value = settings.attack;
    compressorNode.release.value = settings.release;
}

function setCompressorEnabled(enabled, persist = true) {
    if (persist) localStorage.setItem('fluxo_compressor_enabled', String(Boolean(enabled)));
    applyCompressorSettings();
    updateDspUi();
    if (persist) publishSessionEqState('sincronizar compressor');
}

function setCompressorParam(key, value, persist = true) {
    const ranges = {
        threshold: ['fluxo_compressor_threshold', -60, 0, -18],
        ratio: ['fluxo_compressor_ratio', 1, 20, 4],
        attack: ['fluxo_compressor_attack', 0, 1, 0.003],
        release: ['fluxo_compressor_release', 0.05, 1, 0.25]
    };
    const config = ranges[key];
    if (!config) return;
    const [storageKey, min, max, fallback] = config;
    const nextValue = clampNumber(value, min, max, fallback);
    if (persist) localStorage.setItem(storageKey, String(nextValue));
    applyCompressorSettings();
    updateDspUi();
    if (persist) publishSessionEqState('sincronizar compressor');
}

function setMasterGain(gain, persist = true) {
    const nextGain = clampNumber(gain, 0.4, 1.4, 1);
    if (masterGainNode) masterGainNode.gain.value = nextGain;
    if (persist) localStorage.setItem('fluxo_master_gain', String(nextGain));
    updateDspUi();
    if (persist) publishSessionEqState('sincronizar master');
}

function setStereoPan(pan, persist = true) {
    const nextPan = clampNumber(pan, -1, 1, 0);
    if (stereoPanNode) stereoPanNode.pan.value = nextPan;
    if (persist) localStorage.setItem('fluxo_stereo_pan', String(nextPan));
    updateDspUi();
    if (persist) publishSessionEqState('sincronizar panorama');
}

function applySavedDspSettings() {
    const savedRate = clampNumber(localStorage.getItem('fluxo_playback_rate'), 0.5, 1.6, 1);
    const savedReverb = clampNumber(localStorage.getItem('fluxo_reverb_mix'), 0, 0.75, 0);
    const preservePitch = localStorage.getItem('fluxo_preserve_pitch') !== 'false';
    setPitchPreserve(preservePitch, false);
    setPlaybackRate(savedRate, false);
    setReverbMix(savedReverb, false);
    setMasterGain(localStorage.getItem('fluxo_master_gain') || 1, false);
    setStereoPan(localStorage.getItem('fluxo_stereo_pan') || 0, false);
    applyCompressorSettings();
}

function applyDspProfile(profileKey) {
    const profile = dspProfiles[profileKey] || dspProfiles.normal;
    const normalProfile = dspProfiles.normal;
    localStorage.setItem('fluxo_dsp_profile', profileKey);
    setPitchPreserve(profile.preservePitch, true);
    setPlaybackRate(profile.rate, true);
    setReverbMix(profile.reverb, true);
    applyEqPreset(profile.eq, true);
    if (profile.masterGain !== undefined) setMasterGain(profile.masterGain, true);
    else setMasterGain(normalProfile.masterGain, true);
    if (profile.stereoPan !== undefined) setStereoPan(profile.stereoPan, true);
    else setStereoPan(normalProfile.stereoPan, true);
    if (profile.compressor !== undefined) setCompressorEnabled(profile.compressor, true);
    if (profile.threshold !== undefined || normalProfile.threshold !== undefined) setCompressorParam('threshold', profile.threshold ?? normalProfile.threshold ?? -18, true);
    if (profile.ratio !== undefined || normalProfile.ratio !== undefined) setCompressorParam('ratio', profile.ratio ?? normalProfile.ratio ?? 4, true);
    setCompressorParam('attack', profile.attack ?? normalProfile.attack ?? 0.003, true);
    setCompressorParam('release', profile.release ?? normalProfile.release ?? 0.25, true);
    updateDspUi();
}

function updateDspUi() {
    const rate = clampNumber(audioPlayer.playbackRate, 0.5, 1.6, 1);
    const reverb = clampNumber(localStorage.getItem('fluxo_reverb_mix'), 0, 0.75, 0);
    const masterGain = clampNumber(localStorage.getItem('fluxo_master_gain'), 0.4, 1.4, 1);
    const stereoPan = clampNumber(localStorage.getItem('fluxo_stereo_pan'), -1, 1, 0);
    const compressor = getCompressorSettings();
    const speedSlider = document.getElementById('speedRateSlider');
    const reverbSlider = document.getElementById('reverbMixSlider');
    const masterSlider = document.getElementById('masterGainSlider');
    const panSlider = document.getElementById('stereoPanSlider');
    const compressorToggle = document.getElementById('compressorToggle');
    const compressorThreshold = document.getElementById('compressorThresholdSlider');
    const compressorRatio = document.getElementById('compressorRatioSlider');
    const compressorAttack = document.getElementById('compressorAttackSlider');
    const compressorRelease = document.getElementById('compressorReleaseSlider');
    const speedValue = document.getElementById('speedRateValue');
    const reverbValue = document.getElementById('reverbMixValue');
    const masterValue = document.getElementById('masterGainValue');
    const panValue = document.getElementById('stereoPanValue');
    const compressorThresholdValue = document.getElementById('compressorThresholdValue');
    const compressorRatioValue = document.getElementById('compressorRatioValue');
    const compressorAttackValue = document.getElementById('compressorAttackValue');
    const compressorReleaseValue = document.getElementById('compressorReleaseValue');
    const compressorStateValue = document.getElementById('compressorStateValue');
    const pitchToggle = document.getElementById('preservePitchToggle');

    if (speedSlider) speedSlider.value = rate;
    if (reverbSlider) reverbSlider.value = reverb;
    if (masterSlider) masterSlider.value = masterGain;
    if (panSlider) panSlider.value = stereoPan;
    if (compressorToggle) compressorToggle.checked = compressor.enabled;
    if (compressorThreshold) compressorThreshold.value = compressor.threshold;
    if (compressorRatio) compressorRatio.value = compressor.ratio;
    if (compressorAttack) compressorAttack.value = compressor.attack;
    if (compressorRelease) compressorRelease.value = compressor.release;
    if (speedValue) speedValue.innerText = `${rate.toFixed(2)}x`;
    if (reverbValue) reverbValue.innerText = `${Math.round(reverb * 100)}%`;
    if (masterValue) masterValue.innerText = `${Math.round(masterGain * 100)}%`;
    if (panValue) {
        panValue.innerText = stereoPan === 0
            ? 'Centro'
            : `${stereoPan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(stereoPan) * 100)}%`;
    }
    if (compressorThresholdValue) compressorThresholdValue.innerText = `${Math.round(compressor.threshold)}dB`;
    if (compressorRatioValue) compressorRatioValue.innerText = `${compressor.ratio.toFixed(1)}:1`;
    if (compressorAttackValue) compressorAttackValue.innerText = `${Math.round(compressor.attack * 1000)}ms`;
    if (compressorReleaseValue) compressorReleaseValue.innerText = `${Math.round(compressor.release * 1000)}ms`;
    if (compressorStateValue) compressorStateValue.innerText = compressor.enabled ? 'ON' : 'OFF';
    if (pitchToggle) pitchToggle.checked = audioPlayer.preservesPitch !== false;

    document.querySelectorAll('.dsp-profile-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.profile === localStorage.getItem('fluxo_dsp_profile'));
    });
}

function initEQ() {
    if (eqInitialized) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(audioPlayer);
        let prevNode = source;
        let storedGains = null;
        try {
            storedGains = JSON.parse(localStorage.getItem('fluxo_eq_gains') || 'null');
        } catch {}
        let savedGains = normalizeEqGains(storedGains);
        localStorage.setItem('fluxo_eq_gains', JSON.stringify(savedGains));
        EQ_FREQUENCIES.forEach((freq, i) => {
            let filter = audioCtx.createBiquadFilter();
            filter.type = (i === 0) ? "lowshelf" : (i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking");
            filter.Q.value = i === 0 || i === EQ_FREQUENCIES.length - 1 ? 0.8 : 1.05;
            filter.frequency.value = freq; filter.gain.value = savedGains[i];
            prevNode.connect(filter); prevNode = filter; filters.push(filter);
        });
        analyser = audioCtx.createAnalyser(); analyser.fftSize = 32;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        dryGainNode = audioCtx.createGain();
        wetGainNode = audioCtx.createGain();
        reverbNode = audioCtx.createConvolver();
        reverbNode.buffer = createReverbImpulse(audioCtx);
        compressorNode = audioCtx.createDynamicsCompressor();
        masterGainNode = audioCtx.createGain();
        stereoPanNode = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;

        prevNode.connect(dryGainNode);
        dryGainNode.connect(analyser);
        prevNode.connect(reverbNode);
        reverbNode.connect(wetGainNode);
        wetGainNode.connect(analyser);
        analyser.connect(compressorNode);
        compressorNode.connect(masterGainNode);
        if (stereoPanNode) {
            masterGainNode.connect(stereoPanNode);
            stereoPanNode.connect(audioCtx.destination);
        } else {
            masterGainNode.connect(audioCtx.destination);
        }

        eqInitialized = true;
        applySavedDspSettings();
        startVisualizer();
    } catch (e) { eqInitialized = true; }
}

function drawTimelineWaveform() {
    if (!timelineWaveform) return;
    const rect = timelineWaveform.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (timelineWaveform.width !== width) timelineWaveform.width = width;
    if (timelineWaveform.height !== height) timelineWaveform.height = height;

    const ctx = timelineWaveform.getContext('2d');
    if (!ctx) return;

    const computed = getComputedStyle(document.body);
    const accent = computed.getPropertyValue('--neon-cyan').trim() || '#00ffcc';
    const secondary = computed.getPropertyValue('--neon-pink').trim() || '#ff0055';
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 0.78;

    const source = dataArray && dataArray.length ? dataArray : new Uint8Array(16).map((_, i) => 70 + ((i * 37) % 110));
    const bars = Math.min(56, Math.max(24, Math.floor(width / 8)));
    const barWidth = width / bars;
    const progress = Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0 ? audioPlayer.currentTime / audioPlayer.duration : 0;

    for (let i = 0; i < bars; i++) {
        const value = source[i % source.length] || 24;
        const normalized = value / 255;
        const barHeight = Math.max(2, normalized * height * 0.86);
        const x = i * barWidth;
        const y = (height - barHeight) / 2;
        ctx.fillStyle = (i / bars) <= progress ? accent : secondary;
        ctx.fillRect(x + 1, y, Math.max(1, barWidth - 3), barHeight);
    }
}

function startVisualizer() {
    const bars = document.querySelectorAll('.vis-bar');
    function draw() {
        requestAnimationFrame(draw);
        if (!analyser) {
            drawTimelineWaveform();
            return;
        }
        analyser.getByteFrequencyData(dataArray);
        bars.forEach((bar, i) => { bar.style.height = `${(dataArray[i] / 255) * 15 + 2}px`; });
        drawTimelineWaveform();
    }
    draw();
}

document.getElementById('btnEQ').onclick = () => {
    initEQ();
    panelTitle.innerText = "DIGITAL SOUND PROCESSOR";
    const curP = localStorage.getItem('fluxo_eq_preset') || 'custom';
    const autoEq = localStorage.getItem('fluxo_eq_auto') === 'true';
    const currentProfile = localStorage.getItem('fluxo_dsp_profile') || 'custom';
    const compressor = getCompressorSettings();
    resultsList.innerHTML = `
        <li class="eq-shell" id="eqShell">
            <div class="eq-hero">
                <div>
                    <span class="eq-kicker">FLUXO DSP ENGINE</span>
                    <h3>Equalizador 10 bandas, velocidade e master</h3>
                </div>
                <label class="eq-toggle"><input type="checkbox" id="eqAutoMode" ${autoEq?'checked':''}> Auto por genero</label>
            </div>

            <div class="eq-profile-grid">
                ${Object.entries(dspProfiles).map(([key, profile]) => `
                    <button class="btn-action dsp-profile-btn ${currentProfile === key ? 'active' : ''}" data-profile="${key}">
                        ${profile.label}
                    </button>
                `).join('')}
            </div>

            <div class="eq-control-row">
                <label class="eq-field">
                    <span>Preset EQ</span>
                    <select id="eqPresetSelect" class="inline-input">
                        <option value="custom" ${curP==='custom'?'selected':''}>Customizado</option>
                        ${Object.keys(eqPresets).map(key => `<option value="${key}" ${curP===key?'selected':''}>${eqPresetLabels[key] || key}</option>`).join('')}
                    </select>
                </label>
                <button class="btn-abort" id="btnResetDsp"><i class="ph ph-arrow-counter-clockwise"></i> Reset DSP</button>
            </div>

            <div class="eq-fx-grid">
                <div class="eq-card">
                    <div class="eq-card-head"><i class="ph ph-gauge"></i><span>Velocidade</span><strong id="speedRateValue">1.00x</strong></div>
                    <input type="range" id="speedRateSlider" class="dsp-slider" min="0.5" max="1.6" step="0.01" value="${audioPlayer.playbackRate || 1}">
                    <div class="eq-markers"><span>Slower</span><span>Normal</span><span>Nightcore</span></div>
                </div>
                <div class="eq-card">
                    <div class="eq-card-head"><i class="ph ph-waves"></i><span>Reverb</span><strong id="reverbMixValue">0%</strong></div>
                    <input type="range" id="reverbMixSlider" class="dsp-slider" min="0" max="0.75" step="0.01" value="${localStorage.getItem('fluxo_reverb_mix') || 0}">
                    <label class="eq-toggle eq-pitch"><input type="checkbox" id="preservePitchToggle"> Preservar tom</label>
                </div>
                <div class="eq-card">
                    <div class="eq-card-head"><i class="ph ph-speaker-hifi"></i><span>Master</span><strong id="masterGainValue">100%</strong></div>
                    <input type="range" id="masterGainSlider" class="dsp-slider" min="0.4" max="1.4" step="0.01" value="${localStorage.getItem('fluxo_master_gain') || 1}">
                    <div class="eq-markers"><span>Seguro</span><span>Normal</span><span>Alto</span></div>
                </div>
                <div class="eq-card">
                    <div class="eq-card-head"><i class="ph ph-arrows-left-right"></i><span>Panorama</span><strong id="stereoPanValue">Centro</strong></div>
                    <input type="range" id="stereoPanSlider" class="dsp-slider" min="-1" max="1" step="0.01" value="${localStorage.getItem('fluxo_stereo_pan') || 0}">
                    <div class="eq-markers"><span>Esq</span><span>Centro</span><span>Dir</span></div>
                </div>
                <div class="eq-card eq-card-wide">
                    <div class="eq-card-head"><i class="ph ph-wave-sine"></i><span>Compressor / Limiter</span><strong id="compressorStateValue">${compressor.enabled ? 'ON' : 'OFF'}</strong></div>
                    <label class="eq-toggle eq-pitch"><input type="checkbox" id="compressorToggle" ${compressor.enabled ? 'checked' : ''}> Nivelar volume e segurar picos</label>
                    <div class="eq-mini-grid">
                        <label><span>Threshold <b id="compressorThresholdValue">${Math.round(compressor.threshold)}dB</b></span><input type="range" id="compressorThresholdSlider" class="dsp-slider" min="-60" max="0" step="1" value="${compressor.threshold}"></label>
                        <label><span>Ratio <b id="compressorRatioValue">${compressor.ratio.toFixed(1)}:1</b></span><input type="range" id="compressorRatioSlider" class="dsp-slider" min="1" max="20" step="0.5" value="${compressor.ratio}"></label>
                        <label><span>Attack <b id="compressorAttackValue">${Math.round(compressor.attack * 1000)}ms</b></span><input type="range" id="compressorAttackSlider" class="dsp-slider" min="0" max="1" step="0.001" value="${compressor.attack}"></label>
                        <label><span>Release <b id="compressorReleaseValue">${Math.round(compressor.release * 1000)}ms</b></span><input type="range" id="compressorReleaseSlider" class="dsp-slider" min="0.05" max="1" step="0.01" value="${compressor.release}"></label>
                    </div>
                </div>
            </div>

            <div class="eq-sliders eq-sliders-expanded">
                ${EQ_LABELS.map((label, i) => `
                    <div class="eq-band">
                        <input type="range" i="${i}" class="eq-slider" min="-15" max="15" step="0.5" value="${filters[i]?.gain.value || 0}">
                        <span class="eq-band-label">${label}</span>
                        <span id="eqVal${i}" class="eq-band-value">${formatDb(filters[i]?.gain.value || 0)}</span>
                    </div>
                `).join('')}
            </div>
        </li>`;
    resultsList.querySelectorAll('.eq-slider').forEach(el => el.oninput = (e) => { 
        const idx = Number(el.getAttribute('i'));
        const gain = clampNumber(e.target.value, -15, 15, 0);
        if (filters[idx]) filters[idx].gain.value = gain;
        document.getElementById(`eqVal${idx}`).innerText = formatDb(gain);
        document.getElementById('eqPresetSelect').value = 'custom';
        const autoMode = document.getElementById('eqAutoMode');
        if (autoMode) autoMode.checked = false;
        localStorage.setItem('fluxo_eq_auto', 'false');
        localStorage.setItem('fluxo_eq_preset', 'custom');
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        localStorage.setItem('fluxo_eq_gains', JSON.stringify(filters.map(f => clampNumber(f.gain.value, -15, 15, 0))));
        updateDspUi();
    });
    document.getElementById('eqPresetSelect').onchange = (e) => {
        const val = e.target.value;
        localStorage.setItem('fluxo_eq_auto', 'false');
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        const autoMode = document.getElementById('eqAutoMode');
        if (autoMode) autoMode.checked = false;
        if (val !== 'custom') applyEqPreset(val, true);
        updateDspUi();
    };
    document.getElementById('eqAutoMode').onchange = (e) => {
        localStorage.setItem('fluxo_eq_auto', String(e.target.checked));
        if (e.target.checked && queue[currentIndex]) {
            applyEqPreset(detectEqPresetForTrack(queue[currentIndex]), false);
        }
    };
    document.getElementById('speedRateSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setPlaybackRate(e.target.value, true);
    };
    document.getElementById('reverbMixSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setReverbMix(e.target.value, true);
    };
    document.getElementById('masterGainSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setMasterGain(e.target.value, true);
    };
    document.getElementById('stereoPanSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setStereoPan(e.target.value, true);
    };
    document.getElementById('compressorToggle').onchange = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setCompressorEnabled(e.target.checked, true);
    };
    document.getElementById('compressorThresholdSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setCompressorParam('threshold', e.target.value, true);
    };
    document.getElementById('compressorRatioSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setCompressorParam('ratio', e.target.value, true);
    };
    document.getElementById('compressorAttackSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setCompressorParam('attack', e.target.value, true);
    };
    document.getElementById('compressorReleaseSlider').oninput = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setCompressorParam('release', e.target.value, true);
    };
    document.getElementById('preservePitchToggle').onchange = (e) => {
        localStorage.setItem('fluxo_dsp_profile', 'custom');
        setPitchPreserve(e.target.checked, true);
    };
    document.querySelectorAll('.dsp-profile-btn').forEach(btn => {
        btn.onclick = () => applyDspProfile(btn.dataset.profile);
    });
    document.getElementById('btnResetDsp').onclick = () => applyDspProfile('normal');
    updateDspUi();
};

document.getElementById('btnSpeedFx')?.addEventListener('click', () => {
    document.getElementById('btnEQ').click();
    setTimeout(() => document.getElementById('speedRateSlider')?.focus(), 50);
});

// ========================================================
// RADIOS, BIBLIOTECA E ARQUIVOS LOCAIS
// ========================================================
document.getElementById('btnRadio').onclick = () => {
    panelTitle.innerText = "FREQUÊNCIAS DE RÁDIO 24/7";
    resultsList.innerHTML = '';
    const radios = [
        { id: 'lofi hip hop radio study to live', name: 'Lo-Fi Girl', icon: 'ph-headphones', color: '#ff9900' },
        { id: 'synthwave radio live 24/7', name: 'Cyberpunk Radio', icon: 'ph-game-controller', color: '#ff00ff' },
        { id: 'phonk radio live 24/7', name: 'Phonk Drift Radio', icon: 'ph-car-profile', color: '#ff003c' }
    ];
    radios.forEach(radio => {
        const li = document.createElement('li'); li.className = "result-item";
        li.innerHTML = `<div class="result-thumb" style="color:${radio.color}; border-color:${radio.color}"><i class="ph ${radio.icon}"></i></div><div class="result-info"><span>${radio.name}</span></div><button class="btn-confirm">SINTONIZAR</button>`;
        li.onclick = async () => {
            const data = await searchAudioTracks(radio.id);
            if (data && data.tracks.length > 0) { 
                queue = [data.tracks[0]]; 
                originalQueue = [data.tracks[0]]; 
                loadAndPlayTrack(0); 
                document.getElementById('btnQueueView').click(); 
            }
        };
        resultsList.appendChild(li);
    });
};

function getUniquePlaylistTitle(title) {
    const base = String(title || 'Playlist importada').trim() || 'Playlist importada';
    const names = new Set(savedPlaylists.map(p => p.title));
    if (!names.has(base)) return base;

    let counter = 2;
    while (names.has(`${base} (${counter})`)) counter++;
    return `${base} (${counter})`;
}

function exportPlaylistsJson() {
    const payload = {
        app: 'Fluxo Music',
        exportedAt: new Date().toISOString(),
        playlists: savedPlaylists
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fluxo-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importPlaylistsJson(file) {
    const parsed = JSON.parse(await file.text());
    const playlists = Array.isArray(parsed) ? parsed : parsed.playlists;
    if (!Array.isArray(playlists)) throw new Error('Arquivo sem playlists.');

    const imported = playlists
        .map(pl => ({
            title: getUniquePlaylistTitle(pl.title || pl.name),
            cover: pl.cover || '',
            locked: Boolean(pl.locked),
            tracks: (Array.isArray(pl.tracks) ? pl.tracks : []).map(normalizeTrack).filter(Boolean)
        }));

    if (!imported.length) throw new Error('Nenhuma playlist valida encontrada.');

    savedPlaylists = [...savedPlaylists, ...imported];
    savePlaylists();
    return imported.length;
}

const FLUXO_LIBRARY_BACKUP_KEYS = [
    'fluxo_playlists', 'fluxo_playlist_trash', 'fluxo_favorites', 'fluxo_history',
    'fluxo_music_inbox', 'fluxo_track_comments', 'fluxo_track_analysis', 'fluxo_media_issues',
    'fluxo_achievements', 'fluxo_stats', 'fluxo_queue_tabs', 'fluxo_active_queue_tab',
    'fluxo_theme', 'fluxo_volume', 'fluxo_library_compact', 'fluxo_adaptive_preload',
    'fluxo_eq_preset', 'fluxo_eq_gains', 'fluxo_eq_auto', 'fluxo_dsp_profile',
    'fluxo_playback_rate', 'fluxo_reverb_mix', 'fluxo_preserve_pitch',
    'fluxo_master_gain', 'fluxo_stereo_pan', 'fluxo_compressor_enabled',
    'fluxo_compressor_threshold', 'fluxo_compressor_ratio', 'fluxo_compressor_attack',
    'fluxo_compressor_release', 'fluxo_hotkeys', 'fluxo_focus_mode',
    'fluxo_ambient_mode', 'fluxo_podcast_mode', 'fluxo_mini_variant'
];

function getFluxoLibraryBackupSnapshot() {
    return FLUXO_LIBRARY_BACKUP_KEYS.reduce((snapshot, key) => {
        const value = localStorage.getItem(key);
        if (value !== null) snapshot[key] = value;
        return snapshot;
    }, {});
}

function exportLibraryBackupJson() {
    const payload = {
        app: 'Fluxo Music',
        type: 'fluxo-library-backup',
        version: '1',
        exportedAt: new Date().toISOString(),
        summary: {
            playlists: savedPlaylists.length,
            favorites: favoriteTracks.length,
            history: playHistory.length,
            inbox: trackInbox.length
        },
        localStorage: getFluxoLibraryBackupSnapshot()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fluxo-backup-biblioteca-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reloadLibraryStateFromStorage() {
    playHistory = readStoredArray('fluxo_history').map(normalizeTrack).filter(Boolean);
    savedPlaylists = readStoredArray('fluxo_playlists').map(pl => ({
        title: pl.title || pl.name || 'Playlist',
        cover: pl.cover || '',
        locked: Boolean(pl.locked),
        tracks: (Array.isArray(pl.tracks) ? pl.tracks : []).map(normalizeTrack).filter(Boolean)
    }));
    playlistTrash = readStoredArray('fluxo_playlist_trash');
    favoriteTracks = readStoredArray('fluxo_favorites').map(normalizeTrack).filter(Boolean);
    queueTabs = readStoredArray('fluxo_queue_tabs');
    activeQueueTabId = localStorage.getItem('fluxo_active_queue_tab') || '';
    trackComments = readStoredObject('fluxo_track_comments');
    trackInbox = readStoredArray('fluxo_music_inbox').map(normalizeTrack).filter(Boolean);
    trackAnalysis = readStoredObject('fluxo_track_analysis');
    mediaIssues = readStoredArray('fluxo_media_issues');
    achievementState = readStoredObject('fluxo_achievements');
    fluxoStats = {
        tracksPlayed: 0,
        playlistsSaved: 0,
        sessionsCreated: 0,
        sessionsJoined: 0,
        sleepTimersUsed: 0,
        ...readStoredObject('fluxo_stats')
    };
    applyThemeClass(localStorage.getItem('fluxo_theme') || 'default');
    applySavedDspSettings?.();
    updateNowPlayingWidget();
}

async function restoreLibraryBackupJson(file) {
    const parsed = JSON.parse(await file.text());
    const snapshot = parsed?.localStorage || parsed?.storage || null;
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Arquivo nao parece ser backup completo do Fluxo.');

    const keys = Object.keys(snapshot).filter(key => FLUXO_LIBRARY_BACKUP_KEYS.includes(key));
    if (!keys.length) throw new Error('Backup sem dados restauraveis.');
    if (!confirm(`Restaurar ${keys.length} categorias do backup? Isso substitui biblioteca, historico, favoritos e perfil local.`)) {
        return { restored: 0, cancelled: true };
    }

    FLUXO_LIBRARY_BACKUP_KEYS.forEach(key => localStorage.removeItem(key));
    keys.forEach(key => {
        if (typeof snapshot[key] === 'string') localStorage.setItem(key, snapshot[key]);
    });
    reloadLibraryStateFromStorage();
    return { restored: keys.length, cancelled: false };
}

// BIBLIOTECA COM ROTAÇÃO DE CAPAS E PRÉVIA
document.getElementById('btnLibrary').onclick = () => {
    panelTitle.innerText = "DIRETÓRIO: BIBLIOTECA";
    resultsList.innerHTML = '';
    const toolsLi = document.createElement('li');
    toolsLi.style.padding = "14px 20px";
    toolsLi.style.display = "flex";
    toolsLi.style.flexWrap = "wrap";
    toolsLi.style.gap = "10px";
    toolsLi.style.justifyContent = "center";
    toolsLi.style.borderBottom = "var(--border-tech)";
    toolsLi.innerHTML = `
        <button class="btn-action" id="btnExportPlaylists"><i class="ph ph-download-simple"></i> EXPORTAR JSON</button>
        <button class="btn-confirm" id="btnImportPlaylists"><i class="ph ph-upload-simple"></i> IMPORTAR JSON</button>
        <button class="btn-action" id="btnExportLibraryBackup"><i class="ph ph-archive-box"></i> BACKUP COMPLETO</button>
        <button class="btn-confirm" id="btnRestoreLibraryBackup"><i class="ph ph-arrow-counter-clockwise"></i> RESTAURAR BACKUP</button>
        <button class="btn-action" id="btnLibraryCompactToggle"><i class="ph ph-list"></i> ${isLibraryCompact ? 'VISUAL NORMAL' : 'VISUAL COMPACTO'}</button>
        <button class="btn-action" id="btnLibraryDoctorInline"><i class="ph ph-stethoscope"></i> DIAGNOSTICO</button>
        <button class="btn-action" id="btnPlaylistTrash"><i class="ph ph-trash"></i> LIXEIRA (${playlistTrash.length})</button>
        <input type="file" id="playlistImportInput" accept="application/json,.json" style="display:none;">
        <input type="file" id="libraryBackupInput" accept="application/json,.json" style="display:none;">
        <span id="playlistImportStatus" style="color:var(--text-muted); align-self:center;"></span>
    `;
    resultsList.appendChild(toolsLi);

    document.getElementById('btnExportPlaylists').onclick = exportPlaylistsJson;
    document.getElementById('btnImportPlaylists').onclick = () => document.getElementById('playlistImportInput').click();
    document.getElementById('btnExportLibraryBackup').onclick = exportLibraryBackupJson;
    document.getElementById('btnRestoreLibraryBackup').onclick = () => document.getElementById('libraryBackupInput').click();
    document.getElementById('btnPlaylistTrash').onclick = renderPlaylistTrashPanel;
    document.getElementById('btnLibraryDoctorInline').onclick = renderLibraryDoctorPanel;
    document.getElementById('btnLibraryCompactToggle').onclick = () => {
        isLibraryCompact = !isLibraryCompact;
        localStorage.setItem('fluxo_library_compact', String(isLibraryCompact));
        document.getElementById('btnLibrary').click();
    };
    document.getElementById('playlistImportInput').onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const status = document.getElementById('playlistImportStatus');
        try {
            const count = await importPlaylistsJson(file);
            status.innerText = `${count} playlist(s) importada(s).`;
            document.getElementById('btnLibrary').click();
        } catch (error) {
            status.innerText = error.message || 'Falha ao importar.';
            status.style.color = 'var(--neon-pink)';
        }
    };
    document.getElementById('libraryBackupInput').onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const status = document.getElementById('playlistImportStatus');
        try {
            const result = await restoreLibraryBackupJson(file);
            status.innerText = result.cancelled ? 'Restauracao cancelada.' : `Backup restaurado (${result.restored} categorias).`;
            if (!result.cancelled) document.getElementById('btnLibrary').click();
        } catch (error) {
            status.innerText = error.message || 'Falha ao restaurar backup.';
            status.style.color = 'var(--neon-pink)';
        }
    };

    if (savedPlaylists.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.style.cssText = "padding: 20px; text-align: center;";
        emptyLi.innerText = "Vazio. Importe um JSON ou salve a fila como playlist.";
        resultsList.appendChild(emptyLi);
        return;
    }
    
    savedPlaylists.forEach((pl, i) => {
        const li = document.createElement('li'); li.className = `result-item ${isLibraryCompact ? 'library-compact-item' : ''}`;
        
        const firstCover = pl.cover || (pl.tracks.length > 0 ? pl.tracks[0].thumbnail : '');
        const bgStyle = firstCover ? `background-image:url('${firstCover}'); background-size: cover;` : '';
        
        li.innerHTML = `
            <div class="result-thumb" style="${bgStyle}; transition: 0.3s;">
                ${firstCover ? '' : '<i class="ph ph-folder-music"></i>'}
            </div>
            <div class="result-info"><span>${escapeHtml(pl.title)} ${pl.locked ? '<i class="ph ph-lock-key"></i>' : ''}</span><br><small>${pl.tracks.length} faixas</small></div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-action btn-cover-pl" title="Capa customizada"><i class="ph ph-image"></i></button>
                <button class="btn-action btn-lock-pl" title="${pl.locked ? 'Desbloquear' : 'Bloquear'} playlist"><i class="ph ${pl.locked ? 'ph-lock-key-open' : 'ph-lock-key'}"></i></button>
                <button class="btn-action btn-preview-pl" title="Ver Músicas"><i class="ph ph-eye"></i></button>
                <button class="btn-abort btn-delete-pl" title="Excluir Playlist"><i class="ph ph-x"></i></button>
                <input type="file" class="playlist-cover-input" accept="image/*" style="display:none;">
            </div>
        `;

        const thumb = li.querySelector('.result-thumb');
        let hoverInterval;
        let coverIndex = 0;

        thumb.onmouseenter = () => {
            if(pl.tracks.length > 1) {
                hoverInterval = setInterval(() => {
                    coverIndex = (coverIndex + 1) % pl.tracks.length;
                    thumb.style.backgroundImage = `url('${pl.tracks[coverIndex].thumbnail}')`;
                    thumb.innerHTML = ''; 
                }, 800); 
            }
        };

        thumb.onmouseleave = () => {
            clearInterval(hoverInterval);
            coverIndex = 0;
            if(firstCover) {
                thumb.style.backgroundImage = `url('${firstCover}')`;
            }
        };

        // BOTÃO EXCLUIR PLAYLIST
        li.querySelector('.btn-delete-pl').onclick = (e) => { 
            e.stopPropagation(); 
            if (pl.locked) {
                alert('Playlist bloqueada. Desbloqueie antes de mover para a lixeira.');
                return;
            }
            playlistTrash.unshift({ ...pl, deletedAt: Date.now() });
            savedPlaylists.splice(i, 1); 
            savePlaylists();
            savePlaylistTrash();
            document.getElementById('btnLibrary').click(); 
        };

        li.querySelector('.btn-lock-pl').onclick = (e) => {
            e.stopPropagation();
            savedPlaylists[i].locked = !savedPlaylists[i].locked;
            savePlaylists();
            document.getElementById('btnLibrary').click();
        };

        li.querySelector('.btn-cover-pl').onclick = (e) => {
            e.stopPropagation();
            li.querySelector('.playlist-cover-input').click();
        };

        li.querySelector('.playlist-cover-input').onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                savedPlaylists[i].cover = reader.result;
                savePlaylists();
                document.getElementById('btnLibrary').click();
            };
            reader.readAsDataURL(file);
        };

        // BOTÃO PRÉVIA (NOVO!)
        li.querySelector('.btn-preview-pl').onclick = (e) => {
            e.stopPropagation();
            renderPlaylistPreview(pl);
        };

        // CLICAR NO TEXTO TOCA A PLAYLIST
        li.onclick = () => { 
            queue = [...pl.tracks]; 
            originalQueue = [...pl.tracks];
            loadAndPlayTrack(0); 
            document.getElementById('btnQueueView').click(); 
        };
        resultsList.appendChild(li);
    });
};

// NOVA FUNÇÃO: EXIBE AS MÚSICAS DA PLAYLIST COM OPÇÃO DE DOWNLOAD TOTAL E LIMPEZA
function renderPlaylistPreview(playlist) {
    warmTrackStreams(playlist?.tracks || [], isVideoMode ? 'video' : 'audio', 3);
    panelTitle.innerText = `PLAYLIST: ${playlist.title.toUpperCase()}`;
    resultsList.innerHTML = `
        <li style="padding: 15px 20px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; border-bottom: var(--border-tech); background: rgba(0,0,0,0.1);">
            <button class="btn-action" id="btnBackLibrary"><i class="ph ph-arrow-left"></i> VOLTAR</button>
            <button class="btn-confirm" id="btnPlayPreview"><i class="ph ph-play"></i> TOCAR TUDO</button>
            <button class="btn-action" id="btnDownloadPlaylist" style="color: var(--neon-cyan); border-color: var(--neon-cyan);"><i class="ph ph-download-simple"></i> BAIXAR TUDO</button>
            <button class="btn-action" id="btnTogglePlaylistLock"><i class="ph ${playlist.locked ? 'ph-lock-key-open' : 'ph-lock-key'}"></i> ${playlist.locked ? 'DESBLOQUEAR' : 'BLOQUEAR'}</button>
            <button class="btn-abort" id="btnClearPlaylist"><i class="ph ph-trash"></i> LIMPAR</button>
        </li>
    `;
    
    document.getElementById('btnBackLibrary').onclick = () => document.getElementById('btnLibrary').click();
    document.getElementById('btnTogglePlaylistLock').onclick = () => {
        playlist.locked = !playlist.locked;
        const index = savedPlaylists.findIndex(p => p.title === playlist.title);
        if (index !== -1) {
            savedPlaylists[index].locked = playlist.locked;
            savePlaylists();
        }
        renderPlaylistPreview(playlist);
    };
    
    document.getElementById('btnPlayPreview').onclick = () => {
        if (playlist.tracks.length === 0) return;
        queue = [...playlist.tracks]; originalQueue = [...playlist.tracks];
        loadAndPlayTrack(0); document.getElementById('btnQueueView').click();
    };

    // 1. NOVO: BOTÃO DE BAIXAR PLAYLIST INTEIRA
    document.getElementById('btnDownloadPlaylist').onclick = async (e) => {
        if (playlist.tracks.length === 0) return;
        const btn = e.currentTarget;
        const origText = btn.innerHTML;
        
        btn.innerHTML = "<i class='ph ph-spinner-gap ph-spin'></i> A INICIAR...";
        btn.style.pointerEvents = 'none'; // Impede duplo clique
        let successCount = 0;
        
        // Faz o download um por um para evitar bloqueio (Ban) do YouTube
        for (let i = 0; i < playlist.tracks.length; i++) {
            const t = playlist.tracks[i];
            btn.innerHTML = `<i class='ph ph-spinner-gap ph-spin'></i> A BAIXAR (${i + 1}/${playlist.tracks.length})...`;
            try {
                const res = await downloadTrack(t, playlist.title);
                if (res.success) successCount++;
            } catch (err) {
                console.log(`Erro ao baixar ${t.title}`);
            }
        }
        
        btn.innerHTML = `<i class='ph ph-check-circle'></i> ${successCount} CONCLUÍDOS`;
        setTimeout(() => { 
            btn.innerHTML = origText; 
            btn.style.pointerEvents = 'auto'; 
        }, 4000);
    };

    // 2. NOVO: BOTÃO DE LIMPAR PLAYLIST
    document.getElementById('btnClearPlaylist').onclick = () => {
        if (playlist.locked) {
            alert('Playlist bloqueada. Desbloqueie antes de limpar.');
            return;
        }
        if (confirm(`Tens a certeza que queres apagar todas as ${playlist.tracks.length} músicas desta playlist?`)) {
            playlist.tracks = []; // Esvazia o array local
            
            // Procura a playlist na base de dados guardada e atualiza
            const index = savedPlaylists.findIndex(p => p.title === playlist.title);
            if(index !== -1) {
                savedPlaylists[index].tracks = [];
                savePlaylists();
            }
            renderPlaylistPreview(playlist); // Recarrega o ecrã vazio
        }
    };

    // Renderização das faixas
    if (playlist.tracks.length === 0) {
        const emptyPlaylist = document.createElement('li');
        emptyPlaylist.style.cssText = 'padding: 40px; text-align: center; color: var(--text-muted);';
        emptyPlaylist.innerText = 'Esta playlist esta vazia.';
        resultsList.appendChild(emptyPlaylist);
        return;
    }

    playlist.tracks.forEach((t, i) => {
        const item = document.createElement('li'); item.className = 'result-item';
        item.innerHTML = `
            <div style="width:30px; color:var(--text-muted); font-weight:bold;">${i+1}.</div>
            <div class="result-thumb" style="background-image:url('${t.thumbnail}'); width: 40px; height: 40px; margin-right: 15px; border-radius: var(--item-radius);"></div>
            <div class="result-info">
                <span class="result-title">${t.title}</span><br>
                <span class="result-artist" style="font-size:0.8rem; color:var(--text-muted);">${t.artist}</span>
            </div>
            ${getFavoriteButtonHtml(t)}
            <button class="btn-action btn-play-next-single" title="Tocar a seguir" style="padding: 8px 15px;"><i class="ph ph-arrow-bend-down-right"></i></button>
            <button class="btn-confirm btn-add-single" title="Adicionar apenas esta à Fila" style="padding: 8px 15px;"><i class="ph ph-plus"></i> ADD</button>
            <button class="btn-abort btn-remove-single" title="Remover da Playlist" style="padding: 8px 15px; margin-left: 5px;"><i class="ph ph-trash"></i></button>
        `;
        bindFavoriteButton(item, t);
        
        // Adicionar uma música à fila
        item.querySelector('.btn-add-single').onclick = (e) => {
            e.stopPropagation();
            queue.push(t); originalQueue.push(t);
            if(queue.length === 1) loadAndPlayTrack(0);
            
            const btn = e.currentTarget; const oldHtml = btn.innerHTML;
            btn.innerHTML = "<i class='ph ph-check'></i>";
            setTimeout(() => btn.innerHTML = oldHtml, 1000);
        };

        item.querySelector('.btn-play-next-single').onclick = (e) => {
            e.stopPropagation();
            enqueueTrack(t, 'next');
            const btn = e.currentTarget; const oldHtml = btn.innerHTML;
            btn.innerHTML = "<i class='ph ph-check'></i>";
            setTimeout(() => btn.innerHTML = oldHtml, 1000);
        };

        // 3. BÓNUS: Remover música individual da playlist
        item.querySelector('.btn-remove-single').onclick = (e) => {
            e.stopPropagation();
            if (playlist.locked) {
                alert('Playlist bloqueada. Desbloqueie antes de remover musicas.');
                return;
            }
            playlist.tracks.splice(i, 1);
            const index = savedPlaylists.findIndex(p => p.title === playlist.title);
            if(index !== -1) {
                savedPlaylists[index].tracks = playlist.tracks;
                savePlaylists();
            }
            renderPlaylistPreview(playlist);
        };
        
        item.onclick = () => { queue = [t]; originalQueue = [t]; loadAndPlayTrack(0); document.getElementById('btnQueueView').click(); };
        resultsList.appendChild(item);
    });
}
// ========================================================
// SLEEP TIMER E FILA
// ========================================================
let sleepId = null;
let sleepTimerState = null;
let sleepFadeStarted = false;

function cancelSleepTimer(render = true) {
    if (sleepId) clearTimeout(sleepId);
    sleepId = null;
    sleepTimerState = null;
    sleepFadeStarted = false;
    audioPlayer.volume = getTargetVolume();
    if (render) renderSleepTimerPanel();
}

function getSleepTimerRemainingMs() {
    if (!sleepTimerState?.deadlineAt) return 0;
    return Math.max(0, sleepTimerState.deadlineAt - Date.now());
}

async function finishSleepTimer() {
    if (!sleepTimerState) return;
    const action = sleepTimerState.action || 'pause';
    const fadeSeconds = Number(sleepTimerState.fadeSeconds || 0);
    if (fadeSeconds > 0 && !audioPlayer.paused) {
        await fadeMainVolume(0, Math.min(12000, fadeSeconds * 1000)).catch(() => {});
    }
    if (action === 'close') {
        audioPlayer.pause();
        window.electronAPI?.closeWindow?.();
    } else {
        audioPlayer.pause();
    }
    cancelSleepTimer(false);
    updateDiscordNowPlaying('paused');
}

function armSleepTimer({ mode = 'minutes', minutes = 30, action = 'pause', fadeSeconds = 10 } = {}) {
    cancelSleepTimer(false);
    sleepTimerState = {
        mode,
        action,
        fadeSeconds: Math.max(0, Number(fadeSeconds) || 0),
        minutes: Math.max(1, Number(minutes) || 30),
        startedAt: Date.now(),
        deadlineAt: mode === 'minutes' ? Date.now() + Math.max(1, Number(minutes) || 30) * 60000 : 0
    };
    if (sleepTimerState.mode === 'minutes') {
        sleepId = setTimeout(() => finishSleepTimer(), getSleepTimerRemainingMs());
    }
    updateAchievementProgress('sleepTimer');
    renderSleepTimerPanel();
}

function updateSleepTimerCountdownUi() {
    const label = document.getElementById('sleepTimerStatus');
    if (!label || !sleepTimerState) return;
    if (sleepTimerState.mode === 'afterTrack') {
        const remaining = Math.max(0, (audioPlayer.duration || 0) - (audioPlayer.currentTime || 0));
        label.innerText = `Para depois da faixa atual - faltam ${formatTime(remaining)}`;
        return;
    }
    label.innerText = `Ativo - faltam ${formatTime(getSleepTimerRemainingMs() / 1000)}`;
}

function handleSleepTimerFade() {
    if (!sleepTimerState || sleepFadeStarted || audioPlayer.paused) return;
    const fadeSeconds = Number(sleepTimerState.fadeSeconds || 0);
    if (fadeSeconds <= 0) return;
    if (sleepTimerState.mode === 'afterTrack') {
        const remaining = (audioPlayer.duration || 0) - (audioPlayer.currentTime || 0);
        if (remaining > 0 && remaining <= fadeSeconds) {
            sleepFadeStarted = true;
            fadeMainVolume(0, Math.min(12000, fadeSeconds * 1000)).catch(() => {});
        }
    } else if (getSleepTimerRemainingMs() <= fadeSeconds * 1000) {
        sleepFadeStarted = true;
        fadeMainVolume(0, Math.min(12000, fadeSeconds * 1000)).catch(() => {});
    }
}

function renderSleepTimerPanel() {
    panelTitle.innerText = "SLEEP TIMER";
    queueCounter.innerText = sleepTimerState ? 'ativo' : 'off';
    const activeText = sleepTimerState
        ? (sleepTimerState.mode === 'afterTrack' ? 'Parar depois da faixa atual' : `Parar em ${sleepTimerState.minutes} min`)
        : 'Nenhum timer ativo.';
    resultsList.innerHTML = `
        <li class="sleep-shell">
            <section class="sleep-hero">
                <div>
                    <span class="changelog-kicker">Descanso sem susto</span>
                    <h3>${escapeHtml(activeText)}</h3>
                    <p id="sleepTimerStatus">${sleepTimerState ? 'Calculando...' : 'Escolha uma acao para o Fluxo fazer sozinho.'}</p>
                </div>
                <button class="btn-abort" id="btnCancelSleepTimer" ${sleepTimerState ? '' : 'disabled'}><i class="ph ph-x-circle"></i> CANCELAR</button>
            </section>
            <section class="sleep-grid">
                <article class="sleep-card">
                    <i class="ph ph-timer"></i>
                    <strong>Por tempo</strong>
                    <div class="lab-inline">
                        <input type="number" id="sleepMinutes" class="inline-input" min="1" value="${sleepTimerState?.minutes || 30}">
                        <span>min</span>
                    </div>
                    <button class="btn-confirm" id="btnSleepMinutes"><i class="ph ph-play"></i> ATIVAR</button>
                </article>
                <article class="sleep-card">
                    <i class="ph ph-music-note-simple"></i>
                    <strong>Depois dessa</strong>
                    <p>Termina a faixa atual e pausa antes de puxar a proxima.</p>
                    <button class="btn-action" id="btnSleepAfterTrack"><i class="ph ph-skip-forward"></i> PARAR DEPOIS</button>
                </article>
                <article class="sleep-card">
                    <i class="ph ph-power"></i>
                    <strong>Fechar app</strong>
                    <p>Usa o mesmo tempo escolhido e fecha o Fluxo no fim.</p>
                    <button class="btn-abort" id="btnSleepClose"><i class="ph ph-power"></i> FECHAR EM</button>
                </article>
            </section>
            <section class="sleep-options">
                <label class="mp-switch"><input type="checkbox" id="sleepFadeEnabled" checked><span><strong>Fade out suave</strong><small>Baixa o volume antes de pausar ou fechar.</small></span></label>
                <div class="lab-inline">
                    <span>Fade</span>
                    <input type="number" id="sleepFadeSeconds" class="inline-input" min="0" max="60" value="${sleepTimerState?.fadeSeconds ?? 10}">
                    <span>seg</span>
                </div>
            </section>
        </li>
    `;
    updateSleepTimerCountdownUi();
    const getFadeSeconds = () => document.getElementById('sleepFadeEnabled')?.checked ? Number(document.getElementById('sleepFadeSeconds')?.value || 10) : 0;
    document.getElementById('btnCancelSleepTimer').onclick = () => cancelSleepTimer(true);
    document.getElementById('btnSleepMinutes').onclick = () => armSleepTimer({ mode: 'minutes', minutes: document.getElementById('sleepMinutes').value, action: 'pause', fadeSeconds: getFadeSeconds() });
    document.getElementById('btnSleepAfterTrack').onclick = () => armSleepTimer({ mode: 'afterTrack', action: 'pause', fadeSeconds: getFadeSeconds() });
    document.getElementById('btnSleepClose').onclick = () => armSleepTimer({ mode: 'minutes', minutes: document.getElementById('sleepMinutes').value, action: 'close', fadeSeconds: getFadeSeconds() });
}

document.getElementById('btnTimer').onclick = renderSleepTimerPanel;

document.getElementById('btnQueueView').onclick = () => {
    panelTitle.innerText = "FILA DE REPRODUÇÃO";
    document.getElementById('btnClearQueue').style.display = 'block'; // MOSTRA O BOTÃO
    resultsList.innerHTML = '';
    const tabLi = document.createElement('li');
    tabLi.className = 'fluxo-tools-row';
    tabLi.innerHTML = `
        <input id="quickQueueTabName" class="inline-input" placeholder="Nome da aba de fila" value="${escapeHtml(queueTabs.find(tab => tab.id === activeQueueTabId)?.title || '')}">
        <button class="btn-action" id="btnQuickSaveQueueTab"><i class="ph ph-floppy-disk"></i> SALVAR ABA</button>
        <select id="quickQueueTabSelect" class="inline-input">${queueTabs.map(tab => `<option value="${tab.id}" ${tab.id === activeQueueTabId ? 'selected' : ''}>${escapeHtml(tab.title)}</option>`).join('') || '<option value="">Sem abas</option>'}</select>
        <button class="btn-confirm" id="btnQuickLoadQueueTab">CARREGAR</button>
    `;
    resultsList.appendChild(tabLi);
    document.getElementById('btnQuickSaveQueueTab').onclick = () => {
        saveCurrentQueueTab(document.getElementById('quickQueueTabName').value);
        document.getElementById('btnQueueView').click();
    };
    document.getElementById('btnQuickLoadQueueTab').onclick = () => loadQueueTab(document.getElementById('quickQueueTabSelect').value);
    
    if (queue.length > 0) {
        const saveLi = document.createElement('li');
        saveLi.style.padding = "10px 20px"; saveLi.style.justifyContent = "center"; saveLi.style.borderBottom = "var(--border-tech)";
        saveLi.innerHTML = `<button class="btn-save" style="width:100%;"><i class="ph ph-floppy-disk"></i> SALVAR FILA COMO PLAYLIST</button>`;
        saveLi.querySelector('button').onclick = () => {
            saveLi.innerHTML = `
                <div style="display:flex; gap:10px; width:100%;">
                    <input type="text" id="newPlName" class="inline-input" style="flex:1;" placeholder="Nome da Playlist..." autofocus>
                    <button class="btn-confirm" id="btnConfirmSavePl">SALVAR</button>
                    <button class="btn-abort" id="btnCancelSavePl">X</button>
                </div>
            `;
            document.getElementById('btnConfirmSavePl').onclick = () => {
                const plName = document.getElementById('newPlName').value.trim() || "Minha Playlist";
                savedPlaylists.push({ title: plName, cover: '', locked: false, tracks: [...originalQueue] });
                savePlaylists();
                updateAchievementProgress('playlistSaved');
                document.getElementById('btnQueueView').click(); 
            };
            document.getElementById('btnCancelSavePl').onclick = () => document.getElementById('btnQueueView').click(); 
        };
        resultsList.appendChild(saveLi);
    } else {
        const emptyQueue = document.createElement('li');
        emptyQueue.style.cssText = 'padding: 20px; text-align: center;';
        emptyQueue.innerText = 'Fila de comando vazia.';
        resultsList.appendChild(emptyQueue);
        return;
    }

    let dragStartIndex = -1;

    queue.forEach((t, i) => {
        const li = document.createElement('li'); 
        li.className = 'result-item draggable'; 
        li.setAttribute('draggable', 'true');
        
        li.innerHTML = `
            <div class="drag-handle" title="Segure para arrastar"><i class="ph ph-dots-six-vertical"></i></div>
            <div style="width:30px; margin-left: 5px;">${i+1}.</div>
            <div class="result-info"><span style="color: ${i === currentIndex ? 'var(--neon-cyan)' : 'inherit'}">${t.title}</span></div>
            ${getFavoriteButtonHtml(t)}
            <button class="btn-action btn-radio-seed" title="Criar radio desta musica"><i class="ph ph-broadcast"></i></button>
            <button class="btn-abort">X</button>
        `;
        bindFavoriteButton(li, t);
        
        // EVENTOS DE DRAG & DROP
        li.addEventListener('dragstart', (e) => { dragStartIndex = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        li.addEventListener('dragend', () => { li.classList.remove('dragging'); document.querySelectorAll('.result-item').forEach(el => el.classList.remove('drag-over')); });
        li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
        li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
        li.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragEndIndex = i;
            if (dragStartIndex !== -1 && dragStartIndex !== dragEndIndex) {
                // Reordena a fila
                const movedItem = queue.splice(dragStartIndex, 1)[0];
                queue.splice(dragEndIndex, 0, movedItem);
                
                const movedOrigItem = originalQueue.splice(dragStartIndex, 1)[0];
                originalQueue.splice(dragEndIndex, 0, movedOrigItem);

                // Corrige o índice da música que está tocando
                if (currentIndex === dragStartIndex) currentIndex = dragEndIndex;
                else if (dragStartIndex < currentIndex && dragEndIndex >= currentIndex) currentIndex--;
                else if (dragStartIndex > currentIndex && dragEndIndex <= currentIndex) currentIndex++;
                
                publishRoomState();
                document.getElementById('btnQueueView').click(); 
            }
        });

        li.querySelector('.btn-radio-seed').onclick = async (e) => {
            e.stopPropagation();
            await startRadioFromTrack(t);
        };

        li.querySelector('.btn-abort').onclick = (e) => { 
            e.stopPropagation(); 
            if (i < currentIndex) currentIndex--; 
            queue.splice(i, 1); 
            const origIdx = originalQueue.findIndex(track => track.id === t.id);
            if(origIdx !== -1) originalQueue.splice(origIdx, 1);
            publishRoomState();
            document.getElementById('btnQueueView').click(); 
        };
        
        li.onclick = (e) => { if(!e.target.closest('.drag-handle')) loadAndPlayTrack(i); };
        resultsList.appendChild(li);
    });
};
// ========================================================
// MINI PLAYER E FIXAÇÃO
// ========================================================
document.getElementById('btnMiniPlayer').onclick = () => { 
    toggleMiniPlayerMode();
};
document.getElementById('btnExitMini').onclick = () => { 
    exitMiniPlayer();
};

let isPinned = false;
document.getElementById('btnPinMini').addEventListener('click', () => {
    isPinned = !isPinned;
    const pinBtn = document.getElementById('btnPinMini');
    pinBtn.innerHTML = isPinned ? '<i class="ph ph-push-pin-slash"></i>' : '<i class="ph ph-push-pin"></i>';
    pinBtn.style.color = isPinned ? 'var(--neon-pink)' : 'var(--neon-cyan)';
    window.electronAPI.toggleAlwaysOnTop(isPinned); 
});

function handleRemoteControlAction(message = {}) {
    const action = String(message.action || '').toLowerCase();
    const payload = message.payload || {};
    const volumeSlider = document.getElementById('volumeSlider');

    if (action === 'play-pause') playPauseBtn.click();
    else if (action === 'next') document.getElementById('nextBtn')?.click();
    else if (action === 'prev') document.getElementById('prevBtn')?.click();
    else if (action === 'vol-up' && volumeSlider) volumeSlider.value = Math.min(1, Number(volumeSlider.value) + 0.08);
    else if (action === 'vol-down' && volumeSlider) volumeSlider.value = Math.max(0, Number(volumeSlider.value) - 0.08);
    else if (action === 'toggle-video') document.getElementById('btnToggleVideo')?.click();
    else if (action === 'fullscreen') document.getElementById('btnFullscreen')?.click();
    else if (action === 'party') document.getElementById('btnPartyMode')?.click();
    else if (action === 'mini') toggleMiniPlayerMode();
    else if (action === 'focus') document.body.classList.toggle('focus-mode');
    else if (action === 'ambient') setAmbientMode(!isAmbientMode);
    else if (action === 'search' && payload.q) {
        searchInput.value = payload.q;
        executeSearch();
    } else if (action === 'theme' && payload.id) {
        applyThemeClass(payload.id);
        localStorage.setItem('fluxo_theme', payload.id);
        updateNowPlayingWidget();
    }

    if ((action === 'vol-up' || action === 'vol-down') && volumeSlider) {
        volumeSlider.dispatchEvent(new Event('input'));
    }
}

window.electronAPI?.onRemoteControlAction?.((event, message) => handleRemoteControlAction(message));

// Inicialização Final
document.getElementById('btnQueueView').click();

// ========================================================
// RECEPTOR DO SISTEMA DE ATUALIZAÇÃO (AUTO-UPDATER)
// ========================================================
if (window.electronAPI && window.electronAPI.onUpdateMessage) {
    window.electronAPI.onUpdateMessage((event, message) => {
        document.getElementById('updateModal').style.display = 'flex';
        document.getElementById('updateStatus').innerText = message;
    });

    window.electronAPI.onUpdateProgress((event, percent) => {
        document.getElementById('updateProgressFill').style.width = percent + '%';
    });
}
document.getElementById('btnClearQueue').onclick = () => {
    if (queue.length === 0) return;

    // Acorda o Modal Personalizado em vez do alerta do Windows
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmModalMsg').innerText = "Deseja ejetar todos os dados da fila atual? Isso interromperá a reprodução de áudio.";
    modal.style.display = 'flex';

    // Se o usuário clicar em EJETAR:
    document.getElementById('btnConfirmOk').onclick = () => {
        modal.style.display = 'none'; // Esconde o modal
        
        // Esvazia as filas
        queue = [];
        originalQueue = [];
        currentIndex = 0;

        // Para o player
        audioPlayer.pause();
        audioPlayer.src = "";
        if (window.electronAPI?.clearDiscordPresence) window.electronAPI.clearDiscordPresence();
        
        // Reseta o visual do Deck
        titleEl.innerText = "SISTEMA RESETADO";
        artistEl.innerText = "Aguardando novo comando";
        if (coverEl) coverEl.style.backgroundImage = "";
        if (coverIcon) coverIcon.style.display = 'block';
        if (progressFill) progressFill.style.width = '0%';
        document.getElementById('currentTime').innerText = "0:00";
        document.getElementById('durationTime').innerText = "0:00";

        // Avisa a sala multiplayer se for o host
        publishRoomState({ track: null, state: 'paused', time: 0 });

        // Recarrega a aba (que agora vai estar vazia)
        document.getElementById('btnQueueView').click();
    };

    // Se o usuário clicar em CANCELAR:
    document.getElementById('btnConfirmCancel').onclick = () => {
        modal.style.display = 'none'; // Só esconde o modal e segue a vida
    };
};

// ========================================================
// VARIÁVEIS DE GESTÃO DO VÍDEO (Parei de rir do fullscreen kkk)
// ========================================================
const mainVideoPlayer = document.getElementById('mainVideoPlayer'); // O vídeo em si
const floatingVideoContainer = document.getElementById('videoContainer'); // A janela flutuante antiga
const npCover = document.getElementById('cover'); // O container do disco do deck
const coverIconEl = document.getElementById('coverIcon'); // O ícone Ph-Disc dentro do cover

// Função auxiliar para re-atachar o vídeo no container flutuante
function restoreFloatingVideo() {
    floatingVideoContainer.appendChild(mainVideoPlayer);
    // Re-mostra o ícone/capa no deck inferior
    if (coverIconEl) coverIconEl.style.display = 'block'; 
    npCover.classList.remove('video-active');
    mainVideoPlayer.classList.remove('fits-cover');
}

// ========================================================
// CONTROLES AVANÇADOS DE VÍDEO (FULLSCREEN CORRIGIDO)
// ========================================================

// 1. Fullscreen (VÍDEO APENAS, NÃO O APP KKK)
document.getElementById('btnFullscreen').onclick = async () => {
    try {
        if (!isVideoMode) {
            const previousVideoState = isVideoMode;
            setVideoUiState(true);
            const changed = await reloadCurrentPlaybackStream('video');
            if (!changed) {
                setVideoUiState(previousVideoState);
                return;
            } else if (currentRoom && isHost) {
                roomSettings = normalizeRoomSettings({ ...roomSettings, videoEnabled: true });
                publishRoomState({ settings: roomSettings });
            }
        }

        const fullscreenTarget = document.getElementById('mainVideoPlayer') || document.getElementById('videoContainer');
        if (!fullscreenTarget) return;

        if (!document.fullscreenElement) {
            await fullscreenTarget.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch (err) {
        console.log('Erro ao alternar tela cheia:', err);
    }
};

// ...btnPiP e btnMiniPlayer que você já tem continuam aqui...

// ========================================================
// MODO FESTA LÓGICA (SUBSTITUIÇÃO COMPLETA)
// ========================================================
document.getElementById('btnPartyMode').onclick = () => { 
    if(!canControl()) { alert("Anfitrião bloqueou os controlos."); return; }
    document.body.classList.add('party-mode'); 
    
    // SE O MODO VÍDEO ESTIVER ATIVO, TROCA O VINIL PELO VÍDEO NO CENTRO
    if (isVideoMode) {
        // Esconde o ícone do disco
        if(coverIconEl) coverIconEl.style.display = 'none';
        
        npCover.classList.add('video-active');
        
        // Arranca o vídeo do container flutuante e joga pro centro da festa (o npCover)
        npCover.appendChild(mainVideoPlayer);
        
        // Adiciona classe para o vídeo preencher o npCover
        mainVideoPlayer.classList.add('fits-cover');
        
        // Esconde o container flutuante antigo (que agora está vazio)
        floatingVideoContainer.classList.remove('active');
    }
};

document.getElementById('btnExitParty').onclick = () => { 
    document.body.classList.remove('party-mode'); 
    
    // SE O VÍDEO TAVA TOCANDO NA FESTA, JOGA ELE DE VOLTA PRO FLUTUANTE
    if (isVideoMode) {
        restoreFloatingVideo();
        // Mostra o container flutuante (active)
        floatingVideoContainer.classList.add('active');
    }
};

// ========================================================
// 4. GESTÃO DO TOGGLE DE VÍDEO (LIGAR/DESLIGAR VISUAL)
// ========================================================

// 1. Declarar a variável no escopo global (fora das funções)
let isVideoMode = false; 

const btnToggleVideo = document.getElementById('btnToggleVideo');
function setQualityValue(value, shouldDispatch = true) {
    const selector = document.getElementById('qualitySelector');
    if (!selector) return;

    selector.value = value;
    syncQualityMenuLabel();
    if (shouldDispatch) selector.dispatchEvent(new Event('change'));
}

function setVideoUiState(enabled) {
    isVideoMode = enabled;
    setVideoModeEnabled(enabled);

    if (btnToggleVideo) {
        btnToggleVideo.classList.toggle('active', enabled);
        btnToggleVideo.classList.toggle('active-pink', enabled);
        btnToggleVideo.style.color = enabled ? "var(--neon-pink)" : "";
    }

    if (enabled) {
        if (!document.body.classList.contains('party-mode') && !document.body.classList.contains('mini-mode')) {
            floatingVideoContainer.classList.add('active');
            if (!floatingVideoContainer.contains(mainVideoPlayer)) floatingVideoContainer.appendChild(mainVideoPlayer);
            mainVideoPlayer.classList.remove('fits-cover');
        } else {
            if (coverIconEl) coverIconEl.style.display = 'none';
            if (npCover) {
                npCover.classList.add('video-active');
                npCover.appendChild(mainVideoPlayer);
            }
            mainVideoPlayer.classList.add('fits-cover');
        }
    } else {
        floatingVideoContainer.classList.remove('active');
        if (document.body.classList.contains('party-mode')) {
            restoreFloatingVideo();
        }
    }
}

async function reloadCurrentPlaybackStream(mode = (isVideoMode ? 'video' : 'audio')) {
    if (!queue || !queue[currentIndex]) return false;

    const track = normalizeTrack(queue[currentIndex]);
    const trackId = getTrackStreamId(track);
    if (!trackId) return false;

    const currentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    const wasPaused = audioPlayer.paused;
    const previousSrc = audioPlayer.src;

    try {
        if (titleEl) titleEl.innerText = mode === 'video' ? 'CARREGANDO VIDEO...' : 'CARREGANDO AUDIO...';
        const resolvedStream = await resolvePlayableStreamForTrack(track, mode);
        const streamUrl = resolvedStream.url;

        if (mode !== 'audio' && resolvedStream.mode === 'audio') {
            setVideoUiState(false);
            if (currentRoom && isHost && roomSettings.videoEnabled) {
                roomSettings = normalizeRoomSettings({ ...roomSettings, videoEnabled: false });
                publishRoomState({ settings: roomSettings });
            }
        }

        audioPlayer.pause();
        setMediaElementSource(audioPlayer, streamUrl, 'main');
        await waitForMediaMetadata(audioPlayer);

        if (Number.isFinite(audioPlayer.duration) && audioPlayer.duration > currentTime + 1) {
            audioPlayer.currentTime = currentTime;
        }

        if (!wasPaused) {
            await audioPlayer.play().catch(err => console.log('Erro ao retomar playback:', err));
        }

        if (titleEl) titleEl.innerText = track.title;
        return true;
    } catch (err) {
        console.error('Erro ao alternar audio/video:', err);
        recordMediaIssue(track, classifyMediaError(err, mode === 'video' ? 'Falha ao carregar video dessa faixa.' : 'Falha ao carregar audio dessa faixa.'), mode, err);
        if (previousSrc && audioPlayer.src !== previousSrc) {
            audioPlayer.src = previousSrc;
            audioPlayer.load();
            if (!wasPaused) audioPlayer.play().catch(playErr => console.log('Erro ao restaurar playback:', playErr));
        }
        if (titleEl) {
            titleEl.innerText = mode === 'video' ? 'ERRO AO CARREGAR VIDEO' : 'ERRO AO CARREGAR AUDIO';
            setTimeout(() => {
                if (queue[currentIndex]) titleEl.innerText = normalizeTrack(queue[currentIndex]).title;
            }, 1800);
        }
        return false;
    }
}

if (btnToggleVideo) {
    btnToggleVideo.onclick = async () => {
        if(currentRoom && !isHost) return;
        const previousVideoState = isVideoMode;
        const nextVideoState = !previousVideoState;
        setVideoUiState(nextVideoState);
        const changed = await reloadCurrentPlaybackStream(nextVideoState ? 'video' : 'audio');
        if (!changed) {
            setVideoUiState(previousVideoState);
        } else if (currentRoom && isHost) {
            roomSettings = normalizeRoomSettings({ ...roomSettings, videoEnabled: Boolean(isVideoMode) });
            publishRoomState({ settings: roomSettings });
        }
        return;

        // 2. Usar a variável normalmente
        isVideoMode = !isVideoMode; 
        const btn = e.currentTarget;

        // Se for no modo mini, o vídeo já está a rodar, ignora a janela flutuante
        setVideoModeEnabled(isVideoMode);

        // Ativa o visual do botão (Liga o Neon Rosa)
        btn.classList.toggle('active', isVideoMode);
        btn.classList.toggle('active-pink', isVideoMode);
        btn.style.color = isVideoMode ? "var(--neon-pink)" : "";

        if (isVideoMode) {
            const qSelector = document.getElementById('qualitySelector');
            if(qSelector) {
                qSelector.style.display = 'inline-block';
                if(qSelector.value === 'audio') {
                    qSelector.value = '720p';
                    qSelector.dispatchEvent(new Event('change')); // Força o recarregamento em 720p
                }
            }

            // Se NÃO estiver no Modo Festa, mostra a janela flutuante normal
            if (!document.body.classList.contains('party-mode') && !document.body.classList.contains('mini-mode')) {
                floatingVideoContainer.classList.add('active');
            } else {
                // Se já estiver no modo festa e ligares o vídeo, ele engole o disco
                if (typeof coverIconEl !== 'undefined' && coverIconEl) coverIconEl.style.display = 'none';
                if (typeof npCover !== 'undefined' && npCover) {
                    npCover.classList.add('video-active');
                    npCover.appendChild(mainVideoPlayer);
                }
                mainVideoPlayer.classList.add('fits-cover');
            }
        } else {
            const qSelector = document.getElementById('qualitySelector');
            if(qSelector) {
                qSelector.style.display = 'none';
                if(qSelector.value !== 'audio') {
                    qSelector.value = 'audio';
                    qSelector.dispatchEvent(new Event('change')); // Força voltar pro áudio
                }
            }

            floatingVideoContainer.classList.remove('active');
            if (document.body.classList.contains('party-mode')) {
                if (typeof restoreFloatingVideo === 'function') restoreFloatingVideo(); 
            }
        }
    };
}

// ========================================================
// MODO FLUTUANTE (PICTURE-IN-PICTURE) - RECUPERADO
// ========================================================
const btnPiP = document.getElementById('btnPiP');
if (btnPiP) {
    btnPiP.onclick = async () => {
        try {
            if (document.pictureInPictureElement) {
                // Se já estiver no modo flutuante, ele volta pro app
                await document.exitPictureInPicture();
            } else {
                // Tenta puxar o vídeo para a janela flutuante
                if (audioPlayer.readyState >= 2) {
                    await audioPlayer.requestPictureInPicture();
                } else {
                    alert("Aguarde a mídia carregar completamente para usar o PiP.");
                }
            }
        } catch (error) {
            console.error("Erro ao abrir PiP:", error);
            alert("Falha no PiP. Certifique-se de que a música está tocando e tem vídeo.");
        }
    };
}
// ========================================================
// SISTEMA DE ATALHOS (HOTKEYS) LOCAIS E GLOBAIS
// ========================================================

// Carrega os atalhos salvos ou define os padrões que você pediu
let currentHotkeys = JSON.parse(localStorage.getItem('fluxo_hotkeys')) || {
    playPause: 'Space',
    volUp: 'Up',
    volDown: 'Down',
    nextTrack: 'Shift+Right',
    prevTrack: 'Shift+Left',
    globalEnabled: false
};

// Registra imediatamente ao abrir o app caso a opção global esteja ativa
if (window.electronAPI && window.electronAPI.registerGlobalShortcuts) {
    window.electronAPI.registerGlobalShortcuts(currentHotkeys);
}

// 1. Ouvinte para capturar os atalhos locais (Apenas quando o app está em foco)
document.addEventListener('keydown', (e) => {
    // Se estiver digitando em um input (chat, barra de busca), não ativa atalho de música!
    const activeTag = document.activeElement.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;

    // Converte a tecla pressionada no padrão do Electron (Ex: Shift+Right, Space)
    let keys = [];
    if (e.ctrlKey) keys.push('CommandOrControl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.startsWith('Arrow')) key = key.replace('Arrow', ''); // ArrowUp vira Up
    
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        keys.push(key.length === 1 ? key.toUpperCase() : key);
    }
    const pressedKeyStr = keys.join('+');

    // Executador de ações baseadas no atalho apertado
    if (pressedKeyStr === currentHotkeys.playPause) {
        e.preventDefault(); // Previne rolar a tela com Espaço
        if(playPauseBtn) playPauseBtn.click();
    } 
    else if (pressedKeyStr === currentHotkeys.volUp) {
        e.preventDefault(); // Previne rolar a tela com seta pra cima
        const novoVol = Math.min(1, parseFloat(volumeSlider.value) + 0.05);
        volumeSlider.value = novoVol;
        volumeSlider.dispatchEvent(new Event('input')); // Força o evento de atualizar o áudio e ícone
    } 
    else if (pressedKeyStr === currentHotkeys.volDown) {
        e.preventDefault();
        const novoVol = Math.max(0, parseFloat(volumeSlider.value) - 0.05);
        volumeSlider.value = novoVol;
        volumeSlider.dispatchEvent(new Event('input'));
    } 
    else if (pressedKeyStr === currentHotkeys.nextTrack) {
        e.preventDefault();
        document.getElementById('nextBtn').click();
    } 
    else if (pressedKeyStr === currentHotkeys.prevTrack) {
        e.preventDefault();
        document.getElementById('prevBtn').click();
    }
});

// 2. Ouvinte para atalhos em SEGUNDO PLANO (vindos do main.js)
if (window.electronAPI && window.electronAPI.onGlobalShortcutAction) {
    window.electronAPI.onGlobalShortcutAction((event, action) => {
        if (action === 'playPause') playPauseBtn.click();
        else if (action === 'volUp') {
            volumeSlider.value = Math.min(1, parseFloat(volumeSlider.value) + 0.05);
            volumeSlider.dispatchEvent(new Event('input'));
        }
        else if (action === 'volDown') {
            volumeSlider.value = Math.max(0, parseFloat(volumeSlider.value) - 0.05);
            volumeSlider.dispatchEvent(new Event('input'));
        }
        else if (action === 'nextTrack') document.getElementById('nextBtn').click();
        else if (action === 'prevTrack') document.getElementById('prevBtn').click();
    });
}

// 3. Renderização da Aba de Configurações de Atalhos
document.getElementById('btnHotkeys').addEventListener('click', () => {
    panelTitle.innerText = "CONFIGURAÇÃO DE ATALHOS (KEYBINDS)";
    
    // Função auxiliar para criar a UI de captura de tecla
    const createKeybindRow = (label, keyName) => `
        <li style="padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: var(--border-tech);">
            <span style="font-weight: bold; color: var(--text-main);">${label}</span>
            <button class="btn-action keybind-btn" data-key="${keyName}" style="min-width: 150px; justify-content: center; font-family: monospace; font-size: 1rem; color: var(--neon-cyan);">
                ${currentHotkeys[keyName]}
            </button>
        </li>
    `;

    resultsList.innerHTML = `
        <li style="padding: 20px; background: rgba(0,0,0,0.2); border-bottom: var(--border-tech);">
            <div style="display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--neon-pink); padding: 15px; border-radius: var(--item-radius);">
                <div>
                    <strong style="color: var(--neon-pink); font-size: 1.1rem;">Atalhos em Segundo Plano (Globais)</strong><br>
                    <small style="color: var(--text-muted);">Permite controlar o Fluxo Music mesmo minimizado ou a jogar.</small>
                </div>
                <label style="cursor: pointer; display: flex; align-items: center; gap: 10px; font-weight: bold; color: var(--neon-cyan);">
                    <input type="checkbox" id="cbGlobalHotkeys" ${currentHotkeys.globalEnabled ? 'checked' : ''} style="transform: scale(1.5);"> ATIVADO
                </label>
            </div>
        </li>
        ${createKeybindRow('Play / Pause', 'playPause')}
        ${createKeybindRow('Aumentar Volume', 'volUp')}
        ${createKeybindRow('Abaixar Volume', 'volDown')}
        ${createKeybindRow('Próxima Música', 'nextTrack')}
        ${createKeybindRow('Música Anterior', 'prevTrack')}
        <li style="padding: 20px; text-align: center;">
            <small style="color: var(--text-muted);">Clique no botão do atalho e pressione a nova combinação de teclas para alterar.</small>
        </li>
        <li style="padding: 15px 20px; display: flex; justify-content: center; border-top: var(--border-tech);">
            <button id="btnResetHotkeys" style="background: rgba(255,0,0,0.1); border: 2px dashed var(--neon-pink); color: var(--neon-pink); font-weight: bold; padding: 10px 20px; cursor: pointer; border-radius: var(--item-radius); transition: 0.3s; font-family: var(--global-font); width: 100%;">
                <i class="ph ph-arrow-counter-clockwise"></i> REPOR ATALHOS DE ORIGEM
            </button>
        </li>
    `;

    // Lógica do Checkbox de Atalhos Globais
    document.getElementById('cbGlobalHotkeys').onchange = (e) => {
        currentHotkeys.globalEnabled = e.target.checked;
        localStorage.setItem('fluxo_hotkeys', JSON.stringify(currentHotkeys));
        
        if (currentHotkeys.globalEnabled) {
            window.electronAPI.registerGlobalShortcuts(currentHotkeys);
        } else {
            window.electronAPI.unregisterGlobalShortcuts();
        }
    };

    // NOVO: Lógica do Botão de Repor Atalhos (Reset)
    document.getElementById('btnResetHotkeys').onclick = () => {
        // Restaura as definições padrão, mas mantém o estado do checkbox global
        currentHotkeys = {
            playPause: 'Space',
            volUp: 'Up',
            volDown: 'Down',
            nextTrack: 'Shift+Right',
            prevTrack: 'Shift+Left',
            globalEnabled: currentHotkeys.globalEnabled 
        };
        
        // Salva as configurações repostas no armazenamento local
        localStorage.setItem('fluxo_hotkeys', JSON.stringify(currentHotkeys));
        
        // Regista os atalhos de origem no sistema operativo (caso a opção global esteja ativa)
        if (currentHotkeys.globalEnabled && window.electronAPI) {
            window.electronAPI.registerGlobalShortcuts(currentHotkeys);
        }
        
        // Clica automaticamente na aba novamente para recarregar os botões com os nomes corretos no ecrã
        document.getElementById('btnHotkeys').click();
    };

    // Lógica de Captura de Novas Teclas (CORRIGIDA E BLINDADA)
    document.querySelectorAll('.keybind-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation(); // Impede que o clique vaze e cancele o próprio evento na mesma hora
            
            const button = e.currentTarget;
            const originalText = button.innerText;
            const actionKey = button.getAttribute('data-key');
            
            button.innerText = "PRESSIONE A TECLA...";
            button.style.borderColor = "var(--neon-pink)";
            button.style.color = "var(--neon-pink)";

            const handleKeyDown = (ev) => {
                ev.preventDefault();
                ev.stopPropagation(); // Trava a tecla para não ativar outras coisas na aplicação
                
                let keys = [];
                if (ev.ctrlKey) keys.push('CommandOrControl');
                if (ev.altKey) keys.push('Alt');
                if (ev.shiftKey) keys.push('Shift');
                
                let key = ev.key;
                if (key === ' ') key = 'Space';
                if (key.startsWith('Arrow')) key = key.replace('Arrow', '');
                
                if (!['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key)) {
                    keys.push(key.length === 1 ? key.toUpperCase() : key);
                }
                const newKeyStr = keys.join('+');

                // Salva a nova associação se não for apenas um modificador puro
                if (!['CommandOrControl', 'Alt', 'Shift'].includes(newKeyStr)) {
                    currentHotkeys[actionKey] = newKeyStr;
                    localStorage.setItem('fluxo_hotkeys', JSON.stringify(currentHotkeys));
                    
                    button.innerText = newKeyStr;
                    button.style.borderColor = "var(--neon-cyan)";
                    button.style.color = "var(--neon-cyan)";
                    
                    if (currentHotkeys.globalEnabled && window.electronAPI) {
                        window.electronAPI.registerGlobalShortcuts(currentHotkeys);
                    }
                    
                    document.removeEventListener('keydown', handleKeyDown);
                    document.removeEventListener('click', cancelCapture);
                }
            };
            
            const cancelCapture = (ev) => {
                if(!button.contains(ev.target)) {
                    button.innerText = originalText;
                    button.style.borderColor = "";
                    button.style.color = "";
                    document.removeEventListener('keydown', handleKeyDown);
                    document.removeEventListener('click', cancelCapture);
                }
            };

            // Remove ouvintes antigos para não duplicar
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('click', cancelCapture);
            
            setTimeout(() => {
                document.addEventListener('keydown', handleKeyDown);
                document.addEventListener('click', cancelCapture);
            }, 50);
        };
    });
});
// ========================================================
// LÓGICA DO SELETOR DE QUALIDADE (BLINDADA CONTRA CRASHES)
// ========================================================
function waitForMediaMetadata(player, timeoutMs = 7000) {
    return new Promise((resolve) => {
        let finished = false;
        let timer = null;

        const cleanup = () => {
            player.removeEventListener('loadedmetadata', finish);
            player.removeEventListener('canplay', finish);
            clearTimeout(timer);
        };

        const finish = () => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve();
        };

        player.addEventListener('loadedmetadata', finish, { once: true });
        player.addEventListener('canplay', finish, { once: true });
        timer = setTimeout(finish, timeoutMs);
    });
}

async function changePlaybackQuality(selectedQuality) {
    if (!queue || !queue[currentIndex]) return;

    const track = normalizeTrack(queue[currentIndex]);
    const trackId = getTrackStreamId(track);
    if (!trackId) return;

    const currentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    const wasPaused = audioPlayer.paused;
    const previousSrc = audioPlayer.src;
    const previousQuality = qSelector.dataset.currentQuality || 'audio';
    const qualityButton = document.getElementById('btnQualityMenu');

    qSelector.disabled = true;
    if (qualityButton) qualityButton.disabled = true;
    if (typeof titleEl !== 'undefined') titleEl.innerText = 'A ALTERAR QUALIDADE...';

    try {
        const resolvedStream = await resolvePlayableStreamForTrack(track, selectedQuality);
        const streamUrl = resolvedStream.url;

        if (selectedQuality !== 'audio' && resolvedStream.mode === 'audio') {
            setVideoUiState(false);
            selectedQuality = 'audio';
            qSelector.value = 'audio';
        }

        audioPlayer.pause();
        setMediaElementSource(audioPlayer, streamUrl, 'main');

        await waitForMediaMetadata(audioPlayer);

        if (Number.isFinite(audioPlayer.duration) && audioPlayer.duration > currentTime + 1) {
            audioPlayer.currentTime = currentTime;
        }

        if (!wasPaused) {
            await audioPlayer.play().catch(err => console.log('Erro ao retomar playback:', err));
        }

        if (typeof titleEl !== 'undefined') titleEl.innerText = track.title;
        qSelector.dataset.currentQuality = selectedQuality;
    } catch (err) {
        console.error('ERRO NO SELETOR:', err);
        qSelector.value = previousQuality;
        if (previousSrc && audioPlayer.src !== previousSrc) {
            audioPlayer.src = previousSrc;
            audioPlayer.load();
            if (!wasPaused) audioPlayer.play().catch(playErr => console.log('Erro ao restaurar playback:', playErr));
        }

        if (typeof titleEl !== 'undefined') {
            titleEl.innerText = 'ERRO AO MUDAR QUALIDADE';
            setTimeout(() => {
                if (queue[currentIndex]) titleEl.innerText = normalizeTrack(queue[currentIndex]).title;
            }, 2000);
        }
    } finally {
        qSelector.disabled = false;
        if (qualityButton) qualityButton.disabled = false;
        syncQualityMenuLabel();
    }
}

function getQualityLabel(value) {
    const labels = {
        audio: 'Audio',
        '360p': '360p',
        '720p': '720p',
        '1080p': '1080p',
        '1440p': '1440p',
        best: 'Max'
    };
    return labels[value] || value || 'Audio';
}

function syncQualityMenuLabel() {
    const selector = document.getElementById('qualitySelector');
    const label = document.getElementById('qualityMenuLabel');
    const menu = document.getElementById('qualityMenu');

    if (label && selector) label.innerText = getQualityLabel(selector.value);

    if (menu && selector) {
        menu.querySelectorAll('.quality-menu-option').forEach(option => {
            option.classList.toggle('active', option.dataset.value === selector.value);
        });
    }
}

function closeQualityMenu() {
    document.getElementById('qualityMenuWrap')?.classList.remove('open');
}

function buildQualityMenu() {
    const selector = document.getElementById('qualitySelector');
    const wrap = document.getElementById('qualityMenuWrap');
    const button = document.getElementById('btnQualityMenu');
    const menu = document.getElementById('qualityMenu');
    if (!selector || !wrap || !button || !menu) return;

    selector.style.display = 'none';
    menu.innerHTML = '';

    Array.from(selector.options).forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'quality-menu-option';
        item.dataset.value = option.value;
        item.innerText = option.textContent.trim();
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            const value = item.dataset.value;
            setVideoUiState(value !== 'audio');
            setQualityValue(value);
            closeQualityMenu();
        });
        menu.appendChild(item);
    });

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        wrap.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
        if (!wrap.contains(event.target)) closeQualityMenu();
    });

    syncQualityMenuLabel();
}

const qSelector = document.getElementById('qualitySelector');
if (qSelector) {
    qSelector.dataset.currentQuality = qSelector.value || 'audio';
    qSelector.addEventListener('change', async () => {
        await changePlaybackQuality(qSelector.value);
        return;

        try {
            // Checagem segura sem usar ".length" para evitar o erro do console
            if (!queue || !queue[currentIndex]) return;
            
            const track = queue[currentIndex];
            const trackId = getTrackStreamId(track);
            
            if (!trackId) return;

            const currentTime = audioPlayer.currentTime;
            const wasPaused = audioPlayer.paused;

            if (typeof titleEl !== 'undefined') titleEl.innerText = "A ALTERAR QUALIDADE...";
            qSelector.disabled = true; // Trava o botão para não dar cliques duplos
            
            // Puxa o link direto do Electron
            const streamUrl = await window.electronAPI.getStreamUrl(trackId, qSelector.value);
            
            if(streamUrl) {
                setMediaElementSource(audioPlayer, streamUrl, 'main');
                
                audioPlayer.onloadedmetadata = () => {
                    audioPlayer.currentTime = currentTime;
                    if (!wasPaused) audioPlayer.play();
                    
                    if (typeof titleEl !== 'undefined') titleEl.innerText = track.title;
                    qSelector.disabled = false;
                    audioPlayer.onloadedmetadata = null;
                };
            } else {
                throw new Error("O servidor não devolveu um link válido.");
            }
        } catch (err) {
            console.error("ERRO NO SELETOR:", err);
            if (typeof titleEl !== 'undefined') titleEl.innerText = "ERRO AO MUDAR QUALIDADE";
            setTimeout(() => { if (typeof titleEl !== 'undefined' && queue[currentIndex]) titleEl.innerText = queue[currentIndex].title; }, 2000);
            qSelector.value = 'audio'; // Força a voltar para áudio para não travar
            qSelector.disabled = false;
        }
    });
}

buildQualityMenu();
openChangelogAfterUpdateIfNeeded();
