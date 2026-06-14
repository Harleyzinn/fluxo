const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // FUNÇÕES DE JANELA (Que você já deve ter aí)
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
    
    // =========================================================
    // AS FUNÇÕES DE ÁUDIO QUE ESTAVAM FALTANDO!
    // =========================================================
    searchAudio: (query) => ipcRenderer.invoke('search-audio', query),
    getStreamUrl: (id, quality) => ipcRenderer.invoke('get-stream-url', id, quality),
    resolveTrackStream: (track, quality) => ipcRenderer.invoke('resolve-track-stream', track, quality),
    downloadAudio: (id, title, collectionTitle) => ipcRenderer.invoke('download-audio', id, title, collectionTitle),
    getSpotifyInfo: (url) => ipcRenderer.invoke('get-spotify-info', url),
    updateDiscordPresence: (track, state) => ipcRenderer.send('discord-presence-update', track, state),
    clearDiscordPresence: () => ipcRenderer.send('discord-presence-clear'),
    getDiscordStatus: () => ipcRenderer.invoke('discord-status-get'),
    resetDiscordPresence: () => ipcRenderer.invoke('discord-presence-reset'),
    testDiscordPresence: () => ipcRenderer.invoke('discord-presence-test'),
    onDiscordStatus: (callback) => ipcRenderer.on('discord-status-update', callback),
    onRemoteControlAction: (callback) => ipcRenderer.on('remote-control-action', callback),
    getAppInfo: () => ipcRenderer.invoke('app-info-get'),
    listPlugins: () => ipcRenderer.invoke('plugins-list'),
    openPluginsFolder: () => ipcRenderer.invoke('plugins-open-folder'),
    openExternalUrl: (url) => ipcRenderer.invoke('external-url-open', url),
    runNetworkDiagnostics: () => ipcRenderer.invoke('network-diagnostics-run'),
    diagnoseMedia: (track, quality) => ipcRenderer.invoke('diagnose-media', track, quality),
    openNowPlayingWidget: (mode) => ipcRenderer.invoke('now-playing-widget-open', mode),
    updateNowPlayingWidget: (payload) => ipcRenderer.send('now-playing-widget-update', payload),
    convertCurrentTrack: (track, format) => ipcRenderer.invoke('convert-current-track', track, format),
    exportTrackSample: (track, startSeconds, endSeconds) => ipcRenderer.invoke('export-track-sample', track, startSeconds, endSeconds),
    
    // Funções do Mini Player e Always On Top
    toggleMiniPlayer: (isMini) => ipcRenderer.send('toggle-mini-player', isMini),
    toggleAlwaysOnTop: (isPinned) => ipcRenderer.send('toggle-always-on-top', isPinned),
    
    // Funções de Atalho Global e Atualização (Mantenha se já tiver)
    registerGlobalShortcuts: (hotkeys) => ipcRenderer.send('register-global-shortcuts', hotkeys),
    unregisterGlobalShortcuts: () => ipcRenderer.send('unregister-global-shortcuts'),
    onGlobalShortcutAction: (callback) => ipcRenderer.on('global-shortcut-action', callback),
    onUpdateMessage: (callback) => ipcRenderer.on('update-message', callback),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback)
});
