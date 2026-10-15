// The golf weather channel (channel 8, Dirty's Golf Weather in the sample lineup): golf
// weather for a city's courses, in the same '90s cable-graphics style as The Weather
// Channel on 362, in black and white. Its name and logo come from GOLF_WEATHER. It is the WeatherStar's loop (wall-clock pages, video-toaster wipes, the
// title effects, the crawl), taken slower: the conditions, then every hole of every course
// in order, each flown over in crisp vectors drawn from OpenStreetMap's map of the course
// with the weather on top, and full-screen pages between the courses (how it's playing, and
// now and then an easter egg: the beverage cart's "live" GPS, or the best holes to take a
// piss). Then tee times, the outlook and daylight.
// The weather comes from golf.js on the box server, live from the National Weather Service;
// plays-like yardages are worked out here from the hole and the wind right now. The easter
// eggs are drawn at random each time around the loop (the same on every screen).
import { WeatherStar, esc, time12, zoned, DAYS, MONTHS } from './weatherstar.js';
import { wxIcon, WX_DEFS } from './wxicons.js';
import { seeded } from './schedule.js';

const FLY_W = 640;
const FLY_H = 312;
const FRAME_MS = 33; // the flyovers redraw at about 30 frames a second
const MS = { intro: 12000, cc: 15000, playing: 16000, hole: 22000, card: 12000, between: 16000, tee: 18000, outlook: 16000, daylight: 14000 };

// the course in a '90s golf video game's colors
const C = {
  desert: '#c9b48c', rough: '#3d8b3a', grass: '#4f9a40', wood: '#1f5c25', water: '#2f7fe0', waterEdge: '#9fd2ff',
  fairway: '#68c04a', stripe: '#77cd58', range: '#62b846', tee: '#86d964', green: '#93ea6c', fringe: '#5cb845',
  bunker: '#f2e2a8', bunkerEdge: '#a8894f', path: '#dcd6c6', tree: '#1c5a22', treeLit: '#2f7a33', clubhouse: '#b4553b',
};

// what the beverage cart might have on it today
const MENU = ['Coors Light', 'Michelob Ultra', 'Modelo', 'Bud Light', 'Topo Chico', 'Gatorade', 'Bottled water',
  'Breakfast burritos', 'Green chile cheeseburgers', 'Frito pie', 'Hot dogs', 'Sunflower seeds', 'Peanut M&Ms', 'Big Jim peanuts'];

export class GolfWeather extends WeatherStar {
  constructor(el) {
    super(el);
    this.el.classList.add('golf');
    this.el.innerHTML = `
      <svg class="wx-defs" width="0" height="0" aria-hidden="true"><defs>${WX_DEFS}</defs></svg>
      <div class="wx-page cur"></div>
      <div class="wx-band"></div>
      <img class="wx-logo" alt="">
      <div class="wx-title"></div>
      <div class="wx-clock"><div class="wx-time"></div><div class="wx-date"></div></div>
      <div class="wx-bar"><div class="wx-line"></div>
        <div class="wx-crawl"><div class="wx-crawl-label">Course Report</div><div class="wx-crawl-view"><div class="wx-crawl-text"></div></div></div>
      </div>`;
    this.lineMs = 6500; // the bottom bar's lines, and the crawl, unhurried
    this.crawlPx = 58;
    this.maps = new Map(); // each course's map, built into canvas paths once
  }

  loadRadar() { this.radarAt = Infinity; } // no radar on this channel

  // called every frame: the WeatherStar's loop, then whatever moves on the page
  update(id, program, now, paused) {
    super.update(id, program, now, paused);
    if (paused || !this.pageList) return;
    const pages = this.pageList;
    const total = pages.reduce((n, p) => n + p.ms, 0);
    let t = now % total;
    const page = pages.find((p) => (t -= p.ms) < 0) || pages[0];
    if (!page.tick || this.pageKey !== page.key) return;
    const layer = this.$('.wx-page.cur');
    if (layer) page.tick(layer, (t + page.ms) / page.ms, now);
  }

  course(key) { return this.data?.courses?.find((c) => c.key === key && !c.error); }
  get courses() { return this.program.courses; }
  // the course reports nearest the Sunport, for the citywide pages
  get city() { return this.course('puerto') || this.data?.courses?.find((c) => !c.error); }
  local(t) { return zoned(new Date(t), this.program.tz); }

  // ── the loop ──
  pages(now, real) {
    // the channel's own name and logo (GOLF_WEATHER in tools/channels.py)
    const logo = this.$('.wx-logo');
    if (this.program.logo && logo.getAttribute('src') !== `assets/logos/${this.program.logo}`) logo.setAttribute('src', `assets/logos/${this.program.logo}`);
    const pages = [
      { key: 'intro', title: [this.program.name || 'Golf Weather'], ms: MS.intro, render: () => this.intro() },
      { key: 'cc', title: ['Albuquerque', 'Golf Conditions'], ms: MS.cc, render: () => this.conditions() },
    ];
    const between = [];
    this.courses.forEach((c) => {
      pages.push({ key: `play-${c.key}`, title: ["How It's Playing", c.name], ms: MS.playing, render: () => this.playing(c) });
      // every hole, in order: flown along its line where it's mapped; where it isn't, its
      // card over a sweep down the course
      const sweep = this.flyFrame(c, null);
      const unmapped = c.holes.filter((h) => !h.line);
      for (const hole of c.holes) {
        const title = [c.name, `Hole ${hole.n} · Par ${hole.par}`];
        if (hole.line) {
          const fr = this.flyFrame(c, hole);
          pages.push({ key: `fly-${c.key}-${hole.n}`, title, ms: MS.hole, render: () => this.flyover(c, hole, fr),
                       after: (layer) => this.sizeCanvas(layer), tick: (layer, f) => this.draw(layer, c, this.camera(fr, f), (x) => this.holeMarks(x, fr)) });
        } else {
          const i = unmapped.indexOf(hole);
          pages.push({ key: `card-${c.key}-${hole.n}`, title, ms: MS.card, render: () => this.flyover(c, hole, null),
                       after: (layer) => this.sizeCanvas(layer), tick: (layer, f) => this.draw(layer, c, this.sweepCam(sweep, (i + f) / unmapped.length)) });
        }
      }
      // a full-screen page between courses: an easter egg now and then
      const page = { key: '', title: [], ms: MS.between, course: c };
      between.push(page);
      pages.push(page);
    });
    pages.push({ key: 'tee', title: ['Tee Time', 'Forecast'], ms: MS.tee, render: () => this.teeTimes(real) });
    pages.push({ key: 'outlook', title: ['3-Day', 'Golf Outlook'], ms: MS.outlook, render: () => this.outlook() });
    pages.push({ key: 'daylight', title: ['Daylight &', 'Tee Times'], ms: MS.daylight, render: () => this.daylight() });

    // the eggs: drawn fresh each time around the loop (the same draw on every screen)
    const total = pages.reduce((n, p) => n + p.ms, 0);
    const loop = Math.floor(real.getTime() / total);
    const rand = seeded(`dirtys:${loop}`);
    const kinds = between.map(() => { const r = rand(); return r < 0.27 ? 'cart' : r < 0.54 ? 'piss' : 'chart'; });
    if (!kinds.some((k) => k !== 'chart')) kinds[Math.floor(rand() * kinds.length)] = rand() < 0.5 ? 'cart' : 'piss';
    between.forEach((page, i) => {
      const r = seeded(`dirtys:${loop}:${i}`);
      const kind = kinds[i];
      const c = page.course;
      page.key = `between-${i}-${kind}-${loop}`;
      if (kind === 'cart') {
        const egg = this.cartRun(r);
        page.title = ['Bev Cart', 'Live GPS'];
        page.render = () => this.cartPage(egg);
        page.after = (layer) => this.sizeCanvas(layer);
        page.tick = (layer, f, t) => this.cartDraw(layer, egg, f, t);
      } else if (kind === 'piss') {
        const egg = this.pissReport(r);
        page.title = ['Best Holes to', 'Take a Piss'];
        page.render = () => this.pissPage(egg);
        page.after = (layer) => this.sizeCanvas(layer);
        page.tick = (layer, f, t) => this.pissDraw(layer, egg, t);
      } else {
        page.title = [c.name, 'Golf Index Today'];
        page.render = () => this.chart(c);
      }
    });
    return pages;
  }

  barLines() {
    const c = this.city;
    const o = this.data?.home?.obs;
    if (!o || !c) return ['Golf conditions for Albuquerque', 'Updating the golf report'];
    const lines = (this.data.alerts || []).map((a) => `* ${a.event} *`);
    lines.push('Golf conditions at the Sunport', `${o.text || 'N/A'}   Temp: ${o.temp ?? 'N/A'}°F`,
      `Wind: ${o.wind?.mph ? `${o.wind.dir} ${o.wind.mph} MPH${o.gust ? ` G ${o.gust}` : ''}` : 'Calm'}`,
      `Humidity: ${o.rh ?? 'N/A'}%   Pressure: ${o.pressure?.toFixed(2) ?? 'N/A'}`);
    if (c.carry != null) lines.push(`Carry vs a normal day: ${signed(c.carry)}%`);
    for (const k of this.courses) {
      const r = this.course(k.key);
      if (r) lines.push(`${k.name}: ${r.firm}, golf index ${r.index.score ?? '-'}`);
    }
    return lines;
  }

  crawlText() {
    if (!this.data) return '';
    const today = this.local(Date.now()).getDate();
    const until = (iso) => { const d = this.local(iso); return `${time12(d)}${d.getDate() !== today ? ` ${DAYS[d.getDay()]}` : ''}`; };
    const parts = (this.data.alerts || []).map((a) => `${a.event}${a.ends ? ` until ${until(a.ends)}` : ''}`);
    for (const k of this.courses) {
      const r = this.course(k.key);
      if (!r) continue;
      const best = r.best ? ` Best tee time: ${hourWord(this.local(r.best.start))}.` : '';
      parts.push(`${k.name}: ${r.firm}. Golf index ${r.index.score} (${r.index.word}).${best}${r.flags.length ? ` ${r.flags.join(', ')}.` : ''}`);
    }
    return parts.join('   ***   ').toUpperCase();
  }

  // ── full-screen pages ──
  intro() {
    const rows = this.courses.map((c) => {
      const r = this.course(c.key);
      return `<div class="gi-row"><span class="n">${esc(c.name)}</span><span class="p">Par ${c.par}</span>`
        + `<span class="s">${r ? stars(r.index.score) : ''}</span></div>`;
    }).join('');
    return `<div class="gw-panel gi">
      ${this.program.logo ? `<img class="gi-logo" src="assets/logos/${esc(this.program.logo)}" alt="">` : ''}
      <div class="gi-head">Golf weather for the</div>
      <div class="gi-head2">${esc(this.program.area || 'Local Courses')}</div>
      <div class="gi-ball">${BALL}</div>
      <div class="gi-rows">${rows}</div>
    </div>`;
  }

  conditions() {
    const o = this.data?.home?.obs;
    const c = this.city;
    if (!o) return `<div class="gw-panel"><div class="wx-wait">Updating golf conditions</div></div>`;
    const rows = [['Humidity:', `${o.rh ?? 'N/A'}%`], ['Dewpoint:', o.dew != null ? `${o.dew}°` : 'N/A'],
      ['Pressure:', o.pressure != null ? o.pressure.toFixed(2) : 'N/A'],
      ['Density Alt:', c?.da != null ? `${c.da.toLocaleString('en-US')} ft` : 'N/A'],
      ['Carry vs Normal:', c?.carry != null ? `${signed(c.carry)}%` : 'N/A']];
    return `<div class="gw-panel cc">
      <div class="cc-temp">${o.temp ?? 'N/A'}°</div>
      <div class="cc-cond">${esc(o.text || '')}</div>
      <div class="cc-icon">${wxIcon(o.icon, 96)}</div>
      <div class="cc-wind">${windArrow(o.wdeg)}<span>${esc(o.wind?.mph ? `${o.wind.dir} ${o.wind.mph}${o.gust ? ` G${o.gust}` : ''}` : 'Calm')}</span></div>
      <div class="gw-index">${c ? indexBadge(c.index) : ''}</div>
      <div class="cc-rows">${rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
    </div>`;
  }

  playing(c) {
    const r = this.course(c.key);
    if (!r) return `<div class="gw-panel"><div class="wx-wait">Checking ${esc(c.name)}</div></div>`;
    const o = r.obs || {};
    return `<div class="gw-panel gp">
      <div class="gp-left">
        ${indexBadge(r.index)}
        <div class="gp-firm ${r.firm.replace(/\W+/g, '').toLowerCase()}">${esc(r.firm)}</div>
        <div class="gp-now">${o.temp ?? '--'}° ${windArrow(o.wdeg, 26)} ${o.wind?.mph ? `${esc(o.wind.dir)} ${o.wind.mph}` : 'Calm'}</div>
        <div class="gp-card">Par ${c.par} · ${c.yards.toLocaleString('en-US')} yds${c.slope ? ` · Slope ${c.slope}` : ''}</div>
      </div>
      <div class="gp-lines">${[...r.flags.map((f) => `<div class="flag">${esc(f)}!</div>`), ...r.lines.slice(0, 7 - r.flags.length)
        .map((l) => `<div>${GOLF_DOT}<span>${esc(l)}</span></div>`)].join('')}</div>
    </div>`;
  }

  // the golf index hour by hour, as a '90s bar chart
  chart(c) {
    const r = this.course(c.key);
    const hours = (r?.hours || []).slice(0, 12);
    if (!hours.length) return `<div class="gw-panel"><div class="wx-wait">Updating ${esc(c.name)}</div></div>`;
    const bars = hours.map((h) => {
      const d = this.local(h.start);
      const score = h.index.score ?? 0;
      return `<div class="gc-bar"><div class="gc-v">${score}</div>
        <div class="gc-fill ${h.index.word.toLowerCase()}" style="height:${score * 15}px"></div>
        <div class="gc-t">${d.getHours() % 12 || 12}${d.getHours() < 12 ? 'a' : 'p'}</div>
        <div class="gc-w">${h.temp}°</div><div class="gc-w">${esc(h.dir)}${h.mph}</div></div>`;
    }).join('');
    return `<div class="gw-panel gc">${bars}</div>`;
  }

  // ── the flyovers ──
  // A hole's line in meters (x east, y north from the course's middle), or for the sweep, the
  // course's longest stretch.
  flyFrame(c, hole) {
    const pts = hole ? hole.line : c.overview?.line || [[-200, -200], [200, 200]];
    const segs = [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push({ a: pts[i - 1], b: pts[i], d, at: len });
      len += d;
    }
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const brg = hole ? hole.brg : (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    return { pts, segs, len: len || 1, brg, hole };
  }

  pointAt(fr, s) {
    const want = Math.max(0, Math.min(1, s)) * fr.len;
    const seg = fr.segs.find((g) => want <= g.at + g.d) || fr.segs[fr.segs.length - 1];
    const k = seg.d ? (want - seg.at) / seg.d : 0;
    return [seg.a[0] + (seg.b[0] - seg.a[0]) * k, seg.a[1] + (seg.b[1] - seg.a[1]) * k];
  }

  flyover(c, hole, fr) {
    const r = this.course(c.key);
    return `<div class="gw-fly"><canvas class="gw-canvas" width="${FLY_W}" height="${FLY_H}"></canvas></div>
      ${this.holeInfo(c, hole, r, fr)}${this.wxBox(r, fr ? fr.brg : null)}`;
  }

  // draw at the screen's real resolution, so the vectors stay sharp
  sizeCanvas(layer) {
    const canvas = layer.querySelector('.gw-canvas');
    if (!canvas) return;
    const k = Math.max(1, Math.min(3, (canvas.getBoundingClientRect().width / FLY_W || 1) * (window.devicePixelRatio || 1)));
    canvas.width = Math.round(FLY_W * k);
    canvas.height = Math.round(FLY_H * k);
    canvas.dataset.k = k;
    canvas.dataset.drawn = 0;
  }

  // A course's map as canvas paths, one per layer, built once, with what the easter eggs need.
  mapOf(c) {
    let m = this.maps.get(c.key);
    if (m) return m;
    const poly = (rings) => {
      const p = new Path2D();
      for (const r of rings || []) {
        r.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
        p.closePath();
      }
      return p;
    };
    const lines = (rings) => {
      const p = new Path2D();
      for (const r of rings || []) r.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      return p;
    };
    const trees = new Path2D();
    for (const [x, y] of c.map?.trees || []) { trees.moveTo(x + 4.5, y); trees.arc(x, y, 4.5, 0, Math.PI * 2); }
    const L = c.map || {};
    // the course's extent: its outline, or failing that everything on the map
    const all = L.outline?.[0]?.length ? L.outline[0]
      : Object.entries(L).flatMap(([layer, v]) => (layer === 'trees' ? v : v.flat()));
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    m = {
      outline: poly(L.outline), grass: poly(L.grass), wood: poly(L.wood), water: poly(L.water), rough: poly(L.rough),
      range: poly(L.range), fairway: poly(L.fairway), tee: poly(L.tee), green: poly(L.green), bunker: poly(L.bunker),
      clubhouse: poly(L.clubhouse), path: lines(L.path), treerow: lines(L.treerow), trees,
      bounds: xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [-300, -300, 300, 300],
    };
    this.maps.set(c.key, m);
    return m;
  }

  stripes() {
    if (this.stripeTile) return this.stripeTile;
    const t = document.createElement('canvas');
    t.width = t.height = 16;
    const g = t.getContext('2d');
    g.fillStyle = C.fairway; g.fillRect(0, 0, 16, 16);
    g.fillStyle = C.stripe; g.fillRect(0, 0, 8, 16);
    this.stripeTile = t;
    return t;
  }

  // The camera for a moment of a hole's flyover: where it looks (meters), how close (pixels
  // per meter), which way is up, and where on screen the look point sits.
  camera(fr, f) {
    const mid = this.pointAt(fr, 0.5);
    // the whole hole fits with room for the flag; the follow shot sees 150-240 m of it
    const whole = { x: mid[0], y: mid[1], s: (FLY_H * 0.68) / fr.len, ax: FLY_W / 2, ay: FLY_H * 0.58 };
    const view = Math.max(150, Math.min(240, fr.len * 0.75));
    const follow = (sAlong, zoom, ay) => { const [x, y] = this.pointAt(fr, sAlong); return { x, y, s: (FLY_H / view) * zoom, ax: FLY_W / 2, ay }; };
    let cam;
    if (f < 0.16) cam = { ...whole }; // the whole hole, swinging around to point up the screen
    else if (f < 0.3) { // drop down to the tee
      const t = ease((f - 0.16) / 0.14);
      const to = follow(0, 1, FLY_H * 0.76);
      cam = { x: lerp(whole.x, to.x, t), y: lerp(whole.y, to.y, t), s: lerp(whole.s, to.s, t), ax: to.ax, ay: lerp(whole.ay, to.ay, t) };
    } else if (f < 0.84) { // glide down the fairway
      const t = ease((f - 0.3) / 0.54);
      cam = follow(t, 1, lerp(FLY_H * 0.76, FLY_H * 0.56, t));
    } else { // settle over the green
      const t = ease((f - 0.84) / 0.16);
      cam = follow(1, lerp(1, 1.3, t), FLY_H * 0.56);
    }
    cam.rot = fr.brg - (f < 0.16 ? 35 * (1 - ease(f / 0.16)) : 0);
    return cam;
  }

  // the slow sweep down a course whose holes aren't mapped; p: 0 to 1 across all its holes
  sweepCam(fr, p) {
    const [x, y] = this.pointAt(fr, 0.06 + 0.88 * p);
    return { x, y, s: FLY_H / 330, rot: fr.brg - 10 + 20 * p, ax: FLY_W / 2, ay: FLY_H / 2 };
  }

  // the whole course, north up, fit into the screen left of a side panel (width: room left)
  overviewCam(c, width = FLY_W) {
    const [x0, y0, x1, y1] = this.mapOf(c).bounds;
    const s = Math.min((width - 28) / (x1 - x0 || 1), (FLY_H - 26) / (y1 - y0 || 1));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s, rot: 0, ax: width / 2, ay: FLY_H / 2 };
  }

  // Draw a course through a camera; marks(ctx, screen, k) adds the hole line, flag, cart...
  draw(layer, c, cam, marks) {
    const canvas = layer.querySelector('.gw-canvas');
    if (!canvas) return;
    const now = performance.now();
    if (now - (+canvas.dataset.drawn || 0) < FRAME_MS) return;
    canvas.dataset.drawn = now;
    const k = +canvas.dataset.k || 1;
    const ctx = canvas.getContext('2d');
    const m = this.mapOf(c);
    const s = cam.s;
    const px = (n) => n / s; // a width in screen pixels, in meters

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.desert;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // world meters to screen: look point at (ax, ay), turned so the hole runs up the screen
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(cam.ax, cam.ay);
    ctx.scale(s, -s);
    ctx.rotate((cam.rot * Math.PI) / 180);
    ctx.translate(-cam.x, -cam.y);
    const world = ctx.getTransform();
    const fill = (path, color, edge, w) => {
      ctx.fillStyle = color;
      ctx.fill(path, 'evenodd');
      if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = w; ctx.stroke(path); }
    };
    fill(m.outline, C.rough, '#2c6e2a', px(2));
    fill(m.grass, C.grass);
    fill(m.rough, C.rough);
    fill(m.wood, C.wood);
    fill(m.water, C.water, C.waterEdge, px(2));
    ctx.fillStyle = ctx.createPattern(this.stripes(), 'repeat');
    ctx.fill(m.fairway, 'evenodd');
    ctx.strokeStyle = '#4fa63a'; ctx.lineWidth = px(1.5); ctx.stroke(m.fairway);
    fill(m.range, C.range);
    fill(m.tee, C.tee, '#ffffff', px(1.5));
    fill(m.green, C.green, C.fringe, Math.max(1.8, px(1)));
    fill(m.bunker, C.bunker, C.bunkerEdge, px(1.2));
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = C.path; ctx.lineWidth = Math.max(2.6, px(1.5)); ctx.stroke(m.path);
    ctx.strokeStyle = C.tree; ctx.lineWidth = 7; ctx.stroke(m.treerow);
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.save(); ctx.translate(1.6, -1.6); ctx.fill(m.trees); ctx.restore();
    fill(m.trees, C.tree, C.treeLit, px(1.5));
    fill(m.clubhouse, C.clubhouse, '#5a2416', px(1.5));
    const screen = (x, y) => { const p = world.transformPoint(new DOMPoint(x, y)); return [p.x / k, p.y / k]; };
    marks?.({ ctx, screen, k, px, world });
  }

  // the hole: a dashed line from the tee, yardage markers, the tee box and an upright flag
  holeMarks({ ctx, screen, k, px, world }, fr) {
    ctx.setTransform(world);
    ctx.beginPath();
    fr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0, 0, 0, .5)'; ctx.lineWidth = px(5); ctx.stroke();
    ctx.setLineDash([px(12), px(8)]); ctx.strokeStyle = '#ffe23a'; ctx.lineWidth = px(3); ctx.stroke();
    ctx.setLineDash([]);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // yardage markers back from the green (150 white, 200 blue, 250 yellow), each labeled
    const yds = fr.hole.yds;
    ctx.font = '900 12px "Arial Black", "DejaVu Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [y, col] of [[150, '#ffffff'], [200, '#2d6bff'], [250, '#ffd21f']]) {
      if (!yds || y >= yds - 40) continue;
      const [sx, sy] = screen(...this.pointAt(fr, 1 - y / yds));
      dot(ctx, sx, sy, 5.5, col);
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(String(y), sx + 9, sy);
      ctx.fillStyle = '#fff'; ctx.fillText(String(y), sx + 9, sy);
    }
    const [tx, ty] = screen(...fr.pts[0]);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.fillRect(tx - 8, ty - 5, 16, 10); ctx.strokeRect(tx - 8, ty - 5, 16, 10);
    flag(ctx, ...screen(...fr.pts[fr.pts.length - 1]));
  }

  holeInfo(c, hole, r, fr) {
    const pl = r ? playsLike(hole, r, !!fr) : null;
    return `<div class="gw-hole"><div class="h">HOLE <b>${hole.n}</b></div>
        <div class="d">PAR ${hole.par}${hole.yds ? ` · ${hole.yds} YDS` : ''}</div>
        ${hole.hcp ? `<div class="d">HANDICAP ${hole.hcp}</div>` : ''}
        ${hole.rise ? `<div class="d">${hole.rise > 0 ? 'UP' : 'DOWN'} ${Math.abs(hole.rise)} FT</div>` : ''}</div>
      ${pl ? `<div class="gw-plays"><div class="k">PLAYS LIKE</div><div class="v">${pl.total}</div>
        ${pl.parts.map((p) => `<div class="p">${esc(p)}</div>`).join('')}</div>` : ''}`;
  }

  // the weather on top of the flyover: sky, temperature, the wind as it hits this hole, rain
  wxBox(r, brg) {
    const o = r?.obs;
    if (!o) return '';
    const rel = o.wdeg != null && brg != null ? (o.wdeg + 180 - brg + 360) % 360 : null;
    const rain = Math.max(0, ...(r.hours || []).slice(0, 3).map((h) => h.pop || 0));
    const wind = o.wind?.mph ? `${o.wind.dir} ${o.wind.mph}${o.gust ? ` G${o.gust}` : ''}` : 'Calm';
    return `<div class="gw-wx">
      <div class="i">${wxIcon(o.icon, 42)}</div>
      <div class="t">${o.temp ?? '--'}°</div>
      <div class="w">${rel != null && o.wind?.mph ? windArrow(rel, 26, true) : o.wind?.mph ? windArrow(o.wdeg, 26) : ''}<span>${esc(wind)}</span></div>
      <div class="r">Rain ${rain}% · Index ${r.index.score ?? '-'}</div>
    </div>`;
  }

  // ── easter egg: the beverage cart's "live" GPS ──
  // A cart on a random course, rolling down one of its real cart paths, with a made-up status.
  cartRun(rand) {
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const withPaths = this.courses.filter((c) => (c.map?.path || []).length);
    const c = withPaths.length ? pick(withPaths) : this.courses[0];
    const paths = (c.map?.path || []).map((pts) => this.flyFrame(c, { line: pts, brg: 0 })).filter((fr) => fr.len > 60);
    const fr = paths.length ? pick(paths.filter((p) => p.len > 120).length ? paths.filter((p) => p.len > 120) : paths) : this.flyFrame(c, null);
    const menu = [...MENU].sort(() => rand() - 0.5);
    return {
      c, fr, start: rand(), speed: 0.7 + rand() * 0.6, mph: 7 + Math.floor(rand() * 7), eta: 2 + Math.floor(rand() * 9),
      bars: 1 + Math.floor(rand() * 4), stocked: menu.slice(0, 3), out: menu[3], target: pick(['your group', 'the turn', 'the 10th tee', 'the range']),
    };
  }

  cartPos(egg, f) {
    // back and forth along the path, about a hundred meters a page
    const span = Math.min(1, 110 / egg.fr.len) * egg.speed;
    const u = (egg.start + span * f) % 2;
    return this.pointAt(egg.fr, u > 1 ? 2 - u : u);
  }

  // where on the course a point is, by the nearest tee or green
  nearWhat(c, [x, y]) {
    let best = null;
    for (const h of c.holes) {
      if (!h.line) continue;
      for (const [end, word] of [[h.line[0], 'tee'], [h.line[h.line.length - 1], 'green']]) {
        const d = Math.hypot(end[0] - x, end[1] - y);
        if (!best || d < best.d) best = { d, text: `the ${ordinal(h.n)} ${word}` };
      }
    }
    return best ? best.text : 'the clubhouse';
  }

  cartPage(egg) {
    const pos = this.cartPos(egg, 0);
    return `<div class="gw-fly"><canvas class="gw-canvas" width="${FLY_W}" height="${FLY_H}"></canvas></div>
      <div class="gw-side cart">
        <div><span class="live"><i></i>LIVE</span><span class="sig">GPS ${'▮'.repeat(egg.bars)}${'▯'.repeat(4 - egg.bars)}</span></div>
        <div class="h">${esc(egg.c.name)}</div>
        <div class="l">Near ${esc(this.nearWhat(egg.c, pos))}</div>
        <div class="l">${egg.mph} mph · ETA ${egg.eta} min</div>
        <div class="l small">to ${esc(egg.target)}</div>
        <div class="k">On board:</div>
        ${egg.stocked.map((m) => `<div class="m">✓ ${esc(m)}</div>`).join('')}
        <div class="m out">✗ ${esc(egg.out)}: out</div>
        <div class="fine">*simulated, like every cart ETA</div>
      </div>`;
  }

  cartDraw(layer, egg, f, t) {
    const cam = this.overviewCam(egg.c, FLY_W - 210);
    this.draw(layer, egg.c, cam, ({ ctx, screen, k }) => {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      // the trail it left, then the cart and a radar ping
      for (let i = 1; i <= 8; i++) {
        const [x, y] = screen(...this.cartPos(egg, Math.max(0, f - i * 0.025)));
        dot(ctx, x, y, 1.8, 'rgba(255, 255, 255, .8)', null);
      }
      const [x, y] = screen(...this.cartPos(egg, f));
      const ping = ((t / 1000) % 1.6) / 1.6;
      ctx.beginPath(); ctx.arc(x, y, 6 + ping * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(232, 37, 31, ${1 - ping})`; ctx.lineWidth = 3; ctx.stroke();
      cart(ctx, x, y);
    });
  }

  // ── easter egg: the best holes to take a piss ──
  // Worked out from the course's real layout: a spot deep in the course, away from the
  // houses along its edge, from other holes' tees and greens and from the clubhouse, with
  // trees or the arroyo for cover. Three of the top five, drawn at random.
  pissReport(rand) {
    const mapped = this.courses.filter((c) => c.holes.some((h) => h.line));
    if (!mapped.length) return null;
    const c = mapped[Math.floor(rand() * mapped.length)];
    const L = c.map || {};
    const outline = L.outline?.[0] || [];
    const trees = [...(L.trees || []), ...(L.treerow || []).flat(), ...(L.wood || []).flat()];
    const water = (L.water || []).flat();
    const club = (L.clubhouse || []).flat();
    const ends = c.holes.filter((h) => h.line).map((h) => ({ n: h.n, pts: [h.line[0], h.line[h.line.length - 1]] }));
    const near = (list, p) => list.reduce((m, q) => Math.min(m, Math.hypot(q[0] - p[0], q[1] - p[1])), Infinity);
    const spots = c.holes.filter((h) => h.line).map((h) => {
      const fr = this.flyFrame(c, h);
      let best = null;
      for (const s of [0.3, 0.45, 0.6, 0.75]) {
        const p = this.pointAt(fr, s);
        const edge = Math.min(edgeDist(outline, p), 150);
        const crowd = Math.min(near(ends.filter((e) => e.n !== h.n).flatMap((e) => e.pts), p), 160);
        const house = club.length ? Math.min(near(club, p), 700) : 350;
        const cover = trees.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 35).length;
        const wet = near(water, p) < 30;
        const score = (edge / 150) * 3 + (crowd / 160) * 3 + (house / 700) + Math.min(cover, 6) / 3 + (wet ? 0.6 : 0);
        if (!best || score > best.score) best = { score, p, edge, crowd, house, cover, wet };
      }
      const why = [];
      if (best.cover >= 2) why.push('Trees for cover');
      if (best.wet) why.push('Backs onto the water');
      if (best.edge > 90) why.push('Deep in the course');
      if (best.crowd > 110) why.push('Nobody teeing off nearby');
      if (club.length && best.house > 500) why.push('Far from the clubhouse');
      if (!why.length) why.push('As private as it gets');
      return { n: h.n, ...best, why: why[Math.floor(rand() * why.length)] };
    }).sort((a, b) => b.score - a.score);
    const top = spots.slice(0, 5);
    const picks = top.map((s) => ({ s, r: rand() })).sort((a, b) => a.r - b.r).slice(0, 3).map((x) => x.s).sort((a, b) => b.score - a.score);
    const max = spots[0]?.score || 1;
    return { c, picks: picks.map((s) => ({ ...s, stars: Math.max(2, Math.round((s.score / max) * 5)) })) };
  }

  pissPage(egg) {
    if (!egg) return `<div class="gw-panel"><div class="wx-wait">Looking for a tree</div></div>`;
    return `<div class="gw-fly"><canvas class="gw-canvas" width="${FLY_W}" height="${FLY_H}"></canvas></div>
      <div class="gw-side piss">
        <div class="h">${esc(egg.c.name)}</div>
        ${egg.picks.map((s, i) => `<div class="pk"><span class="no">${i + 1}</span><b>Hole ${s.n}</b>
          <span class="st">${'★'.repeat(s.stars)}${'☆'.repeat(5 - s.stars)}</span>
          <div class="why">${esc(s.why)}</div></div>`).join('')}
        <div class="fine">Mind the rangers.</div>
      </div>`;
  }

  pissDraw(layer, egg, t) {
    if (!egg) return;
    const cam = this.overviewCam(egg.c, FLY_W - 210);
    const blink = Math.floor(t / 600) % 2;
    this.draw(layer, egg.c, cam, ({ ctx, screen, k }) => {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      egg.picks.forEach((s, i) => {
        const [x, y] = screen(...s.p);
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 && blink ? '#ffe23a' : '#fff'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#000'; ctx.stroke();
        ctx.fillStyle = '#000'; ctx.font = '900 13px "Arial Black", "DejaVu Sans", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y + 0.5);
      });
    });
  }

  courseInfo(c) {
    const longest = c.holes.reduce((a, b) => ((b.yds || 0) > (a?.yds || 0) ? b : a), null);
    return `<div class="gw-hole wide"><div class="h">${esc(c.name.toUpperCase())}</div>
        <div class="d">PAR ${c.par} · ${c.yards.toLocaleString('en-US')} YDS</div>
        ${c.built ? `<div class="d">OPENED ${c.built}${c.architect ? ` · ${esc(c.architect.toUpperCase())}` : ''}</div>` : ''}
        ${c.hardest ? `<div class="d">TOUGHEST: #${c.hardest}${longest ? ` · LONGEST: #${longest.n} (${longest.yds})` : ''}</div>` : ''}</div>`;
  }

  // ── tee times ──
  teeTimes(real) {
    if (!this.data) return `<div class="gw-panel"><div class="wx-wait">Updating tee times</div></div>`;
    // the next 9 AM, noon and 3 PM still ahead
    const slots = [9, 12, 15].map((hr) => {
      const d = this.local(real);
      d.setHours(hr, 0, 0, 0);
      const ahead = d.getTime() > this.local(real).getTime() - 1800e3;
      return { hr, tomorrow: !ahead };
    });
    const head = slots.map((s) => `<span>${s.hr === 12 ? 'NOON' : `${s.hr % 12} ${s.hr < 12 ? 'AM' : 'PM'}`}${s.tomorrow ? '*' : ''}</span>`).join('');
    const rows = this.courses.map((c) => {
      const r = this.course(c.key);
      const cells = slots.map((s) => {
        const h = r?.hours.find((x) => { const d = this.local(x.start); return d.getHours() === s.hr && (s.tomorrow ? d.getDate() !== this.local(real).getDate() : true); });
        return h ? `<span><b>${h.temp}°</b> ${esc(h.dir)}${h.mph}${h.pop >= 20 ? ` <i>${h.pop}%</i>` : ''}</span>` : '<span>--</span>';
      }).join('');
      return `<div class="tt-row"><span class="n">${esc(c.name)}</span>${cells}</div>
        <div class="tt-best">${r?.best ? `Best tee time: ${hourWord(this.local(r.best.start))} (${r.best.temp}°, ${r.best.dir} ${r.best.mph})` : ''}</div>`;
    }).join('');
    return `<div class="gw-panel tt"><div class="tt-head"><span class="n"></span>${head}</div>${rows}
      ${slots.some((s) => s.tomorrow) ? '<div class="tt-note">* tomorrow</div>' : ''}</div>`;
  }

  outlook() {
    const days = this.city?.days || [];
    if (!days.length) return `<div class="gw-panel"><div class="wx-wait">Updating the golf outlook</div></div>`;
    return days.map((d, i) => `<div class="gw-day" style="left:${48 + i * 190}px">
      <div class="n">${esc(d.name.replace(/ Night$/, '').toUpperCase().slice(0, 9))}</div>
      <div class="i">${wxIcon(d.icon, 72)}</div>
      <div class="t">${d.temp}°</div>
      <div class="w">${esc(d.wdir)} ${esc(String(d.wind).replace(/ mph/, ''))}</div>
      ${indexBadge(d.index, true)}
    </div>`).join('');
  }

  daylight() {
    const c = this.city;
    if (!c?.sun) return `<div class="gw-panel"><div class="wx-wait">Updating daylight</div></div>`;
    const rise = this.local(c.sun.rise);
    const set = this.local(c.sun.set);
    const minus = (d, mins) => new Date(d.getTime() - mins * 60e3);
    const rows = [['Sunrise / First Tee:', rise], ['Last Tee for 18:', minus(set, 270)], ['Last Tee for 9:', minus(set, 135)], ['Sunset:', set]];
    return `<div class="gw-panel dl">
      <div class="dl-day">${DAYS[rise.getDay()]}, ${MONTHS[rise.getMonth()]} ${rise.getDate()}</div>
      ${rows.map(([k, d]) => `<div class="dl-row"><span>${k}</span><b>${time12(d).toLowerCase()}</b></div>`).join('')}
      <div class="dl-note">Last-tee times allow 4½ hours for 18 holes and 2¼ for 9.</div>
    </div>`;
  }
}

// ── plays-like yardage ──
// The hole's yardage from the middle tees, adjusted for the wind along it (about 1% per
// mph into it, half that downwind), the climb to the green (a yard per 3 feet) and the air
// against a normal day at this altitude (the altitude itself is a given here). A hole with
// no line on the map only gets the air.
function playsLike(hole, r, mapped) {
  if (!hole.yds) return null;
  const parts = [];
  let y = hole.yds;
  if (mapped) {
    const mph = r.obs?.wind?.mph || 0;
    const a = r.obs?.wdeg != null ? ((r.obs.wdeg - hole.brg) * Math.PI) / 180 : 0;
    const head = mph * Math.cos(a);
    const cross = mph * Math.sin(a);
    const slope = Math.round((hole.rise || 0) / 3);
    y += slope;
    const wind = Math.round(y * (head > 0 ? head * 0.01 : head * 0.005));
    y += wind;
    if (Math.abs(head) >= 3) parts.push(`${head > 0 ? 'Into wind' : 'Downwind'} ${signed(wind)}`);
    if (Math.abs(cross) >= 5) parts.push(`${cross > 0 ? 'R-to-L' : 'L-to-R'} wind ${Math.round(Math.abs(cross))} mph`);
    if (slope) parts.push(`${slope > 0 ? 'Uphill' : 'Downhill'} ${signed(slope)}`);
  }
  const air = r.carry ? Math.round(y / (1 + r.carry / 100) - y) : 0;
  y += air;
  if (air) parts.push(`Air today ${signed(air)}`);
  return { total: Math.round(y), parts };
}

const ease = (x) => { const v = Math.max(0, Math.min(1, x)); return v < 0.5 ? 2 * v * v : 1 - ((-2 * v + 2) ** 2) / 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
const hourWord = (d) => (d.getHours() === 12 && !d.getMinutes() ? 'noon' : time12(d).replace(':00', '').toLowerCase());

// distance from a point to the nearest edge of a ring
function edgeDist(ring, p) {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]));
  }
  return best;
}

function dot(ctx, x, y, r, fill, stroke = '#000') {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function flag(ctx, gx, gy) {
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 38); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 38); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx, gy - 38); ctx.lineTo(gx + 20, gy - 31); ctx.lineTo(gx, gy - 24); ctx.closePath();
  ctx.fillStyle = '#e8251f'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(gx, gy, 5, 2.5, 0, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
}

// a little white golf cart with a striped canopy
function cart(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2; ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-7, 6, 3.5, 0, Math.PI * 2); ctx.arc(7, 6, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(-11, -3, 22, 9); ctx.strokeRect(-11, -3, 22, 9);
  ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-9, -12); ctx.moveTo(9, -3); ctx.lineTo(9, -12); ctx.stroke();
  ctx.fillStyle = '#e8251f'; ctx.fillRect(-12, -15, 24, 4); ctx.strokeRect(-12, -15, 24, 4);
  ctx.fillStyle = '#fff'; ctx.fillRect(-4, -15, 8, 4);
  ctx.restore();
}

function stars(score) {
  if (score == null) return '';
  const n = Math.round(score / 2);
  return `<i class="on">${'★'.repeat(n)}</i><i>${'★'.repeat(5 - n)}</i>`;
}

function indexBadge(ix, small = false) {
  if (!ix) return '';
  return `<div class="gw-badge ${small ? 'small' : ''} ${ix.word.toLowerCase().replace(/\W/g, '')}">
    <div class="k">GOLF INDEX</div><div class="v">${ix.score ?? '-'}</div><div class="w">${esc(ix.word)}</div></div>`;
}

// an arrow pointing the way the wind blows (deg: where it's from; toScreen: already turned)
function windArrow(deg, size = 34, toScreen = false) {
  if (deg == null) return '';
  const rot = toScreen ? deg : (deg + 180) % 360;
  return `<svg class="gw-arrow" viewBox="-20 -20 40 40" width="${size}" height="${size}" style="transform:rotate(${rot}deg)">
    <path d="M0,-17 L11,2 L4,2 L4,17 L-4,17 L-4,2 L-11,2 Z" fill="#ffe23a" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}

const GOLF_DOT = '<svg class="gw-dot" viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="8" fill="#fff" stroke="#000" stroke-width="2"/>'
  + '<circle cx="7" cy="8" r="1.3" fill="#9aa"/><circle cx="12" cy="7" r="1.3" fill="#9aa"/><circle cx="10" cy="12" r="1.3" fill="#9aa"/></svg>';

// the spinning ball on the opening page
const BALL = `<svg viewBox="0 0 120 120" width="120" height="120"><defs><radialGradient id="gw-ball" cx="38%" cy="32%" r="70%">
  <stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#dfe3e6"/><stop offset="1" stop-color="#8d969c"/></radialGradient></defs>
  <circle cx="60" cy="60" r="54" fill="url(#gw-ball)" stroke="#000" stroke-width="4"/>
  ${Array.from({ length: 22 }, (_, i) => { const a = i * 2.4; const rr = 12 + (i % 5) * 8; return `<circle cx="${(60 + rr * Math.cos(a)).toFixed(1)}" cy="${(60 + rr * Math.sin(a)).toFixed(1)}" r="3.4" fill="#b9c0c6"/>`; }).join('')}
</svg>`;
