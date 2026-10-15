// Full-screen SD menus: TiVo Central, Now Playing List, program screens and the
// submenus. Each screen owns one Menu and answers remote actions.
import { h } from './dom.js';
import { Menu } from './menu.js';
import { badge, background, folder, dot, miniGuy, arrow, logoChip } from './art.js';
import { CHANNELS } from './data.js';
import { recordable, recordingFor, toggleRecording, seasonPass, deleteRecording, stopRecording } from './dvr.js';
import { clock, dayDate, day, mdate, range, duration } from './time.js';
import * as sfx from './sound.js';

export class MenuScreen {
  constructor(app, { title, theme = 'warm', items = [], leftArrow = true, menu = {} }) {
    this.app = app;
    this.el = h('div', { class: `screen theme-${theme}` });
    this.el.style.backgroundImage = `url(${background(theme)})`;
    this.titleEl = h('div', { class: 'screen-title' }, title);
    this.el.append(h('div', { class: 'badge', html: badge() }), this.titleEl, h('div', { class: 'panel' }));
    this.menu = new Menu({
      items, top: 124, leftArrow,
      onSelect: (item) => {
        if (!item.action) return sfx.play('bonk');
        sfx.play('select');
        item.action();
      },
      ...menu,
    });
    this.el.append(this.menu.el);
  }

  // shrink a long title until it fits, the way the SD menus did
  mounted() {
    const t = this.titleEl;
    let size = parseFloat(getComputedStyle(t).fontSize);
    while (t.scrollWidth > t.clientWidth && size > 24) t.style.fontSize = `${--size}px`;
  }

  onKey(action) {
    if (this.menu.onKey(action)) return true;
    if (action === 'left' || action === 'back') { this.app.back(); return true; }
    return false;
  }
}

// ── TiVo Central ──────────────────────────────────────────────────────────────
export class TiVoCentral extends MenuScreen {
  constructor(app) {
    super(app, {
      title: 'TiVo Central', theme: 'warm', leftArrow: false,
      items: [
        { label: 'Now Playing List', action: () => app.push(new NowPlaying(app)) },
        { label: 'Watch Live TV', action: () => app.goLive() },
        { label: 'Find Programs', action: () => app.push(findPrograms(app)) },
        { label: 'Music, Photos, & Showcases', action: () => app.push(showcases(app)) },
        { label: 'Messages & Settings', action: () => app.push(messages(app)) },
      ],
    });
  }

  onKey(action) {
    if (action === 'left') { sfx.play('bonk'); return true; } // nothing to the left of TiVo Central
    if (action === 'back') { sfx.play('back'); this.app.goLive(); return true; }
    return super.onKey(action);
  }
}

function findPrograms(app) {
  return new MenuScreen(app, {
    title: 'Find Programs', theme: 'violet',
    items: [
      { label: 'Search using Letters' },
      { label: 'Browse by Channel', action: () => app.openGuide() },
      { label: 'Browse by Category' },
      { label: 'Wish List® Searches' },
      { label: 'To Do List' },
    ],
  });
}

function showcases(app) {
  return new MenuScreen(app, {
    title: 'Music, Photos, & Showcases', theme: 'green',
    items: [{ label: 'Showcases' }, { label: 'Music' }, { label: 'Photos' }, { label: 'Videos on the Web' }],
  });
}

function messages(app) {
  return new MenuScreen(app, {
    title: 'Messages & Settings', theme: 'violet',
    items: [
      { label: 'Messages' },
      { label: 'Settings' },
      { label: 'Account & System Information', action: () => app.push(new SystemInfo(app)) },
      { label: 'Help' },
      { label: 'Restart or Reset System' },
    ],
  });
}

export class SystemInfo extends MenuScreen {
  constructor(app) {
    const line = (k, v) => ({ label: `${k}: ${v}` });
    super(app, {
      title: 'System Information', theme: 'violet',
      items: [
        line('Program source', 'Live streams and archive.org (built-in scheduler)'),
        line('Channels', CHANNELS.length),
        line('Video output', '480i composite, 4:3'),
        line('Remote', 'TiVo peanut (IR)'),
        line('Software version', '0.1 design'),
      ],
      menu: { fs: 19, rowH: 30 },
    });
    this.menu.onSelect = () => sfx.play('bonk');
  }
}

// ── Now Playing List ─────────────────────────────────────────────────────────
function statusIcon(item) {
  if (item.kind === 'folder') return item.suggestions ? miniGuy(19) : folder();
  switch (item.status) {
    case 'recording': return dot('red');
    case 'keep': return dot('green');
    case 'expiring': return dot('yellow');
    case 'today': return dot('yellow', 15, '!');
    case 'suggestion': return miniGuy(18);
    default: return '';
  }
}

export class NowPlaying extends MenuScreen {
  constructor(app, { title = 'Now Playing List', source = app.recordings, isFolder = false } = {}) {
    super(app, {
      title, theme: 'teal', leftArrow: true,
      items: [],
      menu: {
        className: 'np', top: 120, rowH: 36, visible: 8, fs: 21, textX: 96, barRight: 528, labelRight: 252,
        renderRow: (it) => [
          h('span', { class: 'icon', html: statusIcon(it) }),
          h('span', { class: 'label' }, it.kind === 'folder' ? `${it.title} (${it.count})`
            : (isFolder && it.epTitle) || it.show.title),
          h('span', { class: 'day' }, day(it.start)),
          h('span', { class: 'date' }, mdate(it.start)),
          it.call ? h('span', { class: 'net', html: netLabel(it.call) }) : null,
        ],
        onSelect: (it) => {
          sfx.play('select');
          if (it.kind === 'folder') app.push(new NowPlaying(app, { title: it.title, source: it.items, isFolder: true }));
          else app.push(new ProgramScreen(app, { recording: it, list: this }));
        },
        onFocus: () => this.updateChrome(),
      },
    });
    this.source = source;
    this.isFolder = isFolder;
    this.sortBy = 'date';
    this.hint = h('span');
    this.el.append(h('div', { class: 'footer-hint' }, this.hint), this.more = h('div', { class: 'more-down', html: arrow('d') }));
    this.resort();
  }

  resort(keepItem) {
    const pinned = this.source.filter((it) => it.suggestions);
    const rest = this.source.filter((it) => !it.suggestions);
    rest.sort(this.sortBy === 'date'
      ? (a, b) => b.start - a.start
      : (a, b) => (a.title || a.show.title).replace(/^The /, '').localeCompare((b.title || b.show.title).replace(/^The /, '')));
    const items = [...rest, ...pinned];
    this.menu.setItems(items, keepItem ? items.indexOf(keepItem) : this.menu.index);
    this.updateChrome();
  }

  remove(item) {
    const i = this.source.indexOf(item);
    if (i >= 0) this.source.splice(i, 1);
    this.resort();
  }

  updateChrome() {
    const what = this.isFolder ? 'Sorted' : 'Groups sorted';
    this.hint.textContent = `${what} by ${this.sortBy === 'date' ? 'date' : 'name'} (press ENTER to change)`;
    this.more.style.visibility = this.menu.hasMoreBelow ? 'visible' : 'hidden';
  }

  onKey(action) {
    if (action === 'enter') {
      sfx.play('select');
      this.sortBy = this.sortBy === 'date' ? 'name' : 'date';
      this.resort(this.menu.item);
      return true;
    }
    if (action === 'info') {
      const it = this.menu.item;
      if (it?.kind !== 'show') return false;
      sfx.play('select');
      this.app.push(new ProgramScreen(this.app, { recording: it, list: this }));
      return true;
    }
    if (action === 'play' && this.menu.item?.kind === 'show') {
      this.app.playRecording(this.menu.item);
      return true;
    }
    const handled = super.onKey(action);
    this.updateChrome();
    return handled;
  }
}

// ── program screen (from Now Playing or the guide) ────────────────────────────
const stars = (n) => (n ? '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '') : '');

// TiVo listing style: 'Comedy (1985) ★★★ Griffin Dunne, Rosanna Arquette. A word processor...'
export function describe(airing) {
  const s = airing.show;
  if (airing.filler || airing.live) return airing.desc;
  const head = s.movie
    ? [`${s.genre} (${s.year})`, stars(s.stars), s.cast ? `${s.cast}.` : ''].filter(Boolean).join(' ')
    : [airing.epTitle ? `"${airing.epTitle}"` : '', airing.season != null ? `(S${airing.season} E${airing.episode})` : ''].filter(Boolean).join(' ');
  return `${head} ${airing.desc || ''} (CC) (Stereo)`.trim();
}

export class ProgramScreen extends MenuScreen {
  constructor(app, { recording = null, airing = null, channel = null, list = null }) {
    const it = recording || airing;
    const now = Date.now();
    const airingNow = airing && airing.start <= now && now < airing.end;
    const back = () => app.back();
    let items;
    if (recording) {
      // a DVR recording deletes from the disk; a suggestion just leaves the list
      const drop = () => { if (recording.rid) deleteRecording(recording.rid); list?.remove(recording); back(); };
      items = [
        { label: 'Play', action: () => app.playRecording(recording) },
        recording.inProgress && { label: 'Stop recording', action: () => { stopRecording(recording.rid); back(); } },
        { label: recording.status === 'keep' ? 'Keep until space needed' : 'Keep until I delete',
          action: () => { recording.status = recording.status === 'keep' ? null : 'keep'; list?.resort(recording); back(); } },
        { label: 'Delete now', action: drop },
        { label: "Don't do anything", action: back },
      ].filter(Boolean);
    } else {
      // only live channels record; the library channels are always recorded already
      const live = recordable(channel) && airing.end > now;
      const existing = live && recordingFor(channel, airing);
      const record = () => { toggleRecording(channel, airing).then((r) => { if (r.error) sfx.play('bonk'); }); back(); };
      items = [
        airingNow && { label: 'Watch now', action: () => app.watchChannel(channel) },
        live && { label: existing ? (existing.status === 'scheduled' ? 'Cancel this recording' : 'Stop recording')
          : airing.show.movie ? 'Record this showing' : 'Record this episode', action: record },
        live && !existing && airing.epg && { label: 'Get a Season Pass®', action: () => { seasonPass(channel, airing); back(); } },
        { label: "Don't do anything", action: back },
      ].filter(Boolean);
    }
    super(app, {
      title: it.show.title, theme: recording ? 'teal' : 'violet',
      items, menu: { top: 266, rowH: 31, fs: 22, visible: 5 },
    });

    const s = it.show;
    const when = recording
      ? `Recorded: ${dayDate(it.start)} ${clock(it.start)}  ${channelFor(it.call)}`
      : `${dayDate(it.start)} ${range(it.start, it.end)}  ${channel.num} ${channel.call}`;
    const tags = [s.movie ? null : s.genre, s.rating, duration(it.dur)].filter(Boolean).join('\u2003');
    this.el.append(
      h('div', { class: 'prog-info' },
        h('div', { class: 'when' }, when),
        h('div', { class: 'desc' }, describe(it)),
        h('div', { class: 'tags' }, tags)),
      h('div', { class: 'prog-divider' }),
    );
  }
}

function channelFor(call) {
  const ch = CHANNELS.find((c) => c.call === call);
  return ch ? `${ch.num} ${ch.call}` : call;
}

// the network on a Now Playing row: its logo, or the call sign on a chip
function netLabel(call) {
  const ch = CHANNELS.find((c) => c.call === call);
  return ch?.logo ? logoChip(ch, 50, 18) : `<span class="netchip">${call}</span>`;
}
