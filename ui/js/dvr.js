// The DVR, as the screens see it: what's scheduled, recording and recorded (kept by
// the box server, in the media folder), which listings get the red dot, and the Record button.
// Only the live channels record; the library channels are always "recorded" already.
import { CHANNELS } from './data.js';

export const DVR = { items: [], ready: true };
const ACTIVE = new Set(['scheduled', 'recording', 'resume']);
const listeners = new Set();

export const onDVRChange = (fn) => listeners.add(fn);

export function recordable(ch) {
  return !!ch && ch.live && !ch.radio && !ch.weather;
}

// the recording that covers this airing, if any
export function recordingFor(ch, a) {
  if (!recordable(ch) || !a) return null;
  return DVR.items.find((r) => r.program === a.key && ACTIVE.has(r.status)
    && r.start < a.end - 30e3 && r.end > a.start + 30e3) || null;
}

function markAirings() {
  for (const ch of CHANNELS) {
    if (!recordable(ch)) continue;
    for (const a of ch.airings) a.recording = !!recordingFor(ch, a);
  }
}

export async function refreshDVR() {
  try {
    const j = await (await fetch('api/dvr', { cache: 'no-store' })).json();
    DVR.items = j.items;
    DVR.ready = j.ready;
  } catch { return; }
  markAirings();
  for (const fn of listeners) fn();
}

// Record button: record this showing, or (pressed again) stop or cancel it.
// Resolves to { error } on a conflict (both tuners busy) or when the media folder is away.
export async function toggleRecording(ch, a) {
  const existing = recordingFor(ch, a);
  let result = {};
  try {
    if (existing) {
      a.recording = false;
      await fetch(`api/dvr${existing.status === 'scheduled' ? '' : '/stop'}?rid=${existing.rid}`,
        { method: existing.status === 'scheduled' ? 'DELETE' : 'POST' });
    } else {
      a.recording = true;
      const res = await fetch('api/dvr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program: a.key, start: a.start, end: a.end, title: a.show.title, ep: a.epTitle, desc: a.desc }),
      });
      result = await res.json();
    }
  } catch {
    result = { error: 'server' }; // the box server is down: nothing changed
  }
  await refreshDVR();
  return result;
}

// Stop a recording in progress, keeping what it has so far.
export async function stopRecording(rid) {
  try { await fetch(`api/dvr/stop?rid=${rid}`, { method: 'POST' }); } catch { /* server down */ }
  await refreshDVR();
}

// Season Pass, live-TV style: every upcoming listing of this show on this channel.
export async function seasonPass(ch, a) {
  const now = Date.now();
  const upcoming = ch.airings.filter((x) => x.show === a.show && x.end > now && !recordingFor(ch, x));
  for (const x of upcoming) {
    try {
      await fetch('api/dvr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program: x.key, start: x.start, end: x.end, title: x.show.title, ep: x.epTitle, desc: x.desc }),
      });
    } catch { break; }
  }
  await refreshDVR();
}

export async function deleteRecording(rid) {
  try { await fetch(`api/dvr?rid=${rid}`, { method: 'DELETE' }); } catch { /* server down */ }
  await refreshDVR();
}
