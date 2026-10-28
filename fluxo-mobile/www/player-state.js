export function playbackView(state) {
  const active = !!state.playing || state.playWhenReady === true;
  return { active, busy: active && !!(state.buffering || state.recovering), action: active ? 'pause' : 'play',
    icon: active ? 'pause' : state.error ? 'rotate-cw' : 'play', label: active ? 'Pausar' : state.error ? 'Tentar novamente' : 'Reproduzir' };
}
export function normalizePlaybackPreferences(value = {}) {
  return { seekStep: [5, 10, 15, 30].includes(value?.seekStep) ? value.seekStep : 10, remainingTime: value?.remainingTime === true };
}
export function extendSleepTimer(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now) || deadline <= now) return null;
  return Math.min(240, (deadline - now) / 60000 + 5);
}
const speedFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export function speedLabel(value) {
  const speed = Number.isFinite(value) && value > 0 ? Math.max(.5, Math.min(2, value)) : 1;
  return `${speedFormat.format(Math.round(speed * 100) / 100)}×`;
}
export function playbackItem(state) {
  const track = state.queue?.[state.index];
  return track ? { index: state.index, id: String(track.id || ''), url: String(track.url || '') } : null;
}
export function samePlaybackItem(state, expected) {
  const actual = playbackItem(state);
  return !!actual && !!expected && actual.index === expected.index && actual.id === expected.id && actual.url === expected.url;
}
export function seekRequest(state, seconds, expected = playbackItem(state)) {
  if (!samePlaybackItem(state, expected) || !Number.isFinite(seconds) || !Number.isFinite(state.duration) || state.duration <= 0) return null;
  return { action: 'seek', value: Math.max(0, Math.min(state.duration, seconds)), expectedItem: { ...expected } };
}
