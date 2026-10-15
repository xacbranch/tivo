// The almanac's sky: sunrise and sunset (the standard NOAA/SunCalc solution) and
// the dates of the moon's phases (Meeus, Astronomical Algorithms ch. 49, main terms:
// good to a few minutes, plenty for a date).

const RAD = Math.PI / 180;
const DAY_MS = 864e5;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);

// Sunrise and sunset on the local calendar day of `date`, as Dates (null in polar day/night).
export function sunTimes(date, lat, lon) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const lw = -lon * RAD;
  const phi = lat * RAD;
  const n = Math.round(toDays(noon) - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const transit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (Math.abs(cosH) > 1) return { rise: null, set: null };
  const H = Math.acos(cosH);
  const set = transit + H / (2 * Math.PI);
  return { rise: fromJulian(transit - (set - transit)), set: fromJulian(set) };
}

// The next `count` principal phases after `from`: [{ phase: 'New'|'First'|'Full'|'Last', date }]
export function moonPhases(from, count = 4) {
  const names = ['New', 'First', 'Full', 'Last'];
  const year = from.getFullYear() + from.getMonth() / 12;
  let k = Math.floor((year - 2000) * 12.3685) - 1;
  const out = [];
  for (let step = 0; out.length < count && step < 40; step++) {
    const q = step % 4;
    const kk = k + Math.floor(step / 4) + q / 4;
    const date = phaseDate(kk, q);
    if (date > from) out.push({ phase: names[q], date });
  }
  return out;
}

function phaseDate(k, q) {
  const T = k / 1236.85;
  const deg = (x) => RAD * (((x % 360) + 360) % 360);
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = deg(2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3);
  const Mp = deg(201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4);
  const F = deg(160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4);
  const s = Math.sin;
  if (q === 0) {
    jde += -0.4072 * s(Mp) + 0.17241 * E * s(M) + 0.01608 * s(2 * Mp) + 0.01039 * s(2 * F)
      + 0.00739 * E * s(Mp - M) - 0.00514 * E * s(Mp + M) + 0.00208 * E * E * s(2 * M);
  } else if (q === 2) {
    jde += -0.40614 * s(Mp) + 0.17302 * E * s(M) + 0.01614 * s(2 * Mp) + 0.01043 * s(2 * F)
      + 0.00734 * E * s(Mp - M) - 0.00515 * E * s(Mp + M) + 0.00209 * E * E * s(2 * M);
  } else {
    const c = Math.cos;
    jde += -0.62801 * s(Mp) + 0.17172 * E * s(M) - 0.01183 * E * s(Mp + M) + 0.00862 * s(2 * Mp)
      + 0.00804 * s(2 * F) + 0.00454 * E * s(Mp - M) + 0.00204 * E * E * s(2 * M);
    const W = 0.00306 - 0.00038 * E * c(M) + 0.00026 * c(Mp) - 0.00002 * c(Mp - M) + 0.00002 * c(Mp + M) + 0.00002 * c(2 * F);
    jde += q === 1 ? W : -W;
  }
  return new Date((jde - 2440587.5) * DAY_MS);
}
