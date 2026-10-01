let getState = () => ({});
const levels = new Float32Array(32);
let lastFrame = 0;
let running = false;
function frame(time) {
  if (!running) return;
  const canvas = document.querySelector('#audio-visual');
  if (canvas && !document.hidden && time - lastFrame > 32) {
    lastFrame = time;
    const state = getState();
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
    const colors = getComputedStyle(document.body);
    const gap = 3, width = (rect.width - gap * 31) / 32;
    for (let i = 0; i < 32; i++) {
      const target = state.playing ? Number(state.levels?.[i] || 0) : 0;
      levels[i] += (target - levels[i]) * 0.22;
      const height = Math.max(3, levels[i] * (rect.height - 4));
      ctx.fillStyle = colors.getPropertyValue(i % 7 === 0 ? '--pink' : '--cyan');
      ctx.globalAlpha = 0.4 + levels[i] * 0.6;
      ctx.beginPath(); ctx.roundRect(i * (width + gap), (rect.height - height) / 2, Math.max(1, width), height, 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
}
export function startVisualizer(state) { getState = state; if (!running) { running = true; requestAnimationFrame(frame); } }
export function stopVisualizer() { running = false; }
