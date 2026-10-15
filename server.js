// The box server. Serves the UI and streams programs: each film, episode, off-air
// recording or commercial is read from the media share, cut to 640x480 (letterboxed
// for 4:3) and encoded to H.264/AAC on the fly, starting at whatever second the
// schedule asks for. Live iptv-org channels go through the same pipeline. Clients
// ask by program id, never by path or URL, so the server only ever opens what's in
// ui/data/lineup.json.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Weather } from './weather.js';
import { GolfReport } from './golf.js';
import { plutoUrl, plutoGuide } from './pluto.js';
import { DVR } from './dvr.js';
import { LiveBuffer } from './livebuffer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'ui');
const port = Number(process.env.PORT) || 8640;
const host = process.env.HOST || '127.0.0.1';
// your own videos (folder() channels) and the DVR's recordings; default ./media
const mediaRoot = process.env.MEDIA_ROOT || path.join(here, 'media');
if (!process.env.MEDIA_ROOT) fs.mkdirSync(mediaRoot, { recursive: true });
const lineupPath = path.join(root, 'data', 'lineup.json');
const cacheDir = path.join(here, 'tools', '.cache', 'weather');
const weather = new Weather(cacheDir);
const golf = new GolfReport(weather);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8',
};

// ── encoder: hardware where it's known to work, libx264 otherwise ─────────────
const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
const ENCODER = process.env.ENCODER || (os.platform() === 'linux' && encoders.includes('h264_v4l2m2m') ? 'h264_v4l2m2m' : 'libx264');
const VIDEO_ARGS = {
  libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '21', '-maxrate', '2500k', '-bufsize', '5000k'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-b:v', '2500k', '-realtime', '1'],
  h264_v4l2m2m: ['-c:v', 'h264_v4l2m2m', '-b:v', '2500k'],
}[ENCODER];
const HWDEC = os.platform() === 'darwin' ? ['-hwaccel', 'videotoolbox'] : [];

// square the pixels, fit inside 640x480, pad the rest black
const FIT = 'scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2,'
  + 'pad=640:480:-1:-1:color=black,format=yuv420p';
// Off-air recordings and commercials are 4:3 broadcasts, whatever shape the file
// was saved in (720x480 with square pixels, or stretched to 1920x1080): crop any
// pillarbox bars the build found and fill the screen. yadif only touches frames
// flagged interlaced, as VHS captures often are.
const fill43 = (p) => `yadif=deint=interlaced,${p.box ? `crop=${p.box[0]}:ih:${p.box[1]}:0,` : ''}`
  + 'scale=640:480,setsar=1,format=yuv420p';
const MP4_OUT = ['-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '160k',
  '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-avoid_negative_ts', 'make_zero', 'pipe:1'];

// ── lineup (re-read when the build rewrites it) ───────────────────────────────
let lineup = { mtime: 0, programs: {}, channels: [] };
function current() {
  const { mtimeMs } = fs.statSync(lineupPath);
  if (mtimeMs !== lineup.mtime) {
    const l = JSON.parse(fs.readFileSync(lineupPath, 'utf8'));
    lineup = { mtime: mtimeMs, programs: l.programs, channels: l.channels };
  }
  return lineup;
}

function program(id) {
  if (id.startsWith('rec:')) return dvr.playable(id.slice(4));
  if (id.startsWith('buf:')) return liveBuffer.playable(id.slice(4));
  return current().programs[id];
}

// the channel a live program airs on
function channelOf(id) {
  const ch = current().channels.find((c) => c.live && Object.values(c.pools).some((p) => p.items?.includes(id)));
  return ch && { num: ch.num, call: ch.call, name: ch.name };
}

// a live channel's stream address right now (Pluto's are made per session)
function liveUrl(p) {
  return p.u.startsWith('pluto:') ? plutoUrl(p.u.slice(6)) : Promise.resolve(p.u);
}

// files that ship with the box (the weather channel's music)
function appFile(rel) {
  const file = path.resolve(here, rel);
  if (!file.startsWith(path.join(here, 'sounds') + path.sep)) throw new Error('outside sounds');
  return file;
}

function mediaFile(p) {
  const file = path.resolve(mediaRoot, p.f);
  if (!file.startsWith(path.resolve(mediaRoot) + path.sep)) throw new Error('outside media root');
  return file;
}

// Where a program's picture comes from: a file under MEDIA_ROOT, or (p.ia: "identifier/file")
// streamed from archive.org as it plays, never saved. Seeking is HTTP ranges, so joining
// mid-episode costs a second or two; a dropped connection picks up where it was.
function source(p) {
  if (!p.ia) return ['-i', p.abs || mediaFile(p)];
  const url = `https://archive.org/download/${p.ia.split('/').map(encodeURIComponent).join('/')}`;
  return ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10', '-rw_timeout', '20000000', '-i', url];
}

// ── processes: one playback stream at a time (it's one TV), latest frame wins ──
const active = { play: null, frame: null };
function run(kind, args, res, type, tag = null) {
  if (active[kind]) active[kind].kill('SIGKILL');
  const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args]);
  proc.tag = tag; // the live buffer it's reading, if any
  active[kind] = proc;
  let started = false;
  let err = '';
  proc.stdout.once('data', () => { started = true; });
  proc.stderr.on('data', (d) => { err += d; });
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  proc.stdout.pipe(res);
  const stop = () => proc.kill('SIGKILL');
  res.on('close', stop);
  proc.on('close', (code) => {
    if (active[kind] === proc) active[kind] = null;
    if (code && !started && err) console.error(`[${kind}] ${err.trim().split('\n').pop()}`);
    res.end();
  });
}

// radio: audio only, in the same fragmented MP4 so the same <video> element plays it
const RADIO_OUT = ['-vn', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '160k',
  '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof', '-frag_duration', '1000000', 'pipe:1'];

// The weather channel's music loops all day like a station, so tuning in joins a
// song already under way. ffmpeg's concat list starts at the right second.
function musicArgs(p) {
  const total = p.music.reduce((n, m) => n + m.secs, 0);
  let at = (Date.now() / 1000) % total;
  let i = 0;
  while (at >= p.music[i].secs) { at -= p.music[i].secs; i++; }
  const lines = [];
  for (let n = 0; n < p.music.length * 30; n++) {
    lines.push(`file '${appFile(p.music[(i + n) % p.music.length].f).replace(/'/g, "'\\''")}'`);
    if (n === 0) lines.push(`inpoint ${at.toFixed(2)}`);
  }
  const list = path.join(cacheDir, 'music.txt');
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return ['-readrate', '1', '-readrate_initial_burst', '3', '-f', 'concat', '-safe', '0', '-i', list, ...RADIO_OUT];
}

function playArgs(p, t) {
  if (p.k === 'weather') return musicArgs(p);
  if (p.k === 'rec') {
    // a DVR recording is already the box's 480p, so it streams as is; one still being
    // written is followed as it grows
    return ['-readrate', '1.5', '-readrate_initial_burst', '10', '-readrate_catchup', '20',
      ...(p.live ? ['-follow', '1', '-rw_timeout', '8000000'] : []), '-ss', String(t), ...source(p),
      '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-avoid_negative_ts', 'make_zero', 'pipe:1'];
  }
  if (p.k === 'radio') {
    return ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '15000000',
      '-i', p.u, ...RADIO_OUT];
  }
  if (p.k === 'live') {
    return ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '15000000',
      '-i', p.u, '-vf', FIT, ...VIDEO_ARGS, ...MP4_OUT];
  }
  // a quick burst so the picture starts at once, then about real time, so a stream never
  // runs far ahead of the viewer (or transcodes a whole film nobody is watching).
  // A commercial is one spot inside a file (a reel of breaks): it starts at its
  // offset and stops at its end.
  const spot = p.k === 'ad';
  const input = [...HWDEC, '-readrate', '1.5', '-readrate_initial_burst', '10', '-readrate_catchup', '20',
    '-ss', String(spot ? p.o + t : t), ...source(p), ...(spot ? ['-t', String(Math.max(0.5, p.len - t))] : [])];
  const audio = ['-map', p.ai != null ? `0:${p.ai}` : '0:a:0?'];
  const fit = p.k === 'tape' || spot ? fill43(p) : FIT;
  // picture-based subtitles (Blu-ray PGS, DVD VobSub) get burned in; text ones are drawn by the UI
  const video = p.sub?.k === 'image'
    ? ['-filter_complex', `[0:V:0][0:${p.sub.i}]overlay=(W-w)/2:H-h:format=auto,${fit}[v]`, '-map', '[v]']
    : ['-map', '0:V:0', '-vf', fit];
  return [...input, ...video, ...audio, ...VIDEO_ARGS, ...MP4_OUT];
}

// ── DVR and the live buffer ──────────────────────────────────────────────────
// Both record a live channel the same way: the box's 480p, as MPEG-TS, into a hidden
// folder of the media folder (Recordings/.inprogress), which media servers like Plex skip.
const work = process.env.DVR_WORK || path.join(mediaRoot, 'Recordings', '.inprogress');
const resolveLive = (id) => { const p = current().programs[id]; return p?.k === 'live' ? liveUrl(p) : Promise.reject(new Error('not a live channel')); };
const captureArgs = (u, secs, file) => ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
  '-rw_timeout', '15000000', '-i', u, '-sn', '-dn', '-vf', FIT, ...VIDEO_ARGS, '-g', '48', '-keyint_min', '48',
  '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '160k', '-t', String(secs), '-f', 'mpegts', file];
const dvr = new DVR({ root: mediaRoot, work, resolve: resolveLive, captureArgs });
const liveBuffer = new LiveBuffer({ work, resolve: resolveLive, captureArgs, watching: (id) => active.play?.tag === id,
  ready: () => dvr.ready });

// GET /api/live?id=<live program> starts (or keeps) the buffer: { buf, start };
// POST /api/live/stop clears it.
async function liveApi(req, url, res) {
  if (url.pathname === '/api/live/stop') { liveBuffer.stop(); return json(res, 200, {}); }
  try {
    return json(res, 200, await liveBuffer.start(url.searchParams.get('id') || ''));
  } catch (err) {
    return json(res, 502, { error: err.message });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

// GET the list; POST { program, start, end, title, ep, desc } to record; POST /api/dvr/stop
// and DELETE with ?rid= to stop or delete.
async function dvrApi(req, url, res) {
  const rid = url.searchParams.get('rid');
  if (req.method === 'GET') return json(res, 200, { tuners: 2, ready: dvr.ready, items: dvr.list() });
  if (req.method === 'DELETE') return json(res, dvr.remove(rid) ? 200 : 404, {});
  if (req.method === 'POST' && url.pathname === '/api/dvr/stop') return json(res, dvr.stop(rid) ? 200 : 404, {});
  if (req.method !== 'POST') return json(res, 405, {});
  const b = await readJson(req);
  const p = current().programs[b.program];
  const channel = p?.k === 'live' && channelOf(b.program);
  if (!channel) return json(res, 400, { error: 'not a live channel' });
  const r = dvr.add({ program: b.program, channel, title: String(b.title || channel.name).slice(0, 120),
    ep: String(b.ep || '').slice(0, 120), desc: String(b.desc || '').slice(0, 600), start: Number(b.start), end: Number(b.end) });
  return json(res, r.error ? 409 : 200, r);
}

// What's on the Pluto channels, from Pluto's guide: { programId: [{ start, end, title, ep, desc }] }
let epg = { at: 0, data: {} };
async function epgApi(res) {
  if (Date.now() - epg.at > 20 * 60e3) {
    const live = Object.entries(current().programs).filter(([, p]) => p.k === 'live' && p.u.startsWith('pluto:'));
    try {
      const byChannel = await plutoGuide(live.map(([, p]) => p.u.slice(6)), 24);
      epg = { at: Date.now(), data: Object.fromEntries(live.map(([id, p]) => [id, byChannel[p.u.slice(6)] || []])) };
    } catch (err) {
      console.error(`[epg] ${err.message}`);
      epg.at = Date.now() - 15 * 60e3; // try again in five minutes
    }
  }
  json(res, 200, epg.data);
}

function api(url, res) {
  const id = url.searchParams.get('id');
  const t = Math.max(0, Number(url.searchParams.get('t')) || 0);
  const p = id && program(id);
  if (!p || (!['live', 'radio', 'weather'].includes(p.k) && !p.f && !p.abs && !p.ia)) return res.writeHead(404).end('no such program');

  switch (url.pathname) {
    case '/api/play':
      if (p.k === 'live' && p.u.startsWith('pluto:')) {
        return liveUrl(p)
          .then((u) => run('play', playArgs({ ...p, u }, t), res, 'video/mp4'))
          .catch((err) => { console.error(`[pluto] ${err.message}`); if (!res.headersSent) res.writeHead(502).end(); });
      }
      return run('play', playArgs(p, t), res, 'video/mp4', p.buf);
    case '/api/nowplaying':
      if (p.k !== 'radio') return res.writeHead(404).end();
      return nowPlaying(id, p.u).then((title) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ title }));
      });
    case '/api/weather':
      if (p.k !== 'weather') return res.writeHead(404).end();
      return (p.style === 'golf' ? golf.report(p) : weather.report(p)).then((report) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(report));
      });
    case '/api/radar':
      if (p.k !== 'weather') return res.writeHead(404).end();
      return weather.radar(p).then((r) => {
        if (!r) return res.writeHead(503).end();
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Radar-Time': String(r.at) });
        res.end(r.png);
      });
    case '/api/frame':
      if (p.k === 'live' || p.k === 'radio' || p.k === 'weather') return res.writeHead(404).end();
      return run('frame', ['-ss', String(p.k === 'ad' ? p.o + t : t), ...source(p), '-map', '0:V:0', '-frames:v', '1',
        '-vf', p.k === 'tape' || p.k === 'ad' ? fill43(p) : FIT,
        '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], res, 'image/jpeg');
    case '/api/subs': {
      // a window of a text subtitle track as WebVTT, timed from t
      if (p.sub?.k !== 'text') return res.writeHead(404).end();
      const d = Math.min(1800, Number(url.searchParams.get('d')) || 600);
      const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(t), '-i', mediaFile(p),
        '-t', String(d), '-map', `0:${p.sub.i}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1']);
      res.writeHead(200, { 'Content-Type': TYPES['.vtt'], 'Cache-Control': 'no-store' });
      proc.stdout.pipe(res);
      res.on('close', () => proc.kill('SIGKILL'));
      return;
    }
    default:
      return res.writeHead(404).end();
  }
}

// ── radio now-playing: read the first ICY metadata block (StreamTitle) ───────
const titles = new Map();
function nowPlaying(id, url) {
  const hit = titles.get(id);
  if (hit && Date.now() - hit.at < 15000) return Promise.resolve(hit.title);
  return icyTitle(url).then((title) => { titles.set(id, { title, at: Date.now() }); return title; });
}

function icyTitle(url, redirects = 4) {
  return new Promise((resolve) => {
    const get = url.startsWith('https:') ? https.get : http.get;
    const req = get(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'TiVoBox/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects) {
        res.resume();
        req.destroy();
        return resolve(icyTitle(new URL(res.headers.location, url).href, redirects - 1));
      }
      const every = Number(res.headers['icy-metaint']);
      if (!every) { req.destroy(); return resolve(''); }
      let buf = Buffer.alloc(0);
      res.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length <= every) return;
        const len = buf[every] * 16;
        if (buf.length < every + 1 + len) return;
        const meta = buf.subarray(every + 1, every + 1 + len).toString('utf8');
        req.destroy();
        resolve((/StreamTitle='([^']*)'/.exec(meta) || [])[1] || '');
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(8000, () => { req.destroy(); resolve(''); });
  });
}

// ── static files (with byte ranges for the placeholder clips) ────────────────
function serveStatic(pathname, req, res) {
  let file = path.join(root, path.normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || path.basename(file).startsWith('._')) return res.writeHead(404).end('not found');
  const { size } = fs.statSync(file);
  const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/dvr' || url.pathname === '/api/dvr/stop') {
      return dvrApi(req, url, res).catch((err) => { console.error(`[dvr] ${err.message}`); if (!res.headersSent) json(res, 400, {}); });
    }
    if (url.pathname === '/api/epg') return epgApi(res);
    if (url.pathname === '/api/live' || url.pathname === '/api/live/stop') return liveApi(req, url, res);
    if (url.pathname.startsWith('/api/')) return api(url, res);
    serveStatic(url.pathname, req, res);
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) res.writeHead(500).end();
  }
}).listen(port, host, () => {
  console.log(`TiVo box → http://${host}:${port}  (listings: /listings.html, design board: /design.html)`);
  console.log(`media: ${mediaRoot}  encoder: ${ENCODER}`);
});
