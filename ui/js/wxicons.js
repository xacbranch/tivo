// Weather icons in the WeatherStar 4000's style: a shaded orange sun with pointed
// rays, puffy outlined clouds, yellow bolts, blue-gray rain and white flakes. Drawn
// as SVG on a 64×64 grid; the gradients live once in WX_DEFS.

export const WX_DEFS = `
  <radialGradient id="wxSun" cx=".42" cy=".38" r=".62">
    <stop offset="0" stop-color="#fff7b0"/><stop offset=".45" stop-color="#ffd21c"/><stop offset="1" stop-color="#ee8a00"/>
  </radialGradient>
  <linearGradient id="wxRay" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffe95a"/><stop offset="1" stop-color="#f0a400"/>
  </linearGradient>
  <linearGradient id="wxCloud" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="27">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#d9d9e2"/><stop offset="1" stop-color="#9c9cae"/>
  </linearGradient>
  <linearGradient id="wxStorm" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="27">
    <stop offset="0" stop-color="#d8d8e2"/><stop offset=".6" stop-color="#9d9db0"/><stop offset="1" stop-color="#6c6c80"/>
  </linearGradient>
  <linearGradient id="wxMoon" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fffbd0"/><stop offset="1" stop-color="#e9c750"/>
  </linearGradient>`;

const INK = '#23202e';

function sun(cx, cy, r) {
  let rays = '';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const pt = (rad, da) => `${(cx + rad * Math.cos(a + da)).toFixed(1)},${(cy + rad * Math.sin(a + da)).toFixed(1)}`;
    rays += `<polygon points="${pt(r * 1.08, -0.2)} ${pt(r * 1.78, 0)} ${pt(r * 1.08, 0.2)}"/>`;
  }
  return `<g fill="url(#wxRay)" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round">${rays}</g>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#wxSun)" stroke="${INK}" stroke-width="1.6"/>`;
}

function moon(cx, cy, r) {
  // a crescent: round the left of the disk, back up a shallower inner curve
  const x = (cx + r * 0.35).toFixed(1);
  const top = (cy - r * 0.94).toFixed(1);
  const bottom = (cy + r * 0.94).toFixed(1);
  return `<path d="M${x},${top} A${r},${r} 0 1,0 ${x},${bottom} A${r * 1.1},${r * 1.1} 0 0,1 ${x},${top} Z"
    fill="url(#wxMoon)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

// A cloud is a few circles over a rounded base. The outline pass is drawn first and
// thicker, so only the outer edge shows.
const PUFFS = '<circle cx="12" cy="17" r="9"/><circle cx="22" cy="11" r="11"/><circle cx="33" cy="15" r="9"/><rect x="3" y="15" width="38" height="12" rx="6"/>';
function cloud(x, y, s = 1, fill = 'wxCloud') {
  const t = `translate(${x} ${y}) scale(${s})`;
  return `<g transform="${t}" fill="${INK}" stroke="${INK}" stroke-width="${3.4 / s}">${PUFFS}</g>`
    + `<g transform="${t}" fill="url(#${fill})">${PUFFS}</g>`;
}

function drops(xs, y, color = '#7fb2ff', len = 9) {
  return xs.map((x) => `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + len}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
    + `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + len}" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`).join('');
}

function flakes(pts, r = 4.2) {
  return pts.map(([x, y]) => {
    let arms = '';
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 2;
      const dx = (r * Math.cos(a)).toFixed(1);
      const dy = (r * Math.sin(a)).toFixed(1);
      arms += `M${x - dx},${y - dy}L${+x + +dx},${+y + +dy}`;
    }
    return `<path d="${arms}" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/><path d="${arms}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');
}

function bolt(x, y, s = 1) {
  return `<polygon transform="translate(${x} ${y}) scale(${s})" points="7,0 17,0 12,8 18,8 4,24 8,12 2,12"
    fill="#ffe83a" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function bars(ys, color, x0 = 8, x1 = 56) {
  return ys.map((y, i) => {
    const a = x0 + (i % 2) * 6;
    const b = x1 - ((i + 1) % 2) * 6;
    return `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`
      + `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
  }).join('');
}

function gusts() {
  const d = ['M6,30 C20,26 34,34 50,28 C56,26 58,20 53,18', 'M10,40 C24,36 38,44 56,38', 'M4,50 C18,46 30,54 46,48 C52,46 54,40 49,39'];
  return d.map((p) => `<path d="${p}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`
    + `<path d="${p}" fill="none" stroke="#f4f4ff" stroke-width="3" stroke-linecap="round"/>`).join('');
}

const ICONS = {
  sunny: () => sun(32, 32, 14),
  clear: () => moon(32, 32, 17),
  pcloudy: () => sun(25, 24, 12) + cloud(17, 30, 1.05),
  'pcloudy-n': () => moon(24, 23, 13) + cloud(17, 30, 1.05),
  mcloudy: () => sun(42, 20, 9) + cloud(6, 22, 1.18),
  'mcloudy-n': () => moon(42, 20, 10) + cloud(6, 22, 1.18),
  cloudy: () => cloud(19, 11, 0.95, 'wxStorm') + cloud(3, 25, 1.15),
  rain: () => cloud(8, 6, 1.12, 'wxStorm') + drops([20, 32, 44], 40) + drops([26, 38], 50),
  showers: () => sun(46, 17, 10) + cloud(5, 12, 1.12) + drops([18, 30, 42], 44),
  tstorm: () => cloud(8, 6, 1.12, 'wxStorm') + bolt(24, 32, 1.15),
  sctstorm: () => sun(44, 18, 10) + cloud(4, 14, 1.1, 'wxStorm') + bolt(18, 38, 1.0),
  snow: () => cloud(8, 6, 1.12) + flakes([[18, 44], [32, 48], [46, 44], [25, 56], [39, 56]]),
  snowshowers: () => sun(46, 17, 10) + cloud(5, 12, 1.12) + flakes([[18, 48], [32, 52], [46, 48]]),
  mix: () => cloud(8, 6, 1.12, 'wxStorm') + drops([20, 44], 40) + flakes([[32, 46], [26, 57], [44, 56]]),
  sleet: () => cloud(8, 6, 1.12, 'wxStorm') + drops([20, 36, 50], 40, '#bfe4ff', 7)
    + flakes([[28, 54], [44, 55]], 2.6),
  fzrain: () => cloud(8, 6, 1.12, 'wxStorm') + drops([20, 32, 44], 40, '#c9f0ff') + drops([26, 38], 50, '#c9f0ff'),
  fog: () => cloud(10, 6, 0.95) + bars([36, 45, 54], '#c9c9d4'),
  haze: () => sun(32, 26, 13) + bars([40, 49, 58], '#e3c98e'),
  smoke: () => sun(32, 24, 11) + bars([34, 43, 52], '#8d8a92'),
  dust: () => bars([22, 31, 40, 49], '#c99a5a'),
  wind: () => cloud(10, 2, 0.8) + gusts(),
  blowsnow: () => gusts() + flakes([[14, 18], [30, 14], [46, 20]], 3.6),
};

export function wxIcon(kind, size = 64) {
  const draw = ICONS[kind] || ICONS.cloudy;
  return `<svg class="wx-icon" viewBox="0 0 64 64" width="${size}" height="${size}">${draw()}</svg>`;
}

// what the icon means, in the WeatherStar's words, for when NWS's text runs long
export const ICON_WORDS = {
  sunny: 'Sunny', clear: 'Clear', pcloudy: 'Partly Cloudy', 'pcloudy-n': 'Partly Cloudy', mcloudy: 'Mostly Cloudy',
  'mcloudy-n': 'Mostly Cloudy', cloudy: 'Cloudy', rain: 'Rain', showers: 'Showers', tstorm: "T'Storms",
  sctstorm: "Scattered T'Storms", snow: 'Snow', snowshowers: 'Snow Showers', mix: 'Rain/Snow', sleet: 'Sleet',
  fzrain: 'Freezing Rain', fog: 'Fog', haze: 'Haze', smoke: 'Smoke', dust: 'Blowing Dust', wind: 'Windy',
  blowsnow: 'Blowing Snow',
};
