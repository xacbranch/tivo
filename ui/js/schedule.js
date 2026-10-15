// The broadcast schedule. Every channel is laid out from a fixed epoch with a
// seeded shuffle, so any device computes the same guide and a channel is always
// somewhere in the middle of a program. Programs start on the hour or half hour;
// the pad after a film runs to the next slot, like commercials did.
//
// Lineup format (ui/data/lineup.json, built by tools/build_lineup.py):
//   pools:    { key: { order, items: [programId], ads? } | { rotate: [keys] } | { daily: [keys] }
//              | { again: key } (that pool's latest episode, repeated) }
//   dayparts: [{ at: 'HH:MM', pool, hard?, days? }]   hard = starts exactly on time
//   seasons:  [{ name, from: 'MM-DD', to: 'MM-DD', dayparts }]

const MIN = 60e3;
const SLOT = 30 * MIN;
const DAY = 24 * 60 * MIN;
const EPOCH = new Date(2026, 0, 4, 6, 0, 0).getTime(); // a Sunday morning; never change once in use
const LOOKAHEAD = 20; // how deep into a shuffled deck to look for a film that fits before a hard start
const KEEP = 4 * DAY; // airings that ended longer ago than this are dropped while simulating

const ceilSlot = (t) => Math.ceil(t / SLOT) * SLOT;
const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function seeded(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function inSeason(mmdd, from, to) {
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to;
}

class ChannelSchedule {
  constructor(def, programs) {
    this.def = def;
    this.programs = programs;
    this.state = {};
    this.boundaryCache = new Map();
    this.airings = [];
    this.t = EPOCH;
  }

  // Daypart starts for one calendar day, honoring seasons and weekday filters.
  boundaries(dayStart) {
    const d = new Date(dayStart);
    const key = dateKey(d);
    let list = this.boundaryCache.get(key);
    if (list) return list;
    const mmdd = key.slice(5);
    const season = (this.def.seasons || []).find((s) => inSeason(mmdd, s.from, s.to));
    const dayparts = season ? season.dayparts : this.def.dayparts;
    list = dayparts
      .filter((p) => !p.days || p.days.includes(d.getDay()))
      .map((p) => {
        const [h, m] = p.at.split(':').map(Number);
        return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime(), pool: p.pool, hard: !!p.hard };
      })
      .sort((a, b) => a.start - b.start);
    this.boundaryCache.set(key, list);
    if (this.boundaryCache.size > 8) this.boundaryCache.delete(this.boundaryCache.keys().next().value);
    return list;
  }

  midnight(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  activePool(t) {
    const today = this.midnight(t);
    const all = [...this.boundaries(this.midnight(today - DAY / 2)), ...this.boundaries(today)];
    let cur = all[0];
    for (const b of all) if (b.start <= t) cur = b;
    return cur.pool;
  }

  nextHard(t) {
    const today = this.midnight(t);
    for (const day of [today, this.midnight(today + DAY * 1.5)]) {
      for (const b of this.boundaries(day)) if (b.hard && b.start > t) return b.start;
    }
    return Infinity;
  }

  // Broadcast day number (days start at 6 am) for daily rotations.
  dayIndex(t) { return Math.floor((t - EPOCH) / DAY); }

  deck(key, pool) {
    let s = this.state[key];
    if (!s) s = this.state[key] = { pos: 0, cycle: 0, order: null, last: null };
    if (!s.order || s.pos >= s.order.length) {
      if (s.order) { s.cycle++; s.pos = 0; }
      s.order = [...pool.items];
      if (pool.order === 'shuffle') {
        const rand = seeded(`${this.def.num}:${key}:${s.cycle}`);
        for (let i = s.order.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [s.order[i], s.order[j]] = [s.order[j], s.order[i]];
        }
        // don't open a new cycle with the film that just ended the last one
        if (s.order.length > 1 && s.order[0] === s.last) [s.order[0], s.order[1]] = [s.order[1], s.order[0]];
      }
    }
    return s;
  }

  // Next program from a pool that ends (slot-aligned) by `limit`, or null. depth: how many
  // rotations deep this is; a lineup whose pools lead back to themselves gets a gap, not a hang.
  draw(key, t, limit, depth = 0) {
    const pool = this.def.pools[key];
    if (!pool || depth > 8) return null;
    if (pool.rotate) {
      const s = this.state[key] || (this.state[key] = { n: 0 });
      for (let tries = 0; tries < pool.rotate.length; tries++) {
        const sub = pool.rotate[(s.n + tries) % pool.rotate.length];
        const id = this.draw(sub, t, limit, depth + 1);
        if (id) { s.n += tries + 1; return id; }
      }
      return null;
    }
    if (pool.daily) return pool.daily.length ? this.draw(pool.daily[this.dayIndex(t) % pool.daily.length], t, limit, depth + 1) : null;
    if (pool.again) {
      // a repeat of the episode that pool aired last (before it ever has: its next one)
      const last = this.state[pool.again]?.last;
      if (!last) return this.draw(pool.again, t, limit, depth + 1);
      return ceilSlot(t + this.programs[last].d * MIN) <= limit ? last : null;
    }

    let s = this.deck(key, pool);
    const fits = (id) => ceilSlot(t + this.programs[id].d * MIN) <= limit;
    const findFit = () => {
      for (let i = s.pos; i < Math.min(s.order.length, s.pos + LOOKAHEAD); i++) if (fits(s.order[i])) return i;
      return -1;
    };
    if (limit !== Infinity && !fits(s.order[s.pos])) {
      if (pool.order !== 'shuffle') return null;
      let pick = findFit();
      if (pick < 0 && s.pos > 0) {
        // only films too long for this window are left: start the next shuffle
        s.pos = s.order.length;
        s = this.deck(key, pool);
        pick = findFit();
      }
      if (pick < 0) return null;
      [s.order[s.pos], s.order[pick]] = [s.order[pick], s.order[s.pos]];
    }
    const id = s.order[s.pos++];
    s.last = id;
    return id;
  }

  extend(until, keepFrom = until - KEEP) {
    while (this.t < until) {
      const t = this.t;
      const limit = this.nextHard(t);
      const pool = this.activePool(t);
      const id = this.draw(pool, t, limit);
      let airing;
      if (id) {
        const mediaEnd = t + this.programs[id].d * MIN;
        airing = { id, pool, start: t, end: ceilSlot(mediaEnd), mediaEnd };
      } else {
        // nothing fits before a hard start: fill the gap
        airing = { id: null, pool, start: t, end: limit === Infinity ? t + SLOT : limit, mediaEnd: t };
      }
      if (airing.end <= airing.start) airing.end = airing.start + SLOT;
      this.t = airing.end;
      if (airing.end > keepFrom) this.airings.push(airing);
    }
  }

  // binary search for the airing covering t
  at(t) {
    const a = this.airings;
    let lo = 0, hi = a.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].end <= t) lo = mid + 1;
      else if (a[mid].start > t) hi = mid - 1;
      else return a[mid];
    }
    return null;
  }
}

export function buildSchedule(lineup, { now = Date.now(), ahead = 7 * DAY } = {}) {
  return lineup.channels.map((def) => {
    const ch = new ChannelSchedule(def, lineup.programs);
    ch.extend(now + ahead, now - KEEP);
    return ch;
  });
}

export { MIN, SLOT, DAY, EPOCH, seeded };
