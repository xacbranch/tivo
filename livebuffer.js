// Live TV's buffer, the way a TiVo always recorded the channel you were on. When a
// live channel is tuned, the server records it from that moment into the media folder (the
// same 480p the DVR records, in Recordings/.inprogress), and the box watches from the
// recording, so pause, rewind and replay reach back to when you tuned in. One buffer
// at a time: changing channels, standby, or ten minutes with nobody watching clears it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const IDLE_MS = 10 * 60e3;
const FIRST_BYTES = 188 * 800; // ~150 KB of MPEG-TS, a second or so: enough to start playing

export class LiveBuffer {
  constructor({ work, captureArgs, resolve, watching, ready }) {
    this.work = work;
    this.captureArgs = captureArgs;
    this.resolve = resolve;
    this.watching = watching; // (bufferId) => true while a player is reading it
    this.ready = ready;       // () => true while the media folder is there
    this.cur = null;
    setInterval(() => {
      if (this.cur && !this.watching(this.cur.id) && Date.now() - this.cur.touched > IDLE_MS) this.stop();
    }, 60e3).unref();
  }

  // Start buffering a live program (or keep the one already going), and wait for the
  // first moments to land. Resolves to { buf, start } (start: wall time of the buffer's
  // first second).
  async start(program) {
    const cur = this.cur;
    if (cur && cur.program === program && !cur.dead) {
      cur.touched = Date.now();
      await cur.ready;
      return { buf: cur.id, start: cur.start };
    }
    this.stop();
    // only ever in the media folder: without it, live TV just plays without a buffer
    if (!this.ready()) throw new Error('the media folder is not available');
    fs.mkdirSync(this.work, { recursive: true });
    for (const f of fs.readdirSync(this.work)) if (f.startsWith('live-')) fs.rm(path.join(this.work, f), { force: true }, () => {});
    const id = crypto.randomUUID().slice(0, 8);
    const file = path.join(this.work, `live-${id}.ts`);
    const b = { id, program, file, start: Date.now(), touched: Date.now(), dead: false, proc: null };
    this.cur = b;
    b.ready = (async () => {
      const url = await this.resolve(program);
      if (this.cur !== b) throw new Error('changed channel');
      b.proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...this.captureArgs(url, 24 * 3600, file)]);
      b.proc.on('close', () => { b.dead = true; });
      b.start = Date.now();
      for (let i = 0; i < 100 && !b.dead; i++) {
        if ((fs.statSync(file, { throwIfNoEntry: false })?.size || 0) >= FIRST_BYTES) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (b.dead) throw new Error('stream ended');
    })().catch((err) => { b.dead = true; throw err; });
    await b.ready;
    return { buf: id, start: b.start };
  }

  stop() {
    const b = this.cur;
    if (!b) return;
    this.cur = null;
    b.dead = true;
    b.proc?.kill('SIGKILL');
    setTimeout(() => fs.rm(b.file, { force: true }, () => {}), 2000);
  }

  // what the player streams for a buffer: the growing file, followed
  playable(id) {
    const b = this.cur;
    if (!b || b.id !== id) return null;
    b.touched = Date.now();
    return { k: 'rec', abs: b.file, d: (Date.now() - b.start) / 60e3, live: !b.dead, buf: id };
  }
}
