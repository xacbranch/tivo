// The original TiVo sounds, preloaded into Web Audio so they fire with no latency.
// Like the real box, a new sound cuts off the one still playing.
const NAMES = ['updown', 'select', 'back', 'bonk', 'thumbsup', 'thumbsdown', 'speed1', 'speed2', 'speed3', 'slowdown', 'alert'];

let ctx = null;
let out = null;
let current = null;
let muted = false;
let volume = 1; // the TV's volume knob, 0-1
const buffers = {};

export async function load(base = 'assets/sounds/') {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  out = ctx.createGain();
  out.gain.value = 0.9 * volume;
  out.connect(ctx.destination);
  await Promise.all(NAMES.map(async (name) => {
    try {
      const res = await fetch(`${base}${name}.wav`);
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`sound "${name}" failed to load`, err);
    }
  }));
}

export function setMuted(v) { muted = v; }

// the sounds come out of the same TV speaker as the program, so they follow its volume
export function setVolume(v) {
  volume = v;
  if (out) out.gain.value = 0.9 * v;
}

// Browsers keep audio suspended until a user gesture; any keypress counts.
export function unlock() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

export function play(name) {
  if (muted || !ctx || !buffers[name]) return;
  unlock();
  if (current) { try { current.stop(); } catch { /* already ended */ } }
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.connect(out);
  src.start();
  current = src;
  src.onended = () => { if (current === src) current = null; };
}
