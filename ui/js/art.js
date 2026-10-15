// Artwork: the official TiVo guy (assets/img/tivo-logo.webp) plus glyphs, status
// icons and the light-streak backgrounds of the SD menus, all drawn in code so
// they stay crisp at any scale and read well through composite video.

let uidCounter = 0;
const uid = (p) => `${p}${++uidCounter}`;

const LOGO = 'assets/img/tivo-logo.webp';
const LOGO_W = 250, LOGO_H = 328;

// The guy with a thin white keyline so his black body reads on dark backgrounds.
function guy(x, y, h) {
  const w = (h * LOGO_W) / LOGO_H;
  const f = uid('kl');
  return `
  <defs>
    <filter id="${f}" x="-20%" y="-20%" width="140%" height="140%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="${(h / 60).toFixed(2)}" result="grow"/>
      <feFlood flood-color="#fff"/>
      <feComposite in2="grow" operator="in" result="line"/>
      <feMerge><feMergeNode in="line"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <image href="${LOGO}" x="${x - w / 2}" y="${y}" width="${w}" height="${h}" filter="url(#${f})"/>`;
}

// TiVo guy inside the round badge that anchors the top-left of every screen
export function badge() {
  const fill = uid('bf'), rim = uid('br');
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${fill}" cx=".42" cy=".34" r=".7">
      <stop offset="0" stop-color="#3a4f92"/><stop offset="1" stop-color="#060a24"/>
    </radialGradient>
    <linearGradient id="${rim}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef2ff"/><stop offset=".5" stop-color="#8d96b8"/><stop offset="1" stop-color="#2b3050"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="51" r="46" fill="#000" opacity=".45"/>
  <circle cx="50" cy="49" r="45" fill="url(#${fill})" stroke="url(#${rim})" stroke-width="3"/>
  ${guy(50, 11, 76)}
</svg>`;
}

export function miniGuy(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100">${guy(50, 2, 96)}</svg>`;
}

// ── glyphs ────────────────────────────────────────────────────────────────────
const ARROWS = { u: '1,12 7,2 13,12', d: '1,2 7,12 13,2', l: '12,1 2,7 12,13', r: '2,1 12,7 2,13' };
export const arrow = (dir) =>
  `<svg class="arrow" viewBox="0 0 14 14"><polygon points="${ARROWS[dir]}" fill="rgba(8,12,40,.35)" stroke="#eef0f8" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export const folder = () => `<svg width="22" height="17" viewBox="0 0 22 17">
  <path d="M1.6 3.6 Q1.6 1.6 3.6 1.6 H8.2 L10.2 3.6 H18.4 Q20.4 3.6 20.4 5.6 V14 Q20.4 15.6 18.8 15.6 H3.2 Q1.6 15.6 1.6 14 Z"
        fill="#d4c8fb" stroke="#46368a" stroke-width="1.3"/>
  <path d="M2.6 6.6 H19.4" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>
  <path d="M2.6 13.8 H19.4" stroke="#8f7fd0" stroke-opacity=".8" stroke-width="1.2"/>
</svg>`;

const DOTS = {
  red: ['#ffb0a4', '#e8200e', '#6e0400'],
  green: ['#b6ffa6', '#22b822', '#075007'],
  yellow: ['#fffbc0', '#e9c81c', '#6f5a00'],
};
export function dot(color, size = 15, mark = '') {
  const g = uid('dot');
  const [hi, mid, lo] = DOTS[color];
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16">
  <defs><radialGradient id="${g}" cx=".38" cy=".32" r=".75">
    <stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/>
  </radialGradient></defs>
  <circle cx="8" cy="8" r="7" fill="url(#${g})" stroke="rgba(0,0,0,.6)" stroke-width="1"/>
  ${mark ? `<text x="8" y="12.3" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="11" fill="#1a1200">${mark}</text>` : ''}
</svg>`;
}

export function thumbs(up, count = 1) {
  const color = up ? '#3ccf3c' : '#e23a2a';
  const one = `<svg width="15" height="15" viewBox="0 0 20 20" style="${up ? '' : 'transform:rotate(180deg)'}">
    <path d="M2 9h4v9H2z M7.5 9 L10.6 2.6 Q12.8 2.2 12.8 4.6 L12.2 8 H17 Q18.9 8.3 18.5 10.2 L17.2 16.4 Q16.8 18 15.2 18 H7.5 Z"
          fill="${color}" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  return one.repeat(count);
}

// Trickplay state icon (drawn in the TiVo green)
export function trickIcon(state) {
  const g = '#22e522', s = 'stroke="#003a00" stroke-width="1" stroke-linejoin="round"';
  const tri = (x, dir = 1) => dir > 0
    ? `<polygon points="${x},1 ${x + 9},7 ${x},13" fill="${g}" ${s}/>`
    : `<polygon points="${x + 9},1 ${x},7 ${x + 9},13" fill="${g}" ${s}/>`;
  const svg = (w, body) => `<svg width="${w}" height="14" viewBox="0 0 ${w} 14">${body}</svg>`;
  if (state === 'pause') return svg(12, `<rect x="1" y="1" width="3.6" height="12" fill="${g}" ${s}/><rect x="7.4" y="1" width="3.6" height="12" fill="${g}" ${s}/>`);
  if (state === 'play') return svg(11, tri(1));
  if (state === 'slow') return svg(16, tri(1) + `<rect x="12" y="1" width="3" height="12" fill="${g}" ${s}/>`);
  const m = /^(ff|rew)(\d)$/.exec(state);
  if (m) {
    const n = Number(m[2]) + 1, dir = m[1] === 'ff' ? 1 : -1;
    let body = '';
    for (let i = 0; i < n; i++) body += tri(1 + i * 7, dir);
    return svg(n * 7 + 4, body);
  }
  return '';
}

// ── backgrounds ───────────────────────────────────────────────────────────────
// Painted once per theme into a PNG data URL. Each theme mimics the SD menu
// photography: diagonal light beams, a glowing floor, a row of bokeh discs and a
// big soft orb on the right, all over a deep two-tone gradient.
const THEMES = {
  warm: {
    base: [[0, '#2a0403'], [0.36, '#5e0f09'], [0.68, '#94300f'], [1, '#d4782e']],
    beam: '255,196,104', glow: '255,150,58', bokeh: '255,218,170', orb: '255,200,140', src: [430, -70],
  },
  teal: {
    base: [[0, '#000304'], [0.45, '#00161b'], [0.75, '#003a42'], [1, '#00616b']],
    beam: '92,232,244', glow: '30,170,190', bokeh: '150,236,246', orb: '120,206,222', src: [560, -60],
  },
  violet: {
    base: [[0, '#040214'], [0.45, '#170d45'], [0.75, '#2e1f7a'], [1, '#5643b0']],
    beam: '190,170,255', glow: '120,90,230', bokeh: '214,200,255', orb: '180,160,255', src: [480, -70],
  },
  green: {
    base: [[0, '#010702'], [0.45, '#06240e'], [0.75, '#0f4a1e'], [1, '#2d7d3a']],
    beam: '170,250,170', glow: '70,200,100', bokeh: '200,255,200', orb: '150,230,160', src: [470, -70],
  },
};

const cache = {};

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function beamSprite(len, width, rgb) {
  const c = document.createElement('canvas');
  c.width = width; c.height = len;
  const x = c.getContext('2d');
  const across = x.createLinearGradient(0, 0, width, 0);
  across.addColorStop(0, `rgba(${rgb},0)`);
  across.addColorStop(0.5, `rgba(${rgb},1)`);
  across.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = across;
  x.fillRect(0, 0, width, len);
  x.globalCompositeOperation = 'destination-in';
  const along = x.createLinearGradient(0, 0, 0, len);
  along.addColorStop(0, 'rgba(0,0,0,1)');
  along.addColorStop(0.55, 'rgba(0,0,0,.45)');
  along.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = along;
  x.fillRect(0, 0, width, len);
  return c;
}

// A network logo on a light chip, the way the guide and banner showed them.
export function logoChip(ch, w, h) {
  return `<span class="logo" style="width:${w}px;height:${h}px"><img src="${ch.logo}" alt="${ch.call}"></span>`;
}

export function background(name) {
  if (cache[name]) return cache[name];
  const t = THEMES[name] || THEMES.warm;
  const W = 640, H = 480;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const rand = rng(name.length * 7919 + 17);

  const base = x.createLinearGradient(0, 0, W, H);
  for (const [o, col] of t.base) base.addColorStop(o, col);
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);

  x.globalCompositeOperation = 'lighter';

  // glow around the light source
  const [sx, sy] = t.src;
  let g = x.createRadialGradient(sx, sy, 0, sx, sy, 420);
  g.addColorStop(0, `rgba(${t.glow},.55)`);
  g.addColorStop(1, `rgba(${t.glow},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // beams fanning down from the source
  const beams = [[-62, 70, .36], [-38, 46, .5], [-20, 120, .3], [-8, 34, .62], [6, 80, .34], [24, 40, .46], [44, 140, .22], [70, 60, .2]];
  for (const [deg, width, alpha] of beams) {
    const sprite = beamSprite(760, width, t.beam);
    x.save();
    x.translate(sx, sy);
    x.rotate((deg * Math.PI) / 180);
    x.globalAlpha = alpha;
    x.drawImage(sprite, -width / 2, 0);
    x.restore();
  }
  x.globalAlpha = 1;

  // glowing floor band
  x.save();
  x.translate(330, 404);
  x.scale(1, 0.16);
  g = x.createRadialGradient(0, 0, 0, 0, 0, 420);
  g.addColorStop(0, `rgba(${t.glow},.75)`);
  g.addColorStop(0.6, `rgba(${t.glow},.22)`);
  g.addColorStop(1, `rgba(${t.glow},0)`);
  x.fillStyle = g;
  x.fillRect(-420, -420, 840, 840);
  x.restore();

  // big soft orb on the right
  g = x.createRadialGradient(560, 300, 10, 600, 330, 170);
  g.addColorStop(0, `rgba(${t.orb},.30)`);
  g.addColorStop(0.75, `rgba(${t.orb},.08)`);
  g.addColorStop(1, `rgba(${t.orb},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // bokeh discs receding to the left along the floor
  for (let i = 0; i < 16; i++) {
    const k = i / 15;
    const r = 4 + k * k * 30 + rand() * 4;
    const cx = 20 + k * 600 + (rand() - 0.5) * 30;
    const cy = 432 - k * 56 + (rand() - 0.5) * 18;
    const a = 0.25 + rand() * 0.35;
    const d = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    d.addColorStop(0, `rgba(${t.bokeh},${a * 0.45})`);
    d.addColorStop(0.82, `rgba(${t.bokeh},${a * 0.7})`);
    d.addColorStop(0.92, `rgba(${t.bokeh},${a})`);
    d.addColorStop(1, `rgba(${t.bokeh},0)`);
    x.fillStyle = d;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  }

  // vignette
  x.globalCompositeOperation = 'source-over';
  g = x.createRadialGradient(W / 2, H / 2, 160, W / 2, H / 2, 470);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.6)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // light grain so gradients don't band on composite video
  const img = x.getImageData(0, 0, W, H);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (rand() - 0.5) * 7;
    px[i] += n; px[i + 1] += n; px[i + 2] += n;
  }
  x.putImageData(img, 0, 0);

  cache[name] = c.toDataURL('image/png');
  return cache[name];
}
