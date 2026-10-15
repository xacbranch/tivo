// The DVR. Records the live channels to the media folder (MEDIA_ROOT/Recordings) on two
// tuners, like a Series 3. A recording is the same 480p H.264 the box plays, written
// as MPEG-TS into Recordings/.inprogress while it runs (so it can be watched while
// it's still recording), then remuxed to an MP4 next to the others when it's done.
// Everything lives in the media folder (point MEDIA_ROOT at a NAS share if you like). The list lives next to the files, in
// Recordings/recordings.json, so it survives restarts and travels with the share.
// Recordings run on the server's clock: the TV can be off.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const TUNERS = 2;
const EARLY = 30e3;  // start a little early...
const LATE = 60e3;   // ...and run a little long, like a TiVo's padding
const RETRY_MS = 5000;

export class DVR {
  // root: the media root; captureArgs(url, seconds, file): the ffmpeg arguments for one
  // capture; resolve(programId): the live stream's URL right now
  constructor({ root, work, captureArgs, resolve }) {
    this.root = root;
    this.work = work; // the folder for recordings in progress
    this.dir = path.join(root, 'Recordings');
    this.indexFile = path.join(this.dir, 'recordings.json');
    this.captureArgs = captureArgs;
    this.resolve = resolve;
    this.procs = new Map();
    this.waiting = new Set(); // recordings between parts (stream down, retrying)
    this.items = [];
    this.loaded = false;
    setInterval(() => this.tick(), 10e3).unref();
    this.tick();
  }

  // The media folder has to be there. If MEDIA_ROOT is a network share, set
  // REQUIRE_MOUNTED=1 so an unmounted share (an empty mount point) never gets recordings
  // (or a fresh, empty list over the real one) written onto the local disk instead.
  get ready() {
    try {
      const entries = fs.readdirSync(this.root);
      return process.env.REQUIRE_MOUNTED ? entries.length > 0 : true;
    } catch { return false; }
  }

  load() {
    try { this.items = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); } catch { this.items = []; }
    // anything caught mid-recording by a restart: pick it back up, or wrap it up
    for (const r of this.items) if (r.status === 'recording' || r.status === 'processing') r.status = 'resume';
    this.loaded = true;
  }

  save() {
    if (!this.ready) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 1));
    fs.renameSync(tmp, this.indexFile);
  }

  list() {
    const now = Date.now();
    return this.items.map((r) => ({ ...r, secs: r.status === 'recording' ? Math.round((now - r.began) / 1000) + (r.done || 0) : r.secs }));
  }

  get(rid) { return this.items.find((r) => r.rid === rid); }

  // Schedule (or, if it's on now, start) a recording. Two tuners: a third show at
  // the same time is a conflict.
  add({ program, channel, title, ep = '', desc = '', start, end }) {
    if (!this.loaded) return { error: 'nas' };
    const now = Date.now();
    if (!(end > now) || !(end > start)) return { error: 'over' };
    const dup = this.items.find((r) => r.program === program && r.start === start && ['scheduled', 'recording', 'resume'].includes(r.status));
    if (dup) return { rid: dup.rid };
    const busy = this.items.filter((r) => ['scheduled', 'recording', 'resume'].includes(r.status) && r.start < end && r.end > start);
    if (busy.length >= TUNERS) return { error: 'conflict', with: busy.map((r) => `${r.channel.num} ${r.title}`) };
    const r = {
      rid: crypto.randomUUID().slice(0, 8), program, channel, title, ep, desc,
      start: Math.max(start, now), end, status: 'scheduled', parts: [], created: now,
    };
    this.items.push(r);
    this.save();
    this.tick();
    return { rid: r.rid };
  }

  // Stop now: a recording keeps what it has; a scheduled one is cancelled.
  stop(rid) {
    const r = this.get(rid);
    if (!r) return false;
    if (r.status === 'scheduled') { this.items.splice(this.items.indexOf(r), 1); this.save(); return true; }
    if (r.status === 'recording' || r.status === 'resume') {
      r.end = Date.now() - LATE;
      this.procs.get(rid)?.kill('SIGINT');
      if (!this.procs.has(rid)) this.finish(r);
      this.save();
    }
    return true;
  }

  // Delete: gone from the list and from the disk.
  remove(rid) {
    const r = this.get(rid);
    if (!r) return false;
    this.procs.get(rid)?.kill('SIGKILL');
    for (const f of r.parts) fs.rm(f, { force: true }, () => {});
    if (r.file) {
      const file = path.join(this.root, r.file);
      // and the channel's folder, once it's empty
      fs.rm(file, { force: true }, () => fs.rmdir(path.dirname(file), () => {}));
    }
    this.items.splice(this.items.indexOf(r), 1);
    this.save();
    return true;
  }

  tick() {
    if (!this.ready) return;
    if (!this.loaded) this.load();
    const now = Date.now();
    for (const r of this.items) {
      if ((r.status === 'scheduled' || r.status === 'resume') && now >= r.start - EARLY && !this.procs.has(r.rid) && !this.waiting.has(r.rid)) {
        if (now >= r.end + LATE) { this.finish(r); continue; }
        this.capture(r);
      }
    }
  }

  // One ffmpeg run for one part; if the stream drops before the show's over, the next
  // part picks up a few seconds later.
  async capture(r) {
    const secs = Math.ceil((r.end + LATE - Date.now()) / 1000);
    if (secs <= 5) return this.finish(r);
    const part = path.join(this.work, `${r.rid}-${r.parts.length + 1}.ts`);
    fs.mkdirSync(this.work, { recursive: true });
    let url;
    this.waiting.add(r.rid);
    try {
      url = await this.resolve(r.program);
    } catch (err) {
      console.error(`[dvr] ${r.title}: ${err.message}`);
      return setTimeout(() => { this.waiting.delete(r.rid); if (this.get(r.rid) === r) this.capture(r); }, RETRY_MS * 6);
    }
    this.waiting.delete(r.rid);
    if (this.get(r.rid) !== r) return;
    // stop on the clock: live streams' own timestamps jump at ad breaks, so ffmpeg's
    // duration limit is only a backstop
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...this.captureArgs(url, secs + 600, part)]);
    const timer = setTimeout(() => proc.kill('SIGINT'), r.end + LATE - Date.now());
    proc.on('close', () => clearTimeout(timer));
    this.procs.set(r.rid, proc);
    r.parts.push(part);
    r.status = 'recording';
    r.began = Date.now();
    this.save();
    let err = '';
    proc.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    proc.on('close', () => {
      this.procs.delete(r.rid);
      r.done = (r.done || 0) + Math.round((Date.now() - r.began) / 1000);
      if (this.get(r.rid) !== r) return; // deleted while recording
      if (Date.now() < r.end - 10e3 && r.status === 'recording') {
        if (err) console.error(`[dvr] ${r.title}: ${err.trim().split('\n').pop()}`);
        this.waiting.add(r.rid);
        setTimeout(() => { this.waiting.delete(r.rid); if (this.get(r.rid) === r) this.capture(r); }, RETRY_MS);
      } else {
        this.finish(r);
      }
    });
  }

  // Remux the parts into one MP4 in Recordings, then drop the parts.
  finish(r) {
    const parts = r.parts.filter((f) => fs.existsSync(f) && fs.statSync(f).size > 0);
    if (!parts.length) { r.status = 'failed'; this.save(); return; }
    if (!this.ready) { r.status = 'resume'; return; } // the share is away; try again on a later tick
    r.status = 'processing';
    this.save();
    const out = this.partPath(r);
    const abs = path.join(this.root, out);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let args;
    if (parts.length === 1) {
      args = ['-i', parts[0]];
    } else {
      const list = path.join(this.work, `${r.rid}.txt`);
      fs.writeFileSync(list, parts.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      args = ['-f', 'concat', '-safe', '0', '-i', list];
    }
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args, '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart', abs]);
    proc.on('close', (code) => {
      fs.rm(path.join(this.work, `${r.rid}.txt`), { force: true }, () => {});
      if (code !== 0 || !fs.existsSync(abs)) {
        console.error(`[dvr] ${r.title}: couldn't write ${out}; keeping the local copy`);
        r.status = 'failed';
        return this.save();
      }
      r.file = out;
      r.secs = probeSeconds(abs) ?? r.done;
      for (const f of parts) fs.rm(f, { force: true }, () => {});
      r.parts = [];
      r.status = 'done';
      this.save();
    });
  }

  // Recordings/<Channel>/<Title - Episode> (2026-10-13 1653).mp4
  partPath(r) {
    const clean = (s) => s.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
    const d = new Date(r.start);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    const name = clean(r.ep ? `${r.title} - ${r.ep}` : r.title) || 'Recording';
    return path.join('Recordings', clean(r.channel.name) || r.channel.num, `${name} (${stamp}).mp4`);
  }

  // What the player streams for a recording: the finished MP4 (f, under the media
  // root), or the local part being written (abs).
  playable(rid) {
    const r = this.get(rid);
    if (!r) return null;
    if (r.file) return { k: 'rec', f: r.file, d: (r.secs || 0) / 60, live: false };
    const part = r.parts[r.parts.length - 1];
    if (!part) return null;
    return { k: 'rec', abs: part, d: (Date.now() - (r.began || Date.now())) / 60e3, live: r.status === 'recording' };
  }
}

const pad = (n) => String(n).padStart(2, '0');

function probeSeconds(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout;
  const n = Math.round(parseFloat(out));
  return Number.isFinite(n) ? n : null;
}
