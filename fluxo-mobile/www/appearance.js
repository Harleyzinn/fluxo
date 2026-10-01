export const appearanceDefaults = Object.freeze({
  theme: 'fluxobug', accent: '#a5f060', secondary: '#fa84ad', background: '#0e1110',
  customAccent: false, customSecondary: false, customBackground: false,
  density: 'comfortable', textSize: 'normal', font: 'system', radius: 8,
  artworkShape: 'square', playlistView: 'grid', playerLayout: 'cover',
  visualizer: 'bars', reducedMotion: false
});
const choices = {
  density: ['comfortable', 'compact'], textSize: ['normal', 'large'], font: ['system', 'mono', 'serif'],
  artworkShape: ['square', 'round'], playlistView: ['grid', 'list'], playerLayout: ['cover', 'compact'],
  visualizer: ['bars', 'wave', 'off'], radius: [0, 4, 8]
};
export const playlistIcons = ['list-music', 'headphones', 'disc-3', 'heart', 'radio', 'music-2', 'sparkles'];
export const playlistColors = ['#a5f060', '#fa84ad', '#54c7e8', '#e8b85a', '#ae9cf5', '#ff7c7c'];
export const isColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function normalizeAppearance(value = {}) {
  const result = { ...appearanceDefaults };
  if (!value || typeof value !== 'object') return result;
  for (const key of Object.keys(result)) {
    if (choices[key]?.includes(value[key])) result[key] = value[key];
    else if (['accent', 'secondary', 'background'].includes(key) && isColor(value[key])) result[key] = value[key].toLowerCase();
    else if (typeof result[key] === 'boolean' && typeof value[key] === 'boolean') result[key] = value[key];
    else if (key === 'theme' && typeof value.theme === 'string' && /^[a-z0-9-]{1,60}$/.test(value.theme)) result.theme = value.theme;
  }
  return result;
}
export function normalizeSettings(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const profiles = Array.isArray(value.profiles) ? value.profiles : [];
  return { ...normalizeAppearance(value), offline: value.offline === true, wifiOnly: value.wifiOnly === true,
    themeFavorites: [...new Set((Array.isArray(value.themeFavorites) ? value.themeFavorites : []).filter(id => typeof id === 'string' && /^[a-z0-9-]{1,60}$/.test(id)))].slice(0, 100),
    profiles: [...new Map(profiles.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim()).slice(0, 12)
      .map(p => [p.id, { id: p.id.slice(0, 100), name: p.name.trim().slice(0, 40), values: normalizeAppearance(p.values) }])).values()] };
}
export function playlistAppearance(value = {}) {
  return { coverStyle: value.coverStyle === 'symbol' ? 'symbol' : 'mosaic',
    coverColor: isColor(value.coverColor) ? value.coverColor : 'auto',
    coverIcon: playlistIcons.includes(value.coverIcon) ? value.coverIcon : 'list-music' };
}
const rgb = color => {
  if (/^#[0-9a-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map(c => c + c).join('');
  return isColor(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : [165, 240, 96];
};
const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export function contrastText(color) {
  const channels = rgb(color).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#101411' : '#ffffff';
}
export function surfacePalette(color) {
  const base = rgb(color), text = contrastText(color), ink = rgb(text);
  const blend = ratio => hex(base.map((v, i) => v + (ink[i] - v) * ratio));
  return { '--bg': color, '--panel': blend(.06), '--panel-2': blend(.12), '--text': text, '--muted': blend(.65) };
}
