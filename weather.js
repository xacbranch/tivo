// The weather channel's data: current conditions, forecasts, alerts and radar for
// New Mexico from the National Weather Service (api.weather.gov, no key needed),
// plus the daily horoscopes for the crawl (freehoroscopeapi.com, no key either).
// Everything is cached, so NWS hears from the box every few minutes at most, no
// matter how often the screens ask. Values come back in the units the old
// WeatherStar showed: °F, mph, miles, feet and inches of mercury.
import fs from 'node:fs';
import path from 'node:path';

const NWS = 'https://api.weather.gov';
const RADAR = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
const HOROSCOPE = 'https://freehoroscopeapi.com/api/v1/get-horoscope/daily';
const UA = 'TiVoBox/1.0 (personal weather channel)';
const TTL = { obs: 10 * 60e3, fc: 30 * 60e3, alerts: 5 * 60e3, radar: 5 * 60e3, stars: 60 * 60e3 };

export class Weather {
  constructor(cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true });
    this.pointsFile = path.join(cacheDir, 'nws-points.json');
    try { this.points = JSON.parse(fs.readFileSync(this.pointsFile, 'utf8')); } catch { this.points = {}; }
    this.entries = new Map();
    this.resolving = new Map();
  }

  async fetch(url, image = false, accept = 'application/geo+json') {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: image ? 'image/png' : accept },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return image ? Buffer.from(await res.arrayBuffer()) : res.json();
  }

  // The cached value for key, refreshed in the background once it's older than ttl.
  // Only the very first ask waits for the network.
  cached(key, ttl, load) {
    let e = this.entries.get(key);
    if (!e) this.entries.set(key, (e = { at: 0, value: null, pending: null }));
    if (Date.now() - e.at > ttl && !e.pending) {
      e.pending = load()
        .then((value) => { e.value = value; e.at = Date.now(); })
        .catch((err) => { console.error(`[weather] ${err.message}`); e.at = Date.now() - ttl + 60e3; })
        .finally(() => { e.pending = null; });
    }
    if (e.value != null || !e.pending) return Promise.resolve(e.value);
    return e.pending.then(() => e.value);
  }

  // Forecast grid and nearest observing station for a place; looked up once, kept on disk.
  point(city) {
    const key = `${city.lat},${city.lon}`;
    if (this.points[key]) return Promise.resolve(this.points[key]);
    if (!this.resolving.has(key)) {
      this.resolving.set(key, (async () => {
        const p = (await this.fetch(`${NWS}/points/${key}`)).properties;
        const stations = await this.fetch(p.observationStations);
        this.points[key] = { forecast: p.forecast, station: stations.features[0].properties.stationIdentifier };
        fs.writeFileSync(this.pointsFile, JSON.stringify(this.points, null, 1));
        return this.points[key];
      })().finally(() => this.resolving.delete(key)));
    }
    return this.resolving.get(key);
  }

  async report(program) {
    const cities = await mapLimit(program.cities, 6, async (city) => {
      try {
        const pt = await this.point(city);
        const station = city.station || pt.station;
        const [obs, fc] = await Promise.all([
          station === 'grid'
            ? this.cached(`hourly:${pt.forecast}`, TTL.obs, () => this.thisHour(pt.forecast))
            : this.cached(`obs:${station}`, TTL.obs, () => this.observe(station)),
          this.cached(`fc:${pt.forecast}`, TTL.fc, () => this.forecast(pt.forecast)),
        ]);
        // weather-watcher and fire stations report temperature but not the sky:
        // borrow the sky from the forecast for right now
        const sky = obs && !obs.text && fc?.[0] ? { text: fc[0].short.split(/ then /i)[0], icon: fc[0].icon, day: fc[0].day } : null;
        // the home city's pressure trend, against the reading three hours ago
        let trend = null;
        if (city.name === program.home && obs?.pressure != null) {
          const before = await this.cached(`p3h:${station}`, TTL.obs, () => this.pressureAgo(station)).catch(() => null);
          if (before) trend = { trend: obs.pressure - before > 0.02 ? 'R' : obs.pressure - before < -0.02 ? 'F' : 'S' };
        }
        return { ...city, station, obs: obs && { ...obs, ...sky, ...trend }, fc };
      } catch (err) {
        console.error(`[weather] ${city.name}: ${err.message}`);
        return { ...city, obs: null, fc: null };
      }
    });
    const home = program.cities.find((c) => c.name === program.home) || program.cities[0];
    const alerts = await this.cached(`alerts:${home.name}`, TTL.alerts, () => this.alerts(home)).catch(() => []);
    const horoscopes = (await Promise.all((program.horoscopes || []).map((h) => this.cached(`stars:${h.sign}`, TTL.stars,
      () => this.horoscope(h.sign)).then((text) => text && { ...h, text }).catch(() => null)))).filter(Boolean);
    return { updated: Date.now(), home: home.name, cities, alerts: alerts || [], horoscopes };
  }

  // Latest observation that has a temperature (some stations skip a report).
  async observe(station) {
    const list = (await this.fetch(`${NWS}/stations/${station}/observations?limit=6`)).features.map((f) => f.properties);
    const cur = list.find((p) => p.temperature?.value != null);
    if (!cur) return null;
    const v = (q) => q?.value ?? null;
    const inHg = (p) => (v(p.barometricPressure) ?? v(p.seaLevelPressure));
    const pressure = inHg(cur) != null ? inHg(cur) / 3386.389 : null;
    const speed = v(cur.windSpeed);
    const ceilingLayer = (cur.cloudLayers || [])
      .filter((l) => ['BKN', 'OVC', 'VV'].includes(l.amount) && l.base?.value != null)
      .sort((a, b) => a.base.value - b.base.value)[0];
    const visM = v(cur.visibility);
    const day = cur.icon ? cur.icon.includes('/day/') : isDay(new Date(cur.timestamp));
    return {
      time: cur.timestamp,
      text: cur.textDescription || '',
      icon: iconKind(cur.icon, day) || textKind(cur.textDescription, day),
      day,
      temp: f(v(cur.temperature)),
      dew: f(v(cur.dewpoint)),
      rh: v(cur.relativeHumidity) != null ? Math.round(v(cur.relativeHumidity)) : null,
      wind: speed == null ? null : { dir: compass(v(cur.windDirection)), mph: Math.round(speed / 1.609344) },
      gust: v(cur.windGust) != null ? Math.round(v(cur.windGust) / 1.609344) : null,
      pressure: pressure != null ? +pressure.toFixed(2) : null,
      trend: '',
      vis: visM == null ? null : visM >= 16000 ? 10 : visM >= 1609 ? Math.round(visM / 1609.344) : +(visM / 1609.344).toFixed(1),
      ceiling: ceilingLayer ? Math.round((ceilingLayer.base.value * 3.28084) / 100) * 100 : null,
      chill: f(v(cur.windChill)),
      heat: f(v(cur.heatIndex)),
    };
  }

  // For a place with no station: NWS's hourly forecast for the current hour, on the
  // 2.5 km grid at that spot. It has temperature, sky, wind, humidity and dewpoint.
  async thisHour(forecastUrl) {
    const periods = (await this.fetch(`${forecastUrl}/hourly`)).properties.periods;
    const now = Date.now();
    const p = periods.find((x) => new Date(x.startTime) <= now && now < new Date(x.endTime)) || periods[0];
    if (!p) return null;
    const mph = parseInt(p.windSpeed, 10);
    return {
      time: p.startTime, text: p.shortForecast, day: p.isDaytime,
      icon: iconKind(p.icon, p.isDaytime) || textKind(p.shortForecast, p.isDaytime),
      temp: p.temperature, dew: f(p.dewpoint?.value), rh: p.relativeHumidity?.value ?? null,
      wind: Number.isNaN(mph) ? null : { dir: p.windDirection, mph }, gust: null, pressure: null, trend: '',
      vis: null, ceiling: null, chill: null, heat: null, grid: true,
    };
  }

  // today's horoscope for a sign, as one paragraph
  async horoscope(sign) {
    const res = await this.fetch(`${HOROSCOPE}?sign=${sign.toLowerCase()}&day=TODAY`, false, 'application/json');
    return (res.data?.horoscope || '').replace(/\s+/g, ' ').trim() || null;
  }

  // station pressure about three hours ago, in inches
  async pressureAgo(station) {
    const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
    const list = (await this.fetch(`${NWS}/stations/${station}/observations?start=${iso(3.25)}&end=${iso(2.75)}`)).features;
    const p = list.map((f) => f.properties).find((o) => (o.barometricPressure?.value ?? o.seaLevelPressure?.value) != null);
    return p ? (p.barometricPressure?.value ?? p.seaLevelPressure.value) / 3386.389 : null;
  }

  async forecast(url) {
    const periods = (await this.fetch(url)).properties.periods;
    return periods.map((p) => ({
      name: p.name,
      start: p.startTime,
      day: p.isDaytime,
      temp: p.temperature,
      short: p.shortForecast,
      detail: p.detailedForecast,
      icon: iconKind(p.icon, p.isDaytime) || textKind(p.shortForecast, p.isDaytime),
      pop: p.probabilityOfPrecipitation?.value ?? null,
      wind: p.windSpeed || '',
      wdir: p.windDirection || '',
    }));
  }

  // NWS's hour-by-hour forecast for a grid: temperature, wind, rain chance and sky.
  async hourly(forecastUrl) {
    const periods = (await this.fetch(`${forecastUrl}/hourly`)).properties.periods;
    return periods.slice(0, 48).map((p) => ({
      start: p.startTime,
      day: p.isDaytime,
      temp: p.temperature,
      mph: Math.max(...String(p.windSpeed || '0').match(/\d+/g)?.map(Number) || [0]),
      dir: p.windDirection || '',
      pop: p.probabilityOfPrecipitation?.value ?? 0,
      rh: p.relativeHumidity?.value ?? null,
      short: p.shortForecast || '',
      icon: iconKind(p.icon, p.isDaytime) || textKind(p.shortForecast, p.isDaytime),
    }));
  }

  // Rain at a station over the last `hours`, in inches, from its hourly reports.
  async rainSince(station, hours) {
    const start = new Date(Date.now() - hours * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
    const list = (await this.fetch(`${NWS}/stations/${station}/observations?start=${start}`)).features.map((f) => f.properties);
    let mm = 0;
    let mm24 = 0;
    const day = Date.now() - 24 * 3600e3;
    for (const o of list) {
      const v = o.precipitationLastHour?.value;
      if (v == null) continue;
      mm += v;
      if (Date.parse(o.timestamp) >= day) mm24 += v;
    }
    return { inches: +(mm / 25.4).toFixed(2), recent24: +(mm24 / 25.4).toFixed(2) };
  }

  async alerts(home) {
    const features = (await this.fetch(`${NWS}/alerts/active?point=${home.lat},${home.lon}`)).features;
    const rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
    return features.map((a) => a.properties)
      .filter((a) => a.status === 'Actual')
      .sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4))
      .map((a) => ({ event: a.event, headline: a.headline, ends: a.ends || a.expires }));
  }

  // Base reflectivity for the radar map, as a small PNG the screen draws in blocks.
  radar(program) {
    const r = program.radar;
    const url = `${RADAR}?service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd&styles=&srs=EPSG:4326`
      + `&bbox=${r.bbox.join(',')}&width=${r.w}&height=${r.h}&format=image/png&transparent=true`;
    return this.cached(`radar:${program.radar.bbox}`, TTL.radar, () => this.fetch(url, true).then((png) => ({ png, at: Date.now() })));
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export const f = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32));
export const compass =(deg) => (deg == null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16]);
const isDay = (d) => d.getHours() >= 6 && d.getHours() < 18;

// NWS icon codes (".../icons/land/day/tsra_sct,40/sct?size=medium") to the WeatherStar's
// icon set. A period that changes halfway shows its wetter half.
const CODES = {
  skc: 'sunny', few: 'sunny', sct: 'pcloudy', bkn: 'mcloudy', ovc: 'cloudy',
  wind_skc: 'wind', wind_few: 'wind', wind_sct: 'wind', wind_bkn: 'wind', wind_ovc: 'wind',
  snow: 'snow', rain_snow: 'mix', rain_sleet: 'sleet', snow_sleet: 'sleet', fzra: 'fzrain', rain_fzra: 'fzrain',
  snow_fzra: 'fzrain', sleet: 'sleet', rain: 'rain', rain_showers: 'rain', rain_showers_hi: 'showers',
  tsra: 'tstorm', tsra_sct: 'sctstorm', tsra_hi: 'sctstorm', tornado: 'tstorm', hurricane: 'tstorm',
  tropical_storm: 'tstorm', dust: 'dust', smoke: 'smoke', haze: 'haze', hot: 'sunny', cold: 'sunny',
  blizzard: 'blowsnow', fog: 'fog',
};
const DRY = new Set(['sunny', 'pcloudy', 'mcloudy', 'cloudy', 'wind', 'haze', 'smoke', 'dust']);

function iconKind(url, day) {
  const m = /\/icons\/land\/(?:day|night)\/([^?]+)/.exec(url || '');
  if (!m) return null;
  const kinds = m[1].split('/').map((part) => CODES[part.split(',')[0]]).filter(Boolean);
  if (!kinds.length) return null;
  const kind = kinds.find((k) => !DRY.has(k)) || kinds[0];
  return night(kind, day);
}

function textKind(text, day) {
  const t = (text || '').toLowerCase();
  const kind = /thunder|t-storm/.test(t) ? (/slight|chance|isolated|scattered/.test(t) ? 'sctstorm' : 'tstorm')
    : /blizzard|blowing snow/.test(t) ? 'blowsnow'
      : /freezing/.test(t) ? 'fzrain'
        : /sleet|ice pellets/.test(t) ? 'sleet'
          : /snow/.test(t) && /rain/.test(t) ? 'mix'
            : /snow/.test(t) ? 'snow'
              : /shower/.test(t) ? 'showers'
                : /rain|drizzle/.test(t) ? 'rain'
                  : /fog|mist/.test(t) ? 'fog'
                    : /smoke/.test(t) ? 'smoke'
                      : /haze/.test(t) ? 'haze'
                        : /dust|sand/.test(t) ? 'dust'
                          : /wind|breez|blustery/.test(t) ? 'wind'
                            : /overcast|^cloudy/.test(t) ? 'cloudy'
                              : /mostly cloudy|partly sunny|considerable/.test(t) ? 'mcloudy'
                                : /partly cloudy|mostly sunny|mostly clear/.test(t) ? 'pcloudy'
                                  : 'sunny';
  return night(kind, day);
}

// clear and partly cloudy skies get the moon at night
function night(kind, day) {
  if (day) return kind;
  return { sunny: 'clear', pcloudy: 'pcloudy-n', mcloudy: 'mcloudy-n' }[kind] || kind;
}
