// Every sound is synthesised here; there are no audio files.
let actx = null;
let muted = false;

export function unlockAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
}
export function setMuted(m) { muted = m; }

function noise(dur, freq, q, gain, delay = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const buf = actx.createBuffer(1, Math.ceil(actx.sampleRate * dur), actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(actx.destination);
  src.start(t);
}
function tone(f0, f1, dur, type, gain, delay = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

export const SFX = {
  shutter() { noise(0.025, 4200, 0.8, 0.9); noise(0.05, 2200, 1.2, 0.6, 0.07); },
  wind() { noise(0.12, 1400, 2, 0.25); },
  develop() { tone(180, 720, 0.4, 'sine', 0.14); noise(0.35, 900, 0.6, 0.35); },
  erase() { tone(900, 140, 0.45, 'sine', 0.12); noise(0.4, 500, 0.5, 0.45); },
  deny() { tone(150, 120, 0.16, 'square', 0.05); },
  click() { tone(1200, 1200, 0.03, 'square', 0.03); },
  plate() { tone(660, 660, 0.14, 'triangle', 0.14); tone(990, 990, 0.25, 'triangle', 0.12, 0.11); },
  door() { noise(0.9, 140, 0.7, 0.9); tone(70, 45, 0.9, 'sawtooth', 0.05); },
  land(v = 1) { noise(0.14, 260, 1, Math.min(0.8, 0.25 * v)); },
  undo() { tone(700, 350, 0.18, 'sine', 0.08); },
  fall() { noise(0.4, 600, 0.4, 0.25); },
  done() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.1, i * 0.09)); },
  // the Curator's voice: soft typewriter chirps, one per couple of letters
  voice(pitch = 1) { tone(420 * pitch, 380 * pitch, 0.045, 'sine', 0.035); },
  card() { noise(0.08, 3000, 0.7, 0.12); },
  // the enlarger
  charge(t) { tone(200, 900, t, 'sawtooth', 0.035); },
  flash() { noise(0.5, 5000, 0.4, 0.9); tone(1800, 200, 0.5, 'sine', 0.12); },
  boom() { noise(1.2, 90, 0.6, 1); tone(60, 30, 1.2, 'sawtooth', 0.12); },
  shutter2() { noise(0.6, 400, 0.8, 0.7); tone(120, 240, 0.6, 'square', 0.04); },
  dying() { [880, 660, 440, 330, 220, 110].forEach((f, i) => tone(f, f * 0.7, 0.5, 'sine', 0.08, i * 0.35)); },
};
