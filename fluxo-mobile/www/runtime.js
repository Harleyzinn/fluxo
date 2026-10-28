export const runtimeDefaults = Object.freeze({
  diagnosticEnabled: false, performanceMode: 'balanced', backgroundDownloads: true, prefetchNext: true,
  downloadNotifications: true, silentInterface: true, uiSounds: false, alertSounds: false, haptics: false
});
export function normalizeRuntime(value = {}) {
  const settings = { ...runtimeDefaults };
  for (const key of Object.keys(settings)) {
    if (typeof settings[key] === 'boolean' && typeof value?.[key] === 'boolean') settings[key] = value[key];
    if (key === 'performanceMode' && ['balanced', 'battery'].includes(value?.[key])) settings[key] = value[key];
  }
  return settings;
}
export function pollingDelay(settings, pending) { return settings.performanceMode === 'battery' ? pending ? 8000 : 30000 : pending ? 2500 : 12000; }
