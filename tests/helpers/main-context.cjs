const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

module.exports = function loadMain(overrides = {}) {
    const root = path.resolve(__dirname, '../..');
    const localRequire = createRequire(path.join(root, 'main.js'));
    const handlers = new Map();
    const electron = {
        app: { isPackaged: false, whenReady: () => ({ then() {} }), on() {}, getVersion: () => localRequire('./package.json').version,
            getPath: () => path.join(root, '.test-data'), getAppPath: () => root },
        ipcMain: { on() {}, handle: (name, handler) => handlers.set(name, handler) },
        globalShortcut: { unregisterAll() {} }, shell: {}, BrowserWindow: {}
    };
    const context = vm.createContext({
        require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: {} } : localRequire(name),
        __dirname: root, process, Buffer, URL, AbortController, AbortSignal, fetch,
        setTimeout, clearTimeout, setInterval, clearInterval, console,
        ...overrides
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    return { context, handlers, run: code => vm.runInContext(code, context) };
};
