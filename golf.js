// Dirty's Golf Weather's data: how Albuquerque's city golf courses are playing right now,
// worked out from live National Weather Service data (through the same cached Weather
// client The Weather Channel uses).
//
// Everything said about a course comes from real readings at the station nearest it and
// NWS's hourly forecast for its spot: rain in the last three days decides firm or soft,
// the air's density (elevation, temperature, pressure) how far the ball carries, the wind
// how many clubs to take, and the forecast hours the best tee time.
import { sunTimes } from './ui/js/wxastro.js';

const TTL = { obs: 10 * 60e3, hourly: 30 * 60e3, rain: 30 * 60e3 };
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassDeg = (dir) => (POINTS.includes(dir) ? POINTS.indexOf(dir) * 22.5 : null);

export class GolfReport {
  constructor(weather) {
    this.wx = weather;
  }

  async report(p) {
    const wx = this.wx;
    const now = Date.now();
    const home = p.home;
    const homeObs = await wx.cached(`obs:${home.station}`, TTL.obs, () => wx.observe(home.station)).catch(() => null);
    const alerts = await wx.cached(`alerts:${home.name}`, TTL.obs, () => wx.alerts(home)).catch(() => []);
    const courses = await Promise.all(p.courses.map(async (c) => {
      try {
        const pt = await wx.point({ lat: c.lat, lon: c.lng });
        const [obs, hourly, fc, rain] = await Promise.all([
          wx.cached(`obs:${pt.station}`, TTL.obs, () => wx.observe(pt.station)),
          wx.cached(`hourly:${pt.forecast}`, TTL.hourly, () => wx.hourly(pt.forecast)),
          wx.cached(`fc:${pt.forecast}`, TTL.hourly, () => wx.forecast(pt.forecast)),
          wx.cached(`rain72:${pt.station}`, TTL.rain, () => wx.rainSince(pt.station, 72)),
        ]);
        return { key: c.key, station: pt.station, ...playing(c, obs || homeObs, hourly || [], fc || [], rain, now) };
      } catch (err) {
        console.error(`[golf] ${c.name}: ${err.message}`);
        return { key: c.key, error: true };
      }
    }));
    return { updated: now, home: { name: home.name, obs: homeObs && withDeg(homeObs) }, alerts: alerts || [], courses };
  }
}

const withDeg = (o) => ({ ...o, wdeg: compassDeg(o.wind?.dir) });

// ── how it's playing ──
function playing(c, obs, hourly, fc, rain, now) {
  const o = withDeg(obs || {});
  const temp = o.temp;
  const mph = o.wind?.mph ?? 0;
  const gust = o.gust ?? 0;
  const lines = [];
  const flags = [];

  // the air: density altitude from the course's elevation, the altimeter and the temperature.
  // Golfers here always get the altitude, so carry is measured against a standard day at the
  // course's own elevation (where density altitude equals the elevation): hot, low-pressure
  // days add to it, cold, high-pressure days take it away.
  let carry = null;
  let da = null;
  if (c.elevation != null && temp != null) {
    const pa = c.elevation + (o.pressure != null ? (29.92 - o.pressure) * 1000 : 0);
    const isa = 15 - 1.98 * (pa / 1000);
    da = Math.round(pa + 118.8 * ((temp - 32) * (5 / 9) - isa));
    carry = Math.round(((da - c.elevation) / 1000) * 2 * 10) / 10; // about 2% carry per 1,000 ft
  }

  // firm or soft: the last three days' rain, how dry the air is, how warm and windy
  const r72 = rain?.inches ?? 0;
  const r24 = rainLast(rain, 24);
  const rh = o.rh ?? 30;
  let firm;
  if (temp != null && temp <= 32) firm = { word: 'Frozen', line: 'Frozen turf: the ball bounces like it hit the parking lot.' };
  else if (r24 >= 0.25) firm = { word: 'Wet', line: `Soggy after ${r24}" of rain: plugged lies, and likely cart-path only.` };
  else if (r72 >= 0.25 || r24 >= 0.05) firm = { word: 'Soft', line: `Soft and receptive after ${r72}" this week: approaches will stop fast.` };
  else if (rh < 25 && ((temp ?? 0) >= 75 || mph >= 12)) firm = { word: 'Firm & fast', line: 'Bone dry and firm: drives will run out, so play for the bounce.' };
  else firm = { word: 'Firm', line: 'Dry and firm: expect plenty of roll in the fairways.' };
  lines.push(firm.line);
  const greens = firm.word === 'Wet' || firm.word === 'Soft' ? 'Greens: soft and a touch slow. Be firm with the putter.'
    : firm.word === 'Frozen' ? 'Greens: frosty and hard. Bump and run.'
      : rh < 20 && mph >= 10 ? 'Greens: drying out in the wind and quick. Careful downhill.'
        : 'Greens: smooth and rolling true.';
  lines.push(greens);

  // the wind, in clubs
  if (mph < 6) lines.push('Wind: barely a breath. Scoring conditions!');
  else if (mph < 13) lines.push(`Wind: ${o.wind.dir} ${mph} mph. About a club into it, half a club downwind.`);
  else if (mph < 22) lines.push(`Wind: ${o.wind.dir} ${mph} mph${gust ? `, gusts to ${gust}` : ''}. Two clubs into it; keep it low.`);
  else lines.push(`Wind: ${o.wind.dir} ${mph} mph${gust ? `, gusts to ${gust}` : ''}. A real Duke City blow. Knock it down and hang on.`);

  if (carry != null) {
    if (Math.abs(carry) < 0.5) lines.push('The air: a normal day at this altitude. No carry adjustment.');
    else if (carry > 0) lines.push(`Warm, thin air: the ball carries about ${carry}% more than a normal day up here.`);
    else lines.push(`Cool, heavy air: the ball carries about ${-carry}% less than a normal day up here.`);
  }

  // temperature
  if (temp != null) {
    if (temp < 40) lines.push(`Chilly at ${temp}°: the ball goes shorter in the cold. Layers and a winter ball.`);
    else if (temp < 55) lines.push(`Cool at ${temp}°: a sweater kind of round.`);
    else if (temp <= 85) lines.push(`${temp}° and comfortable: golf weather!`);
    else if (temp <= 95) lines.push(`Warm at ${temp}°: drink water and look for shade.`);
    else lines.push(`Hot at ${temp}°: take a cart, take water, play early.`);
  }

  // what's coming: frost, lightning, rain, dust
  const ahead = hourly.filter((h) => Date.parse(h.start) >= now - 3600e3).slice(0, 36);
  const sun = sunTimes(new Date(now), c.lat, c.lng);
  const tomorrow = sunTimes(new Date(now + 864e5), c.lat, c.lng);
  const frostWindow = (rise) => ahead.filter((h) => Math.abs(Date.parse(h.start) - rise) <= 2 * 3600e3);
  const morning = now < sun.rise.getTime() + 3 * 3600e3 ? { rise: sun.rise.getTime(), word: 'this morning' } : { rise: tomorrow.rise.getTime(), word: 'tomorrow morning' };
  const frostLow = Math.min(...frostWindow(morning.rise).map((h) => h.temp), Infinity);
  if (frostLow <= 33) { flags.push('FROST DELAY'); lines.push(`Frost delay likely ${morning.word} (${frostLow}° near sunrise).`); }
  const storm = ahead.find((h) => /thunder/i.test(h.short) && h.pop >= 20);
  if (storm) { flags.push('LIGHTNING'); lines.push(`Thunderstorms possible around ${clock(storm.start)}: when the horn sounds, head in.`); }
  else {
    const wet = ahead.find((h) => h.pop >= 40);
    if (wet) lines.push(`${wet.pop}% chance of rain around ${clock(wet.start)}: pack the umbrella.`);
  }
  if (gust >= 35 || /dust/i.test(o.text || '')) { flags.push('BLOWING DUST'); lines.push('Blowing dust: sunglasses, and expect sand in the bunkers to drift.'); }
  if ((temp ?? 0) > 95) flags.push('HEAT');

  // the golf index, now and by the hour; the best tee time left today (or tomorrow)
  const index = golfIndex(temp, mph + gust / 3, 0, /thunder/i.test(o.text || ''));
  const hours = ahead.map((h) => ({ ...h, index: golfIndex(h.temp, h.mph, h.pop, /thunder/i.test(h.short)) }));
  const window = (s) => hours.filter((h) => {
    const t = Date.parse(h.start);
    return t >= Math.max(now - 1800e3, s.rise.getTime()) && t <= s.set.getTime() - 4.5 * 3600e3;
  });
  const pool = window(sun).length ? window(sun) : window(tomorrow);
  const best = pool.reduce((a, b) => (!a || (b.index.score ?? 0) > (a.index.score ?? 0) ? b : a), null);

  // the next three days, golfer's view
  const days = fc.filter((p) => p.day && Date.parse(p.start) > now - 6 * 3600e3).slice(0, 3).map((p) => {
    const windMph = Math.max(...(String(p.wind).match(/\d+/g) || ['0']).map(Number));
    return { name: p.name, temp: p.temp, short: p.short, icon: p.icon, pop: p.pop ?? 0, wind: p.wind, wdir: p.wdir,
             index: golfIndex(p.temp, windMph, p.pop ?? 0, /thunder/i.test(p.short)) };
  });

  return {
    obs: o, firm: firm.word, rain72: r72, rain24: r24, carry, da, index, lines, flags,
    hours: hours.slice(0, 36), best: best && { start: best.start, temp: best.temp, mph: best.mph, dir: best.dir, index: best.index },
    days, sun: { rise: sun.rise, set: sun.set },
  };
}

function rainLast(rain, hours) {
  if (!rain) return 0;
  return hours >= 72 ? rain.inches : rain.recent24;
}

// A cheesy 1-to-10 golf index: 75° and still is a 10.
function golfIndex(temp, mph, pop, thunder) {
  if (temp == null) return { score: null, word: 'N/A' };
  let s = 10 - Math.abs(temp - 75) / 7 - Math.max(0, mph - 6) / 2.5 - (pop || 0) / 12 - (thunder ? 3 : 0) - (temp < 45 ? 1.5 : 0);
  s = Math.max(1, Math.min(10, Math.round(s)));
  return { score: s, word: s >= 9 ? 'Excellent' : s >= 7 ? 'Good' : s >= 5 ? 'Fair' : 'Poor' };
}

function clock(iso) {
  const d = new Date(iso);
  const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric' }).format(d);
  return local.replace(' ', ' ');
}
