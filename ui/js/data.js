// The lineup as the UI sees it. ui/data/lineup.json is built from tools/channels.py by
// tools/build_lineup.py; schedule.js turns it into airings for every channel.
import { buildSchedule, seeded, MIN, DAY } from './schedule.js';
import { clock } from './time.js';

// Placeholder picture until the box streams the real files.
const CLIPS = ['assets/video/ch-gradients.mp4', 'assets/video/ch-fractal.mp4', 'assets/video/ch-life.mp4'];

export const CHANNELS = [];
export const PROGRAMS = {};
const ADS = {};

// One "show" object per film or series, so thumbs ratings follow the title around.
const shows = new Map();
function showFor(p) {
  const key = p.k === 'm' ? `m:${p.t}:${p.y}` : `s:${p.sh}`;
  let s = shows.get(key);
  if (!s) {
    s = p.k === 'm'
      ? { title: p.t, genre: p.g[0] || '', genres: p.g, year: p.y, rating: p.r || 'Not Rated', movie: true,
          cast: p.cast.join(', '), director: p.dir.join(', ') }
      : { title: p.sh, genre: p.g[0] || '', genres: p.g, year: p.shy, rating: p.r || '', movie: false, cast: '' };
    shows.set(key, s);
  }
  return s;
}

const INTERMISSION = { title: 'Intermission', genre: '', rating: '', movie: false, cast: '' };
const liveShows = new Map();
const tapeShows = new Map();

function toAiring(a) {
  const p = a.id && PROGRAMS[a.id];
  if (!p) {
    return { key: null, filler: true, show: INTERMISSION, epTitle: '', desc: 'Short subjects and previews.', pool: a.pool,
             start: a.start, end: a.end, mediaEnd: a.mediaEnd, dur: (a.end - a.start) / MIN, recording: false };
  }
  if (p.k === 'live' || p.k === 'radio' || p.k === 'weather') {
    const radio = p.k === 'radio';
    const genre = radio ? 'Radio' : p.k === 'weather' ? 'Weather' : 'Live';
    if (!liveShows.has(a.id)) liveShows.set(a.id, { title: p.t, genre, rating: '', movie: false, cast: '' });
    const desc = radio ? `${p.s} Live radio from ${p.city}, New Mexico.` : p.k === 'weather' ? p.s : `${p.s} Live internet channel.`;
    return { key: a.id, program: p, live: true, radio, show: liveShows.get(a.id), epTitle: '', desc,
             start: a.start, end: a.end, mediaEnd: a.end, dur: p.d, recording: false };
  }
  if (p.k === 'tc') {
    // an off-air recording, listed in half-hour parts
    if (!tapeShows.has(p.t)) tapeShows.set(p.t, { title: p.t, genre: 'Children', rating: '', movie: false, cast: '' });
    return { key: a.id, program: p, show: tapeShows.get(p.t), epTitle: '', desc: p.s, pool: a.pool,
             start: a.start, end: a.end, mediaEnd: a.mediaEnd, dur: p.d, recording: false };
  }
  return { key: a.id, program: p, show: showFor(p), epTitle: p.k === 'e' ? p.t : '', desc: p.s, pool: a.pool,
           season: p.se, episode: p.ep, start: a.start, end: a.end, mediaEnd: a.mediaEnd, dur: p.d, recording: false };
}

export async function loadLineup() {
  const lineup = await (await fetch('data/lineup.json')).json();
  Object.assign(PROGRAMS, lineup.programs);
  Object.assign(ADS, lineup.ads || {});
  buildSchedule(lineup).forEach((sched, i) => {
    const { num, call, name, tagline, live, radio, weather, logo } = sched.def;
    const airings = sched.airings.map(toAiring);
    airings.forEach((a, j) => {
      if (a.filler && airings[j + 1]) a.desc = `Short subjects and previews. Up next at ${clock(airings[j + 1].start)}: ${airings[j + 1].show.title}.`;
    });
    CHANNELS.push({ num, call, name, tagline, live: !!live, radio: !!radio, weather: !!weather, logo: logo ? `assets/logos/${logo}` : null,
                    def: sched.def, video: CLIPS[i % CLIPS.length], airings });
  });
  // a live channel with a weekly guide of its own (KOAT: newscasts, Very Local between)
  const now = Date.now();
  for (const ch of CHANNELS) {
    const id = ch.def.pools.live?.items?.[0];
    const p = id && PROGRAMS[id];
    if (p?.guide) ch.airings = weeklyGuide(id, p, now - 4 * DAY, now + 7 * DAY);
  }
}

// ── live channels' listings ──────────────────────────────────────────────────
function liveAiring(id, p, start, end, title, ep, desc) {
  const key = `${id}:${title}`;
  if (!liveShows.has(key)) liveShows.set(key, { title, genre: 'Live', rating: '', movie: false, cast: '' });
  return { key: id, program: p, live: true, radio: false, show: liveShows.get(key), epTitle: ep || '', desc: desc || p.s,
           start, end, mediaEnd: end, dur: (end - start) / MIN, recording: false };
}

// wall-clock parts of an instant in a time zone, and the instant of a wall-clock time there
const zoneFmt = new Map();
function zoned(t, tz) {
  let f = zoneFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric',
                                           day: 'numeric', hour: 'numeric', minute: 'numeric' });
    zoneFmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, w: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
function wallTime(y, m, d, h, mi, tz) {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 2; i++) { const z = zoned(t, tz); t += want - Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi); }
  return t;
}

// A weekly guide: the listed slots on the days they air (in the guide's time zone),
// and the filler program in every gap between them.
function weeklyGuide(id, p, from, to) {
  const g = p.guide;
  const slots = [];
  const seen = new Set();
  for (let t = from - DAY; t < to + DAY; t += DAY / 2) {
    const z = zoned(t, g.tz);
    const date = `${z.y}-${z.m}-${z.d}`;
    if (seen.has(date)) continue;
    seen.add(date);
    for (const s of g.slots) {
      if (!s.days.includes(z.w)) continue;
      const [h, mi] = s.at.split(':').map(Number);
      const start = wallTime(z.y, z.m, z.d, h, mi, g.tz);
      slots.push(liveAiring(id, p, start, start + s.mins * MIN, s.t, '', s.s));
    }
  }
  slots.sort((a, b) => a.start - b.start);
  const out = [];
  let t = from;
  for (const a of slots) {
    if (a.end <= from || a.start >= to) continue;
    if (a.start > t) out.push(liveAiring(id, p, t, a.start, g.filler.t, '', g.filler.s));
    out.push(a);
    t = Math.max(t, a.end);
  }
  if (t < to) out.push(liveAiring(id, p, t, to, g.filler.t, '', g.filler.s));
  return out;
}

// Pluto's channels come with real listings: splice them over the hour blocks.
export async function refreshGuides() {
  let epg;
  try { epg = await (await fetch('api/epg')).json(); } catch { return; }
  for (const [id, list] of Object.entries(epg)) {
    const ch = CHANNELS.find((c) => c.def.pools.live?.items?.[0] === id);
    if (!ch || !list.length) continue;
    const p = PROGRAMS[id];
    const s = list[0].start;
    const e = list[list.length - 1].end;
    const keep = [];
    for (const a of ch.airings) {
      if (a.end <= s || a.start >= e) keep.push(a);
      else if (a.start < s && !a.epg) keep.push({ ...a, end: s, mediaEnd: s });
      else if (a.end > e && !a.epg) keep.push({ ...a, start: e });
    }
    const listed = list.map((x) => Object.assign(liveAiring(id, p, x.start, x.end, x.title, x.ep, x.desc), { epg: true }));
    ch.airings = [...keep, ...listed].sort((a, b) => a.start - b.start);
  }
}

// ── what's on screen: the program, then the commercial break ─────────────────
// A program and its stream: half-hour parts of an off-air recording all play from
// one file, so one stream carries straight through from part to part.
export function streamOf(id) {
  const p = PROGRAMS[id];
  return p?.src ? { id: p.src, o: p.o * 60 } : { id, o: 0 };
}

const SPOT_GAP = 3000; // a leftover gap shorter than this stays on the last spot (black)

function adPool(ch, a) {
  const key = (a.pool && ch.def.pools[a.pool]?.ads) || ch.def.ads;
  if (!key) return null;
  const list = ADS[key]?.length ? ADS[key] : ADS.general;
  return list?.length ? list : null;
}

// Every airing gets segments: what plays from when, as { id, start, end, t0 }
// (t0 = stream second at start). Channels with commercials fill the gap after a
// program with whole spots. If the last one runs over, the next program starts
// that much late, and the overrun is the first segment of the next airing.
function layBreaks(ch) {
  if (ch.laid) return;
  ch.laid = true;
  let carry = null;
  for (const a of ch.airings) {
    if (a.live) continue;
    const segs = [];
    let t = a.start;
    if (carry && carry.end > a.start) { segs.push(carry); t = carry.end; }
    if (!a.filler) {
      const s = streamOf(a.key);
      segs.push({ id: s.id, start: t, end: t + (a.mediaEnd - a.start), t0: s.o });
      t += a.mediaEnd - a.start;
    }
    const pool = adPool(ch, a);
    if (pool && a.end - t > SPOT_GAP) {
      const rand = seeded(`${ch.num}:${a.start}`);
      const used = new Set();
      const pick = () => {
        for (let i = 0; i < 6; i++) {
          const id = pool[Math.floor(rand() * pool.length)];
          if (!used.has(id)) { used.add(id); return id; }
        }
        return pool[Math.floor(rand() * pool.length)];
      };
      const len = (id) => PROGRAMS[id].len * 1000;
      while (a.end - t > SPOT_GAP) {
        const left = a.end - t;
        let id = pick();
        if (left < 45e3) {
          // the closing spot: the one that runs over the least
          const options = [id, pick(), pick(), pick(), pick(), pick()];
          const over = options.filter((x) => len(x) >= left).sort((x, y) => len(x) - len(y));
          id = over[0] || options.sort((x, y) => len(y) - len(x))[0];
        }
        segs.push({ id, start: t, end: t + len(id), t0: 0, ad: true });
        t += len(id);
      }
      const last = segs[segs.length - 1];
      if (last.end < a.end) last.end = a.end;
    }
    a.segs = segs;
    a.late = segs[0] && segs[0].start < a.start ? segs[0].end - a.start : 0;
    const last = segs[segs.length - 1];
    carry = last && last.end > a.end ? last : null;
  }
}

// The segment playing at t in airing a, or null for a gap (the up-next card).
export function segmentAt(ch, a, t) {
  if (!a || a.live) return null;
  layBreaks(ch);
  return a.segs.find((s) => s.start <= t && t < s.end) || null;
}

export function airingAt(ch, t) {
  const a = ch.airings;
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].end <= t) lo = mid + 1;
    else if (a[mid].start > t) hi = mid - 1;
    else return a[mid];
  }
  return a[Math.max(0, Math.min(a.length - 1, lo))];
}

export const channelByCall = (call) => CHANNELS.find((c) => c.call === call);

// a typed channel number to its index ("2", "02" and "002" are all channel 2)
export const channelIndex = (digits) => CHANNELS.findIndex((c) => c.num === digits || Number(c.num) === Number(digits));

// Now Playing: the DVR's recordings (newest first; one still recording gets the red
// dot), then TiVo Suggestions from what the library channels aired lately.
const recShows = new Map();
export function buildRecordings(dvrItems = [], now = Date.now()) {
  const D = 24 * 60 * MIN;
  const list = dvrItems.filter((r) => ['recording', 'processing', 'done'].includes(r.status)).map((r) => {
    if (!recShows.has(r.title)) recShows.set(r.title, { title: r.title, genre: '', rating: '', movie: false, cast: '' });
    const inProgress = r.status === 'recording';
    return {
      kind: 'show', key: `rec:${r.rid}`, rid: r.rid, show: recShows.get(r.title), call: r.channel.call, start: r.start,
      end: inProgress ? now : r.end, epTitle: r.ep, desc: r.desc || '', dur: (r.secs || 0) / 60,
      status: inProgress ? 'recording' : null, inProgress, began: now - (r.secs || 0) * 1000,
    };
  });

  const aired = (call, from) => (channelByCall(call)?.airings || []).filter((a) => !a.filler && !a.live && a.mediaEnd <= now && a.start >= now - from);
  const rec = (call, a) => ({ kind: 'show', key: a.key, show: a.show, call, start: a.start, end: a.mediaEnd, epTitle: a.epTitle,
                              desc: a.desc, dur: a.dur, status: 'suggestion' });
  const suggestions = [...aired('CN', 2 * D).slice(-2), ...aired('NICK', 2 * D).slice(-2), ...aired('G4', 2 * D).slice(-2)]
    .map((a) => rec(CHANNELS.find((c) => c.airings.includes(a))?.call || '', a));
  if (suggestions.length) {
    list.push({ kind: 'folder', key: 'suggestions', title: 'TiVo Suggestions', call: '', count: suggestions.length,
                start: suggestions[0].start, suggestions: true, items: suggestions });
  }
  return list;
}
