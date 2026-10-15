// The Weather Channel, drawn the way the WeatherStar 4000 drew the local forecast in
// the '90s: the logo tile, an orange title band and the clock up top, a blue bar of
// current conditions along the bottom, and a loop of pages in between. Current
// conditions, observations, radar, the local and extended forecast, the regional
// map and the almanac, live from the National Weather Service via the box server.
// The loop runs off the wall clock, so every screen in the house is on the same page.
import { wxIcon, WX_DEFS, ICON_WORDS } from './wxicons.js';
import { sunTimes, moonPhases } from './wxastro.js';

const DATA_MS = 2 * 60e3;
const RADAR_MS = 5 * 60e3;
const LINE_MS = 4000;
const MAP_TOP = 72;
const MAP_W = 640;
const MAP_H = 320;
const LF_LINES = 7;

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// State lines and the border with Mexico, as [lon, lat] polylines.
const BORDERS = [
  [[-109.05, 37], [-103, 37], [-103, 36.5], [-103.04, 36.5], [-103.06, 32], [-106.62, 32], [-106.53, 31.78],
    [-108.21, 31.78], [-108.21, 31.33], [-109.05, 31.33], [-109.05, 37]],
  [[-109.05, 37], [-109.05, 41]],
  [[-114.05, 37], [-109.05, 37]],
  [[-103, 37], [-94.6, 37]],
  [[-102.04, 37], [-102.04, 41]],
  [[-103, 36.5], [-100, 36.5], [-100, 34.56], [-99.5, 34.41], [-99, 34.21], [-98.5, 34.13], [-98, 33.9], [-97.5, 33.86], [-97, 33.75]],
  [[-109.05, 31.33], [-111.07, 31.33], [-114.81, 32.49]],
  [[-106.53, 31.78], [-106.2, 31.47], [-105.85, 31.25], [-105.4, 30.95], [-104.9, 30.6], [-104.6, 30]],
];

// NWS's radar ramp runs blue (barely anything) through cyan, green, yellow and red
// to magenta; the WeatherStar showed light green, darker greens, yellow, orange and
// reds. Map by hue.
function starRadar(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return null;
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue >= 210 && hue < 260) return null; // the faintest returns
  if (hue >= 165 && hue < 210) return [49, 210, 22];
  if (hue >= 125 && hue < 165) return [28, 138, 18];
  if (hue >= 85 && hue < 125) return [20, 90, 15];
  if (hue >= 50 && hue < 85) return [196, 179, 70];
  if (hue >= 25 && hue < 50) return [190, 72, 19];
  if (hue < 25 || hue >= 340) return [171, 14, 14];
  return [115, 31, 4];
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deg = (v) => (v == null ? 'N/A' : `${v}°`);
export const time12 = (d, secs = false) => {
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = secs ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
  return `${h}:${m}${s} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};
// where to try a map label, nearest first: on the city, then nudged further out
const OFFSETS = [];
for (const dy of [0, -16, 16, -32, 32, -48, 48]) for (const dx of [0, -24, 24, -48, 48, -72, 72]) OFFSETS.push([dx, dy]);
OFFSETS.sort((a, b) => (a[0] ** 2 + (a[1] * 1.5) ** 2) - (b[0] ** 2 + (b[1] * 1.5) ** 2));

// The forecast area's wall clock (the channel reads Mountain time even on a box set
// to another zone): a Date whose local fields are the time in tz.
const zoneFormats = new Map();
export function zoned(date, tz) {
  if (!tz) return date;
  let f = zoneFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    zoneFormats.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, +x.value]));
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// text width in the screen's fonts, for wrapping and laying out map labels
const measure = (() => {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
})();
const BODY_FONT = '700 20px Verdana, "DejaVu Sans", sans-serif';
const CRAWL_PX = 85; // horoscope crawl speed, pixels per second

// ── transitions ──
// Video-toaster page changes: wipes, irises, the star wipe, blinds, a clock sweep,
// spins and flips. The clock picks one, so every screen gets the same. Most bring
// the new page in over the old; a few move both, and 'shrink' sends the old one
// spinning away to reveal the new page underneath.
const FX = ['wipe-right', 'star', 'push', 'iris', 'blinds', 'spin', 'wipe-down', 'clock', 'barn', 'drop',
  'diamond', 'flip', 'checker', 'diagonal', 'shrink', 'fade'];
const BOTH = new Set(['push', 'flip']);
const UNDER = new Set(['shrink']);
const TITLE_FX = ['zoom', 'slide', 'drop', 'flip', 'type'];

function hash(n) {
  let h = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

// The wipes that need geometry (star, diamond, blinds...) are clip-path polygons,
// built here once; the rest live in tivo.css.
(function installWipes() {
  if (document.getElementById('wx-wipes')) return;
  const px = (pts) => `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
  const star = (r) => px(Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    return [320 + rr * Math.cos(a), 240 + rr * Math.sin(a)];
  }));
  const diamond = (r) => px([[320, 240 - r], [320 + r, 240], [320, 240 + r], [320 - r, 240]]);
  const blinds = (h) => px(Array.from({ length: 8 }, (_, i) => [[0, i * 60], [640, i * 60], [640, i * 60 + h], [0, i * 60 + h]]).flat());
  const rule = (name, from, to) => `@keyframes wx-${name} { from { clip-path: ${from}; } to { clip-path: ${to}; } }
    .wx-page.fx-in-${name} { animation: wx-${name} 1.1s ease-in-out both; }`;
  const style = document.createElement('style');
  style.id = 'wx-wipes';
  style.textContent = [
    rule('star', star(0), star(1150)),
    rule('diamond', diamond(0), diamond(600)),
    rule('blinds', blinds(0), blinds(60)),
    rule('barn', px([[320, 0], [320, 0], [320, 480], [320, 480]]), px([[0, 0], [640, 0], [640, 480], [0, 480]])),
    rule('diagonal', px([[0, 0], [0, 0], [0, 0]]), px([[0, 0], [1280, 0], [0, 960]])),
  ].join('\n');
  document.head.append(style);
  try { CSS.registerProperty({ name: '--wx-sweep', syntax: '<angle>', inherits: false, initialValue: '0deg' }); } catch { /* already */ }
})();
const CITY_FONT = '700 21px "Arial Narrow", "Nimbus Sans Narrow", "Liberation Sans Narrow", sans-serif';

export class WeatherStar {
  constructor(el) {
    this.el = el;
    this.data = null;
    this.version = 0;
    this.radar = null;
    this.el.innerHTML = `
      <svg class="wx-defs" width="0" height="0" aria-hidden="true"><defs>${WX_DEFS}</defs></svg>
      <div class="wx-page cur"></div>
      <div class="wx-band"></div>
      <img class="wx-logo" src="assets/logos/TWC.svg" alt="">
      <div class="wx-title"></div>
      <div class="wx-clock"><div class="wx-time"></div><div class="wx-date"></div></div>
      <div class="wx-bar"><div class="wx-line"></div>
        <div class="wx-crawl"><div class="wx-crawl-label">Horoscopes</div><div class="wx-crawl-view"><div class="wx-crawl-text"></div></div></div>
      </div>`;
    this.$ = (s) => this.el.querySelector(s);
  }

  // next time on screen, draw the page fresh instead of transitioning into it
  reset() { this.shown = this.pageKey = null; }

  // called every frame while the channel is on screen
  update(id, program, now, paused) {
    if (this.program !== program) {
      this.id = id;
      this.program = program;
      this.data = null;
      this.fetchedAt = this.radarAt = 0;
      this.shown = null;
    }
    if (!this.fetchedAt || now - this.fetchedAt > DATA_MS) this.load(now);
    if (now - this.radarAt > RADAR_MS) this.loadRadar(now);
    this.el.classList.add('on');
    this.el.classList.toggle('paused', paused); // a paused TiVo holds the picture, mid-wipe and all
    if (paused) return;

    const local = zoned(new Date(now), program.tz);
    const pagesKey = `${this.version}:${Math.floor(now / 60e3)}`;
    if (this.pagesKey !== pagesKey) {
      this.pagesKey = pagesKey;
      this.pageList = this.pages(local, new Date(now));
    }
    const pages = this.pageList;
    const total = pages.reduce((n, p) => n + p.ms, 0);
    let t = now % total;
    const page = pages.find((p) => (t -= p.ms) < 0) || pages[0];
    const key = `${page.key}:${this.version}`;
    if (this.shown !== key) {
      this.shown = key;
      if (this.pageKey === page.key) {
        // same page, fresh data
        const cur = this.$('.wx-page.cur');
        cur.innerHTML = page.render();
        page.after?.(cur);
      } else {
        const started = Math.round((now - (t + page.ms)) / 1000);
        const h = hash(started);
        let fx = this.pageKey == null ? null : FX[h % FX.length];
        if (fx && fx === this.lastFx) fx = FX[(h + 1) % FX.length]; // never the same one twice running
        this.lastFx = fx;
        this.pageKey = page.key;
        const title = this.$('.wx-title');
        title.className = `wx-title${page.title.length > 1 ? ' two' : ''}`;
        title.innerHTML = page.title.map((l) => `<div>${esc(l)}</div>`).join('');
        if (fx) { void title.offsetWidth; title.classList.add(`t-${TITLE_FX[(h >>> 8) % TITLE_FX.length]}`); }
        const logo = this.$('.wx-logo');
        logo.classList.remove('spin');
        if (fx && (h >>> 16) % 4 === 0) { void logo.offsetWidth; logo.classList.add('spin'); }
        this.swap(page, fx);
      }
    }
    this.crawl(now);
    const sec = Math.floor(now / 1000);
    if (this.sec !== sec) {
      this.sec = sec;
      const d = local;
      this.$('.wx-time').textContent = time12(d, true);
      this.$('.wx-date').textContent = `${DAYS[d.getDay()].slice(0, 3)} ${MONTHS[d.getMonth()]} ${d.getDate()}`.toUpperCase();
      const lines = this.barLines();
      this.$('.wx-line').textContent = lines[Math.floor(now / (this.lineMs || LINE_MS)) % lines.length];
    }
  }

  // Put a page on screen with a transition from the one before it.
  swap(page, fx) {
    for (const stale of this.el.querySelectorAll('.wx-page.leaving')) stale.remove();
    const old = this.$('.wx-page.cur');
    const layer = document.createElement('div');
    layer.className = 'wx-page cur';
    layer.innerHTML = page.render();
    if (!fx) {
      old.replaceWith(layer);
      page.after?.(layer);
      return;
    }
    old.classList.replace('cur', 'leaving');
    if (UNDER.has(fx)) old.before(layer); else old.after(layer);
    page.after?.(layer);
    if (!UNDER.has(fx)) layer.classList.add(`fx-in-${fx}`);
    if (UNDER.has(fx) || BOTH.has(fx)) old.classList.add(`fx-out-${fx}`);
    const mover = UNDER.has(fx) ? old : layer;
    const done = (e) => {
      if (e && e.target !== mover) return;
      mover.removeEventListener('animationend', done);
      old.remove();
      layer.classList.remove(`fx-in-${fx}`);
    };
    mover.addEventListener('animationend', done);
  }

  // Today's horoscopes crawling along the bottom, right to left.
  crawl(now) {
    const text = this.crawlText();
    const view = this.$('.wx-crawl');
    view.classList.toggle('on', !!text);
    if (!text) return;
    const el = this.$('.wx-crawl-text');
    if (el.dataset.text !== text) {
      el.dataset.text = text;
      el.textContent = text;
      this.crawlW = 0;
    }
    if (!this.crawlW) this.crawlW = el.offsetWidth;
    const span = this.crawlW + view.querySelector('.wx-crawl-view').offsetWidth;
    if (!span) return;
    const x = view.querySelector('.wx-crawl-view').offsetWidth - ((now / 1000) * (this.crawlPx || CRAWL_PX)) % span;
    el.style.transform = `translateX(${x.toFixed(0)}px)`;
  }

  crawlText() {
    const stars = this.data?.horoscopes || [];
    if (!stars.length) return '';
    return stars.map((h) => `${h.sign} (${h.dates}): ${h.text}`).join('   ***   ').toUpperCase();
  }

  load(now) {
    this.fetchedAt = now;
    fetch(`api/weather?id=${encodeURIComponent(this.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) { this.data = data; this.version++; } })
      .catch(() => {});
  }

  // Radar comes as a small PNG in NWS colors; repaint it in the WeatherStar's.
  loadRadar(now) {
    this.radarAt = now;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 100) { d[i + 3] = 0; continue; }
        const rgb = starRadar(d[i], d[i + 1], d[i + 2]);
        if (!rgb) { d[i + 3] = 0; continue; }
        [d[i], d[i + 1], d[i + 2], d[i + 3]] = [...rgb, 255];
      }
      this.radar = px;
      this.version++;
    };
    img.src = `api/radar?id=${encodeURIComponent(this.id)}&t=${now}`;
  }

  zoned(t) { return zoned(new Date(t), this.program.tz); }

  get home() { return this.data?.cities.find((c) => c.name === this.data.home); }

  // ── the loop ──
  pages(now, real) {
    const home = this.home;
    const name = this.program.home;
    const pages = [
      { key: 'cc', title: ['Current Conditions'], ms: 10000, render: () => this.currentConditions() },
      { key: 'obs1', title: ['Regional Observations'], ms: 10000, render: () => this.observations('north') },
      { key: 'obs2', title: ['Regional Observations'], ms: 10000, render: () => this.observations('state') },
      { key: 'radar', title: ['Local Radar'], ms: 10000, map: true, render: () => this.radarMap(), after: (layer) => this.paintRadar(layer) },
    ];
    this.localForecastPages().forEach((lines, i) => pages.push({
      key: `lf${i}`, title: ['Local Forecast'], ms: 9000, noaa: true, render: () => this.localForecast(lines),
    }));
    const days = this.extendedDays(now);
    for (let i = 0; i < Math.max(1, Math.ceil(days.length / 3)) && i < 2; i++) {
      pages.push({ key: `ext${i}`, title: [name, 'Extended Forecast'], ms: 10000, render: () => this.extended(days.slice(i * 3, i * 3 + 3)) });
    }
    const period = home?.fc?.find((p) => p.day);
    const day = period ? DAYS[this.zoned(period.start).getDay()] : DAYS[now.getDay()];
    pages.push({ key: 'north', title: [`${day}'s`, 'Forecast'], ms: 10000, map: true, render: () => this.forecastMap('radar', 'radar') });
    pages.push({ key: 'region', title: [`${day}'s`, 'Regional Forecast'], ms: 10000, map: true, render: () => this.forecastMap('region', 'region') });
    pages.push({ key: 'almanac', title: ['Almanac'], ms: 10000, render: () => this.almanac(now, real) });
    return pages;
  }

  barLines() {
    const h = this.home;
    const o = h?.obs;
    if (!o) return [`Conditions at ${this.program.home}`, 'Updating the forecast'];
    const lines = (this.data.alerts || []).map((a) => `* ${a.event} *`);
    lines.push(`Conditions at ${h.name}`, o.text || 'N/A', `Temp: ${deg(o.temp)}F`,
      `Humidity: ${o.rh ?? 'N/A'}%   Dewpoint: ${deg(o.dew)}F`,
      `Barometric Pressure: ${o.pressure != null ? `${o.pressure.toFixed(2)} ${o.trend}`.trim() : 'N/A'}`,
      `Wind: ${windText(o)}`,
      `Visib: ${visText(o.vis)}  Ceiling: ${ceilText(o.ceiling)}`);
    if (o.chill != null && o.chill < o.temp) lines.push(`Wind Chill: ${o.chill}°F`);
    if (o.heat != null && o.heat > o.temp) lines.push(`Heat Index: ${o.heat}°F`);
    return lines;
  }

  // ── pages ──
  currentConditions() {
    const h = this.home;
    const o = h?.obs;
    if (!o) return `<div class="wx-panel blue"><div class="wx-wait">Updating current conditions</div></div>`;
    const extra = o.chill != null && o.chill < o.temp ? ['Wind Chill:', `${o.chill}°`]
      : o.heat != null && o.heat > o.temp ? ['Heat Index:', `${o.heat}°`] : null;
    const rows = [
      ['Humidity:', `${o.rh ?? 'N/A'}%`], ['Dewpoint:', deg(o.dew)], ['Ceiling:', ceilText(o.ceiling)],
      ['Visibility:', visText(o.vis)], ['Pressure:', o.pressure != null ? `${o.pressure.toFixed(2)} ${o.trend}` : 'N/A'],
      ...(extra ? [extra] : []),
    ];
    return `<div class="wx-panel blue cc">
      <div class="cc-temp">${deg(o.temp)}</div>
      <div class="cc-cond">${esc(shortCond(o.text, o.icon))}</div>
      <div class="cc-icon">${wxIcon(o.icon, 104)}</div>
      <div class="cc-wind">Wind: ${esc(o.wind?.mph ? `${o.wind.dir} ${o.wind.mph}` : 'Calm')}</div>
      ${o.gust ? `<div class="cc-gust">Gusts to ${o.gust}</div>` : ''}
      <div class="cc-city">${esc(h.name)}</div>
      <div class="cc-rows">${rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
    </div>`;
  }

  observations(group) {
    const rows = (this.data?.cities || []).filter((c) => c.groups.includes(group)).slice(0, 7);
    return `<div class="wx-panel navy obs">
      <div class="obs-head"><span class="w">WEATHER</span><span class="f">°F</span></div>
      ${rows.map((c) => `<div class="obs-row"><span class="c">${esc(c.name.toUpperCase())}</span>`
        + `<span class="w">${esc(c.obs ? abbr(c.obs.text, c.obs.day) : 'N/A')}</span>`
        + `<span class="f">${c.obs?.temp ?? ''}</span></div>`).join('')}
    </div>`;
  }

  localForecastPages() {
    const h = this.home;
    if (!h?.fc) return [['THE LOCAL FORECAST IS BEING UPDATED.']];
    const lines = [];
    for (const a of this.data.alerts || []) lines.push({ center: `* ${a.event.toUpperCase()} *` });
    if (lines.length) lines.push('');
    for (const p of h.fc.slice(0, 4)) {
      const words = `${p.name.toUpperCase()}...${p.detail.toUpperCase()}`.split(/\s+/);
      let line = '';
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (line && measure(next, BODY_FONT) > 486) { lines.push(line); line = w; } else line = next;
      }
      if (line) lines.push(line);
    }
    // whole periods per page where possible: three pages at most, like the real loop
    const pages = [];
    for (let i = 0; i < lines.length && pages.length < 3; i += LF_LINES) pages.push(lines.slice(i, i + LF_LINES));
    return pages;
  }

  localForecast(lines) {
    return `<div class="wx-panel blue lf">${lines.map((l) => (typeof l === 'object'
      ? `<div class="lf-line c">${esc(l.center)}</div>` : `<div class="lf-line">${esc(l) || '&nbsp;'}</div>`)).join('')}</div>`
      + '<div class="wx-noaa">' + NOAA + '</div>';
  }

  extendedDays(now) {
    const fc = this.home?.fc;
    if (!fc) return [];
    const out = [];
    fc.forEach((p, i) => {
      const start = this.zoned(p.start);
      if (!p.day || sameDay(start, now)) return;
      const night = fc[i + 1] && !fc[i + 1].day ? fc[i + 1] : null;
      out.push({ day: DAYS[start.getDay()].slice(0, 3).toUpperCase(), icon: p.icon, words: forecastWords(p.short, p.icon),
                 hi: p.temp, lo: night?.temp });
    });
    return out.slice(0, 6);
  }

  extended(days) {
    if (!days.length) return `<div class="wx-panel blue"><div class="wx-wait">Updating the extended forecast</div></div>`;
    return days.map((d, i) => `<div class="ext-day" style="left:${48 + i * 190}px">
      <div class="ext-name">${d.day}</div>
      <div class="ext-icon">${wxIcon(d.icon, 84)}</div>
      <div class="ext-words">${d.words.map((w) => `<div>${esc(w)}</div>`).join('')}</div>
      <div class="ext-temps"><div><span class="lo">Lo</span><b>${d.lo ?? ''}</b></div><div><span class="hi">Hi</span><b>${d.hi ?? ''}</b></div></div>
    </div>`).join('');
  }

  // ── maps ──
  mapSvg(bbox) {
    const [w, s, e, n] = bbox;
    const proj = (lon, lat) => [((lon - w) / (e - w)) * MAP_W, ((n - lat) / (n - s)) * MAP_H];
    const lines = BORDERS.map((line) => `<path d="M${line.map((p) => proj(...p).map((v) => v.toFixed(1)).join(',')).join('L')}"/>`).join('');
    return {
      proj,
      svg: `<svg class="wx-map" viewBox="0 0 ${MAP_W} ${MAP_H}" width="${MAP_W}" height="${MAP_H}" style="top:${MAP_TOP}px">
        <rect width="${MAP_W}" height="${MAP_H}" fill="#75717c"/>
        <g fill="none" stroke="#08070c" stroke-width="2.4" stroke-linejoin="round">${lines}</g></svg>`,
    };
  }

  // Lay out city labels without overlaps, nudging each a little if it collides;
  // cities are in priority order, and one that can't fit is left off.
  placeLabels(cities, proj, size) {
    const boxes = [];
    const out = [];
    for (const c of cities) {
      const [x, y] = proj(c.lon, c.lat);
      const { w, h } = size(c);
      for (const [dx, dy] of OFFSETS) {
        const b = { x: x + dx - w / 2, y: y + dy - h / 2, w, h };
        // clear of the logo tile in the corner and the bar along the bottom
        if (b.x < 6 || b.x + w > MAP_W - 6 || b.y < (b.x < 156 ? 30 : 6) || b.y + h > MAP_H - 4) continue;
        if (boxes.some((o) => b.x < o.x + o.w + 4 && o.x < b.x + w + 4 && b.y < o.y + o.h && o.y < b.y + h)) continue;
        boxes.push(b);
        out.push({ c, b });
        break;
      }
    }
    return out;
  }

  radarMap() {
    const bbox = this.program.maps.radar;
    const { proj, svg } = this.mapSvg(bbox);
    const cities = this.program.cities.filter((c) => c.groups.includes('radar'));
    const labels = this.placeLabels(cities, proj, (c) => ({ w: measure(c.name, CITY_FONT) + 4, h: 24 }));
    return `${svg}<canvas class="wx-radar" width="${this.program.radar.w}" height="${this.program.radar.h}" style="top:${MAP_TOP}px"></canvas>
      ${labels.map(({ c, b }) => `<div class="wx-label" style="left:${b.x.toFixed(0)}px;top:${(b.y + MAP_TOP).toFixed(0)}px">${esc(c.name)}</div>`).join('')}`;
  }

  paintRadar(layer) {
    const canvas = layer.querySelector('.wx-radar');
    if (canvas && this.radar) canvas.getContext('2d').putImageData(this.radar, 0, 0);
  }

  // forecast highs (or tonight's lows) with icons on a map
  forecastMap(bbox, group) {
    const { proj, svg } = this.mapSvg(this.program.maps[bbox]);
    const cities = (this.data?.cities || []).filter((c) => c.groups.includes(group) && c.fc?.length);
    const period = (c) => c.fc.find((p) => p.day);
    const labels = this.placeLabels(cities, proj, (c) => ({ w: Math.max(measure(c.name, CITY_FONT) + 4, 88), h: 58 }));
    return `${svg}${labels.map(({ c, b }) => {
      const p = period(c);
      return `<div class="wx-city" style="left:${b.x.toFixed(0)}px;top:${(b.y + MAP_TOP).toFixed(0)}px;width:${b.w.toFixed(0)}px">
        <div class="n">${esc(c.name)}</div><div class="v"><span class="t">${p?.temp ?? ''}</span>${wxIcon(p?.icon, 38)}</div></div>`;
    }).join('')}`;
  }

  almanac(now, real) {
    const home = this.program.cities.find((c) => c.name === this.program.home);
    const days = [now, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)];
    const sun = days.map((d) => sunTimes(d, home.lat, home.lon));
    const fmt = (d) => (d ? time12(this.zoned(d)).toLowerCase() : 'N/A');
    const phases = moonPhases(real, 4).map((p) => ({ ...p, date: this.zoned(p.date) }));
    return `<div class="wx-panel blue alm">
      <div class="alm-days">${days.map((d) => `<span>${DAYS[d.getDay()]}</span>`).join('')}</div>
      <div class="alm-row"><span class="k">Sunrise:</span>${sun.map((s) => `<span>${fmt(s.rise)}</span>`).join('')}</div>
      <div class="alm-row"><span class="k">Sunset:</span>${sun.map((s) => `<span>${fmt(s.set)}</span>`).join('')}</div>
      <div class="alm-moon-head">Moon Data:</div>
      <div class="alm-moons">${phases.map((p) => `<div><div class="p">${p.phase}</div>${moonDisc(p.phase)}`
        + `<div class="d">${MONTHS[p.date.getMonth()]} ${p.date.getDate()}</div></div>`).join('')}</div>
    </div>`;
  }
}

// ── words ──
function windText(o) {
  if (!o.wind) return 'N/A';
  if (!o.wind.mph) return 'Calm';
  return `${o.wind.dir} ${o.wind.mph} MPH${o.gust ? ` G ${o.gust}` : ''}`;
}
const visText = (v) => (v == null ? 'N/A' : `${v} mi.`);
const ceilText = (c) => (c == null ? 'Unlimited' : `${c.toLocaleString('en-US')} ft.`);

// The observation lists' abbreviations
function abbr(text, day) {
  const t = (text || '').toLowerCase();
  if (!t) return 'N/A';
  if (/thunder/.test(t)) return "T'STORM";
  if (/freezing/.test(t)) return 'FRZ RAIN';
  if (/sleet|ice pellets/.test(t)) return 'SLEET';
  if (/snow/.test(t) && /rain/.test(t)) return 'RAIN/SNOW';
  if (/blowing snow/.test(t)) return 'BLW SNOW';
  if (/snow/.test(t)) return /light/.test(t) ? 'LGT SNOW' : /heavy/.test(t) ? 'HVY SNOW' : 'SNOW';
  if (/drizzle/.test(t)) return 'DRIZZLE';
  if (/shower/.test(t)) return 'SHOWERS';
  if (/rain/.test(t)) return /light/.test(t) ? 'LGT RAIN' : /heavy/.test(t) ? 'HVY RAIN' : 'RAIN';
  if (/fog|mist/.test(t)) return 'FOG';
  if (/smoke/.test(t)) return 'SMOKE';
  if (/haze/.test(t)) return 'HAZE';
  if (/dust|sand/.test(t)) return 'DUST';
  if (/wind|breez/.test(t)) return 'WINDY';
  if (/overcast|^cloudy/.test(t)) return 'CLOUDY';
  if (/mostly cloudy/.test(t)) return 'M CLOUDY';
  if (/partly cloudy|partly sunny/.test(t)) return 'P CLOUDY';
  if (/mostly clear|mostly sunny|fair|few/.test(t)) return day ? 'M SUNNY' : 'M CLEAR';
  return day ? 'SUNNY' : 'CLEAR';
}

// a condition short enough for the current-conditions page
function shortCond(text, icon) {
  const t = (text || '').replace(/ and /gi, '/').replace(/Thunderstorm/gi, "T'Storm");
  return t.length <= 16 ? t : ICON_WORDS[icon] || t.slice(0, 16);
}

// NWS's short forecast in the extended forecast's two short lines
function forecastWords(text, icon) {
  const parts = (text || '').split(/ then /i);
  let t = parts.find((x) => /rain|snow|shower|storm|sleet|drizzle|fog|wind|breez|dust/i.test(x)) || parts[0] || '';
  t = t.replace(/Showers And Thunderstorms|Thunderstorms/gi, "T'Storms")
    .replace(/Rain Showers/gi, 'Showers').replace(/Areas Of /gi, '').replace(/Patchy /gi, '')
    .replace(/(Rain And Snow|Snow And Rain)( Showers)?/gi, 'Rain/Snow')
    .replace(/^Slight Chance /i, 'Isolated ').replace(/^Chance /i, 'Scattered ').trim();
  if (icon === 'wind' && !/wind|breez/i.test(t)) t = `${t} and Windy`;
  const lines = wrapWords(t, 12);
  return lines && lines.length <= 2 ? lines : wrapWords(ICON_WORDS[icon] || 'Cloudy', 12).slice(0, 2);
}

function wrapWords(text, max) {
  const lines = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (w.length > max) return null;
    const last = lines[lines.length - 1];
    if (last && last.length + 1 + w.length <= max) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines;
}

function moonDisc(phase) {
  const lit = '#f3ecb4';
  const dark = '#3b3a4c';
  const half = (side) => `<path d="M30,4 A26,26 0 0,${side} 30,56 Z" fill="${lit}"/>`;
  const fill = phase === 'Full' ? `<circle cx="30" cy="30" r="26" fill="${lit}"/>`
    : phase === 'First' ? half(1) : phase === 'Last' ? half(0) : '';
  return `<svg class="moon" viewBox="0 0 60 60" width="56" height="56"><circle cx="30" cy="30" r="26" fill="${dark}"/>${fill}
    <circle cx="30" cy="30" r="26" fill="none" stroke="#111" stroke-width="2.5"/></svg>`;
}

// NOAA's emblem, beside "Local Forecast" as on the real screen
const NOAA = `<svg viewBox="0 0 40 40" width="34" height="34">
  <circle cx="20" cy="20" r="18.5" fill="#1b3c9c" stroke="#e8ecff" stroke-width="2"/>
  <path d="M2.5,22 C10,17 15,25 20,19 C25,13 31,21 37.5,17 A18,18 0 0,1 2.5,22 Z" fill="#62a8f0"/>
  <path d="M6,20.5 C11,16.5 15,22 20,17.5 C25,12.5 30,18.5 35,15.5 C30,14 26,10.5 20,15 C15,19 11,14.5 6,20.5 Z" fill="#fff"/>
</svg>`;
