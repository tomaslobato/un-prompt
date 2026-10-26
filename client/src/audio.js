let ctx = null;
let master = null;
let noise = null;
let muted = false;
let voices = 0;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.25);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function envGain(duration, peak) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  return g;
}

function burst(duration, freq, peak, kind) {
  if (!ctx || muted || voices > 10) return;
  voices += 1;
  const g = envGain(duration, peak);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = kind === 'low' ? 'lowpass' : 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = kind === 'tick' ? 6 : 0.7;
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
  src.stop(ctx.currentTime + duration + 0.02);
  src.onended = () => { voices = Math.max(0, voices - 1); };
}

function tone(freq, duration, peak) {
  if (!ctx || muted || voices > 10) return;
  voices += 1;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), ctx.currentTime + duration);
  const g = envGain(duration, peak * 0.35);
  osc.connect(g);
  g.connect(master);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.02);
  osc.onended = () => { voices = Math.max(0, voices - 1); };
}

const SHOT = {
  deagle: [0.09, 420, 0.9],
  sniper: [0.2, 220, 1],
  ak: [0.07, 700, 0.55],
  uzi: [0.035, 1100, 0.38],
};

export function playShot(weapon, volume = 1) {
  unlockAudio();
  const spec = SHOT[weapon] || SHOT.ak;
  burst(spec[0], spec[1], spec[2] * volume, 'low');
}

export function playHit(head) {
  unlockAudio();
  burst(0.04, head ? 1800 : 1400, 0.25, 'tick');
}

export function playHurt() {
  unlockAudio();
  burst(0.12, 140, 0.7, 'low');
}

export function playElim() {
  unlockAudio();
  tone(520, 0.12, 0.4);
}

export function playDie() {
  unlockAudio();
  tone(180, 0.28, 0.5);
}

export function playReload() {
  unlockAudio();
  burst(0.04, 900, 0.2, 'tick');
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = value ? 0 : 0.22;
}

export function isMuted() {
  return muted;
}
