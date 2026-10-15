// Boots the box: scales the 640x480 stage to the display, routes remote
// actions, and keeps the stack of menu screens that sits over live TV.
import { KEYMAP, HELP } from './keys.js';
import * as sfx from './sound.js';
import { CHANNELS, loadLineup, buildRecordings, refreshGuides } from './data.js';
import { DVR, refreshDVR, onDVRChange } from './dvr.js';
import { LiveTV } from './live.js';
import { TVSet } from './tvset.js';
import { TiVoCentral, NowPlaying, ProgramScreen } from './screens.js';
import { MIN } from './time.js';

const params = new URLSearchParams(location.search);
const demo = params.get('demo');
const viewport = document.getElementById('viewport');
const stage = document.getElementById('stage');
const screensEl = document.getElementById('screens');

// ── fit the stage: uniform 4:3 on a monitor, or stretch to fill (?fit=fill)
//    for the Pi's 720x480 composite framebuffer, which the CRT shows as 4:3
function fit() {
  let sx = innerWidth / 640, sy = innerHeight / 480;
  if (params.get('fit') !== 'fill') sx = sy = Math.min(sx, sy);
  stage.style.transform = `translate(${(innerWidth - 640 * sx) / 2}px, ${(innerHeight - 480 * sy) / 2}px) scale(${sx}, ${sy})`;
}
addEventListener('resize', fit);
fit();

if (params.has('kiosk')) document.body.classList.add('kiosk');
if (params.has('crt')) viewport.classList.add('crt');

const app = {
  video: document.getElementById('tv'),
  frozen: !!demo,
  // real programs from the box server; the design board and ?placeholder use test loops
  realVideo: !demo && !params.has('placeholder'),
  stack: [],
  recordings: [],

  get top() { return this.stack[this.stack.length - 1]; },

  push(screen) {
    this.stack.push(screen);
    screensEl.append(screen.el);
    screen.mounted?.();
  },

  pop() {
    const s = this.stack.pop();
    s?.el.remove();
  },

  back() {
    sfx.play('back');
    this.pop();
  },

  clearStack() { while (this.stack.length) this.pop(); },

  home() {
    this.clearStack();
    this.live.clearOverlays();
    this.live.closeGuide();
    this.push(new TiVoCentral(this));
  },

  goLive() {
    this.clearStack();
    this.live.closeGuide();
    if (this.live.rec) this.live.tune(this.live.chIndex);
    else this.live.showBanner('mini');
  },

  openGuide() {
    this.clearStack();
    if (this.live.rec) this.live.tune(this.live.chIndex, { banner: false });
    this.live.openGuide();
  },

  watchChannel(ch) {
    this.clearStack();
    this.live.closeGuide();
    this.live.tune(CHANNELS.indexOf(ch));
  },

  playRecording(rec) {
    this.clearStack();
    this.live.closeGuide();
    this.live.playRecording(rec);
  },

  showProgram(channel, airing) {
    this.push(new ProgramScreen(this, { airing, channel }));
  },

  showNowPlaying() {
    this.home();
    this.push(new NowPlaying(this));
  },
};

function dispatch(action) {
  const tv = app.tv;
  // the TV buttons; with the set off, any button turns it back on
  if (tv.standby) { tv.power(); return; }
  switch (action) {
    case 'power': tv.power(); return;
    case 'input': tv.toggleInput(); return;
    case 'mute': tv.mute(); return;
    case 'volup': case 'voldown': tv.volume(action === 'volup' ? 1 : -1); return;
    case 'window': tv.window(); return;
  }
  tv.backToBox();
  switch (action) {
    case 'tivo':
      // pressing TiVo while already in TiVo Central jumps to Now Playing
      sfx.play('select');
      if (app.top instanceof TiVoCentral) app.push(new NowPlaying(app));
      else app.home();
      return;
    case 'livetv':
      app.goLive();
      return;
    case 'guide':
      if (!app.top && app.live.guide.on) app.live.closeGuide();
      else app.openGuide();
      return;
  }
  const handled = app.top ? app.top.onKey(action) : app.live.onKey(action);
  if (!handled) sfx.play('bonk');
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '?') { toggleHelp(); return; }
  if (e.key === 'c') { viewport.classList.toggle('crt'); return; }
  const action = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  // like the real box, a held button only repeats for moving around
  if (e.repeat && !REPEATS.has(action)) return;
  sfx.unlock();
  app.video.muted = false;
  dispatch(action);
});

const REPEATS = new Set(['up', 'down', 'left', 'right', 'chup', 'chdown', 'volup', 'voldown']);

const help = document.getElementById('dev-help');
help.textContent = HELP;
function toggleHelp() { help.hidden = !help.hidden; }

// ── boot ──────────────────────────────────────────────────────────────────────
await loadLineup();
window.tivo = app; // handy from the dev console
app.video.loop = !app.realVideo; // a real stream that ends hands off to what's next instead of starting over
await refreshDVR();
app.recordings = buildRecordings(DVR.items);
// the DVR's list and the live listings keep themselves current
onDVRChange(() => {
  app.recordings.splice(0, Infinity, ...buildRecordings(DVR.items));
  if (app.top instanceof NowPlaying && !app.top.isFolder) app.top.resort();
});
setInterval(refreshDVR, 20e3);
refreshGuides();
setInterval(refreshGuides, 20 * 60e3);
app.live = new LiveTV(app);
app.tv = new TVSet(app, document.getElementById('stage'));
app.video.muted = !params.has('kiosk'); // browsers need a keypress before sound; the Pi kiosk is launched to allow it
sfx.setMuted(!!demo || params.has('mute'));
if (!demo) sfx.load(); // design-board frames stay silent

// Power-on lands on live TV like the real box, on the last channel watched.
// ?screen=central starts in the menus.
let lastChannel = '296';
try { lastChannel = localStorage.getItem('tivo.channel') || lastChannel; } catch { /* private mode */ }
const byNum = (n) => CHANNELS.findIndex((c) => c.num === n);
// channels get renumbered now and then; an old favorite that's gone lands on Cartoon Network
app.live.tune(Math.max(0, byNum(lastChannel) >= 0 ? byNum(lastChannel) : byNum('296')), { banner: !demo });
if (params.get('screen') === 'central') app.home();
if (demo) runDemo(demo);

// Fixed states for the design board (design.html). Timers are frozen.
function runDemo(name) {
  const live = app.live;
  const pick = (n) => CHANNELS.findIndex((c) => c.num === n);
  const shows = () => app.recordings.flatMap((r) => r.items || [r]).filter((r) => r.kind === 'show');
  const firstMovie = () => shows().find((r) => r.show.movie) || shows()[0];
  switch (name) {
    case 'central':
      app.home();
      break;
    case 'central-bottom':
      app.home();
      app.top.menu.select(4);
      break;
    case 'nowplaying':
      app.home();
      app.push(new NowPlaying(app));
      app.top.menu.select(4);
      app.top.updateChrome();
      break;
    case 'program': {
      app.home();
      const np = new NowPlaying(app);
      app.push(np);
      app.push(new ProgramScreen(app, { recording: firstMovie(), list: np }));
      break;
    }
    case 'banner':
      live.tune(pick('296'));
      break;
    case 'info':
      live.tune(pick('354'), { banner: false });
      live.showBanner('full');
      break;
    case 'pause':
      live.tune(pick('299'), { banner: false });
      live.tl.pos -= 6 * MIN;
      live.setState('pause');
      break;
    case 'ff':
      live.tune(pick('9'), { banner: false });
      live.tl.pos = live.tl.start + (live.tl.end - live.tl.start) * 0.4;
      live.setState('ff2');
      break;
    case 'playback': {
      live.playRecording(firstMovie());
      live.banner.hide();
      live.showBanner('full');
      live.tl.pos = live.tl.end * 0.62;
      live.setState('pause');
      break;
    }
    case 'digits':
      live.tune(pick('362'), { banner: false });
      live.digit('6');
      live.digit('6');
      break;
    case 'guide':
      live.tune(pick('354'), { banner: false });
      app.openGuide();
      live.guide.onKey('down');
      break;
    case 'upnext': {
      // first channel currently between a film and the next half hour, if any
      const i = CHANNELS.findIndex((c) => { const a = c.airings.find((x) => x.start <= Date.now() && Date.now() < x.end); return a && (a.filler || Date.now() >= a.mediaEnd); });
      live.tune(i >= 0 ? i : 0, { banner: false });
      if (i < 0) live.tl.pos = live.airing.mediaEnd + MIN;
      break;
    }
  }
  // let the overlays draw once with frozen timers
  if (live.trick.on) live.drawTrick();
  live.updateUpNext();
}
