#!/usr/bin/env python3
"""Build the channel lineup from tools/channels.py.

Looks up every archive.org series, tape and video the channels use (their files and
runtimes, cached in tools/.archive.json so a rebuild only asks about new ones), the golf
courses for the golf weather (tools/golf_data.py), and any folders of your own videos, then
writes:

  ui/data/lineup.json   channels + program metadata for the box's scheduler
  LINEUP.md             the human-readable channel guide

Re-run it whenever you change channels.py:
  python3 tools/build_lineup.py
  python3 tools/build_lineup.py --check-iptv     probe the live streams and exit
"""
import argparse
import datetime
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from channels import CHANNELS, GOLF_WEATHER, IPTV, RADIO, TAPES, WEATHER  # noqa: E402
from golf_data import courses as golf_courses  # noqa: E402

MEDIA_ROOT = os.environ.get('MEDIA_ROOT') or os.path.join(ROOT, 'media')
ARCHIVE_CACHE = os.path.join(HERE, '.archive.json')  # archive.org items: files, runtimes, descriptions
FOLDER_CACHE = os.path.join(HERE, '.folders.json')   # runtimes of your own videos
LOGOS = os.path.join(ROOT, 'ui', 'assets', 'logos')
VIDEO_EXT = ('.mp4', '.m4v', '.mkv', '.mpg', '.mpeg', '.vob', '.wmv', '.avi', '.mov', '.ts', '.webm', '.flv')
CHUNK = 30  # tapes are listed in half-hour parts


def natural(s):
    return [int(x) if x.isdigit() else x.casefold() for x in re.split(r'(\d+)', s)]


def probe_seconds(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, timeout=60).stdout.strip()
    try:
        return round(float(out), 2)
    except ValueError:
        return 0


# ── archive.org ───────────────────────────────────────────────────────────────

class Archive:
    """Videos streamed from archive.org. Each item's files, runtimes and description come from
    archive.org's metadata, cached by identifier, so a rebuild only asks about new items.
    Nothing is downloaded: the box server streams the files as they play."""
    SKIP = ('Metadata', 'Archive BitTorrent', 'JPEG Thumb', 'Thumbnail', 'Animated GIF', 'Ogg Video')
    TAGS = r'(?i)\b(hdtv|pdtv|dsr|dvdrip|webrip|web-?dl|ws|fs|sd|xvid|divx|x264|h264|aac|ac3|480p|720p|1080p|proper|repack|internal)\b'

    def __init__(self):
        self.cache = json.load(open(ARCHIVE_CACHE)) if os.path.exists(ARCHIVE_CACHE) else {}

    def save(self):
        json.dump(self.cache, open(ARCHIVE_CACHE, 'w'), indent=0)

    @staticmethod
    def _get(url):
        req = urllib.request.Request(url, headers={'User-Agent': 'tivo-cable-box lineup builder'})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)

    @staticmethod
    def _secs(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            parts = [float(x) for x in str(v or '').split(':') if x.replace('.', '', 1).isdigit()]
            return sum(x * 60 ** i for i, x in enumerate(reversed(parts))) if parts else 0

    def _item(self, ident):
        d = self._get(f'https://archive.org/metadata/{urllib.parse.quote(ident)}')
        # archive.org answers {} for an item it can't serve right now (its storage server is
        # down, or it was taken down): ask again next build rather than remember it as empty
        if not d.get('files'):
            raise RuntimeError('unavailable right now')
        files = [f for f in d['files'] if f.get('format') not in self.SKIP and f['name'].lower().endswith(VIDEO_EXT)]
        if not files:
            return None  # no video in it
        # every original recording, in name order, each by its most playable copy: archive.org's
        # own H.264 version when it made one, otherwise the original
        parts = []
        for orig in sorted((f for f in files if f.get('source') == 'original'), key=lambda f: natural(f['name'])):
            copies = [f for f in files if f.get('original') == orig['name'] and f['name'].lower().endswith(('.mp4', '.m4v'))]
            pick = copies[0] if copies else orig
            secs = self._secs(pick.get('length')) or self._secs(orig.get('length'))
            if secs >= 60:
                parts.append(dict(file=pick['name'], secs=round(secs, 2)))
        if not parts:
            return None
        m = d.get('metadata', {})
        desc = m.get('description') or ''
        desc = desc if isinstance(desc, str) else ' '.join(desc)
        desc = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', desc))).strip()
        main = max(parts, key=lambda p: p['secs'])
        return dict(file=main['file'], secs=main['secs'], parts=parts, title=m.get('title') or ident,
                    date=str(m.get('date') or '')[:10], desc=desc)

    def _fetch(self, idents):
        new = [i for i in idents if i not in self.cache]

        def fetch(ident):
            try:
                return self._item(ident)
            except Exception as err:  # archive.org hiccup: skip it this time, ask again next build
                print(f'  archive.org {ident}: {err}', file=sys.stderr)
                return 'retry'
        with ThreadPoolExecutor(6) as pool:
            for ident, item in zip(new, pool.map(fetch, new)):
                if item != 'retry':
                    self.cache[ident] = item
        if new:
            self.save()

    def items(self, idents):
        """{identifier: dict(file, secs, parts, title, date, desc) or None if it's gone}"""
        self._fetch(idents)
        return {i: self.cache.get(i) for i in idents}

    def episodes(self, collection):
        """A collection's episodes, oldest first: dicts with id, ia (identifier/file), secs, date, name, desc."""
        q = urllib.parse.urlencode({'q': f'collection:{collection}', 'fl[]': 'identifier', 'rows': 5000, 'output': 'json'})
        idents = [x['identifier'] for x in self._get(f'https://archive.org/advancedsearch.php?{q}')['response']['docs']]
        self._fetch(idents)
        out = []
        for ident in idents:
            e = self.cache.get(ident)
            if e and e['secs'] >= 600:
                out.append(dict(id=f'ia_{ident}', ia=f"{ident}/{e['file']}", name=self.episode_name(e, ident), aired=self.aired(e), **e))
        return sorted(out, key=lambda e: (e['date'], e['id']))

    @classmethod
    def episode_name(cls, e, ident):
        """A special's own title ("Best of 2011 Awards"), if it has one."""
        def leftover(s):
            s = re.sub(r'\.(mp4|m4v|avi|mkv)$', '', s, flags=re.I).replace('.', ' ').replace('_', ' ')
            tag = re.search(cls.TAGS, s)  # a rip's name: the title, then source, codec and group
            s = s[:tag.start()] if tag else s
            s = re.sub(r'\b\d{2,4}[- ]\d{2}[- ]\d{2,4}\b', ' ', s)  # 2008 08 11, 01-06-10, 10 01 04
            s = re.sub(r'(?i)\b(attack of the show|x-play|aots|g4)\b!?', ' ', s)
            s = re.sub(r'\s+', ' ', s).strip(' -')
            s = s.title() if s == s.lower() else s
            return 'Final Episode' if s.lower() == 'final' else s
        # archive.org's title first (someone typed it), then the item's name, then the file's
        return next((n for n in (leftover(e['title']), leftover(ident), leftover(e['file'])) if n), '')

    @staticmethod
    def aired(e):
        try:
            d = datetime.date.fromisoformat(e['date'])
            return f'{d:%B} {d.day}, {d.year}'
        except ValueError:
            return ''


# ── your own videos ───────────────────────────────────────────────────────────

def folder_videos(rel):
    """Every video under MEDIA_ROOT/rel, in name order, with its runtime (cached by size)."""
    base = os.path.join(MEDIA_ROOT, rel)
    if not os.path.isdir(base):
        return []
    cache = json.load(open(FOLDER_CACHE)) if os.path.exists(FOLDER_CACHE) else {}
    found = []
    for dirpath, _, names in os.walk(base):
        for n in names:
            if n.lower().endswith(VIDEO_EXT) and not n.startswith('._'):
                found.append(os.path.relpath(os.path.join(dirpath, n), MEDIA_ROOT))
    found.sort(key=natural)
    out = []
    for f in found:
        size = os.path.getsize(os.path.join(MEDIA_ROOT, f))
        hit = cache.get(f)
        if not hit or hit['size'] != size:
            hit = cache[f] = dict(size=size, secs=probe_seconds(os.path.join(MEDIA_ROOT, f)))
        if hit['secs'] > 30:
            out.append((f, hit['secs']))
    json.dump(cache, open(FOLDER_CACHE, 'w'), indent=0)
    return out


# ── the lineup ────────────────────────────────────────────────────────────────

def resolve(channels, archive):
    errors, programs = [], {}
    listed = {}

    def archive_eps(collection):
        if collection not in listed:
            listed[collection] = archive.episodes(collection)
        return listed[collection]

    def tape_programs(key, ident, title, desc, only=None):
        """an archive.org recording as programs: one per file, each in half-hour guide parts"""
        e = archive.items([ident]).get(ident)
        if not e:
            print(f'  {key}: archive.org/details/{ident} is unavailable right now or has no video; skipping', file=sys.stderr)
            return []
        items = []
        for i, part in enumerate(p for p in e['parts'] if not only or only in p['file']):
            src, mins = f't_{key}_{i}', part['secs'] / 60
            programs[src] = dict(k='tape', t=title, d=round(mins, 2), ia=f"{ident}/{part['file']}")
            n = int(mins // CHUNK) + (1 if mins % CHUNK >= 2 else 0)
            for j in range(n):
                pid = f'{src}_{j}'
                programs[pid] = dict(k='tc', t=title, s=desc, src=src, o=j * CHUNK,
                                     d=round(min(CHUNK, mins - j * CHUNK), 2), part=j + 1, parts=n)
                items.append(pid)
        return items

    out_channels = []
    for ch in channels:
        pools = {}
        for key, pool in ch['pools'].items():
            kind = pool['kind']
            if kind == 'rotate':
                pools[key] = dict(rotate=pool['pools'])
            elif kind == 'daily':
                pools[key] = dict(daily=pool['pools'])
            elif kind == 'again':
                pools[key] = dict(again=pool['pool'])
            elif kind == 'tapes':
                items = [pid for t in pool['tapes'] for pid in tape_programs(t, *TAPES[t])]
                if items:
                    pools[key] = dict(order='sequential', items=items)
            elif kind == 'archive_tapes':
                items = [pid for it in pool['items'] for pid in tape_programs(f"ia_{it['id']}", it['id'], it['t'], it['s'])]
                if items:
                    pools[key] = dict(order='sequential', items=items)
            elif kind == 'archive':
                eps = [e for e in archive_eps(pool['collection']) if not pool['longest'] or e['secs'] <= pool['longest'] * 60]
                if not eps:
                    errors.append(f"{ch['call']}/{key}: nothing playable in archive.org/details/{pool['collection']}")
                    continue
                for e in eps:
                    # a daily show's episode goes by its air date; a special by its name
                    desc = e['desc'] or pool['blurb']
                    if e['name'] and e['aired']:
                        desc = f"{desc} Originally aired {e['aired']}."
                    programs[e['id']] = dict(k='e', sh=pool['show'], shy=pool['year'], t=e['name'] or e['aired'], g=pool['genres'],
                                             r='', d=round(e['secs'] / 60, 1), s=desc[:420], ia=e['ia'])
                pools[key] = dict(order=pool['order'], items=[e['id'] for e in eps])
            elif kind == 'archive_list':
                found = archive.items([it['id'] for it in pool['items']])
                items = []
                for it in pool['items']:
                    e = found.get(it['id'])
                    if not e:
                        print(f"  {ch['call']}/{key}: archive.org/details/{it['id']} is unavailable right now or has no video; skipping", file=sys.stderr)
                        continue
                    pid = f"ia_{it['id']}"
                    programs[pid] = dict(k='e', sh=it['t'], shy=it['y'], t='', g=pool['genres'], r='',
                                         d=round(e['secs'] / 60, 1), s=(it['s'] or e['desc'])[:420], ia=f"{it['id']}/{e['file']}")
                    items.append(pid)
                if items:
                    pools[key] = dict(order=pool['order'], items=items)
            elif kind == 'folder':
                vids = folder_videos(pool['path'])
                if not vids:
                    print(f"  {ch['call']}/{key}: no videos in {os.path.join(MEDIA_ROOT, pool['path'])}", file=sys.stderr)
                    continue
                show = pool['show'] or os.path.basename(pool['path'].rstrip('/'))
                items = []
                for i, (f, secs) in enumerate(vids):
                    pid = f"f_{ch['call']}_{key}_{i}"
                    title = re.sub(r'[._]+', ' ', os.path.splitext(os.path.basename(f))[0]).strip()
                    programs[pid] = dict(k='e', sh=show, shy=None, t=title, g=pool['genres'], r='', d=round(secs / 60, 1), s='', f=f)
                    items.append(pid)
                pools[key] = dict(order=pool['order'], items=items)
            if pool.get('ads') and key in pools:
                pools[key]['ads'] = pool['ads']
        # a pool with nothing to air (its recordings all gone): its fallback stands in
        for key, pool in ch['pools'].items():
            fb, seen = pool.get('fallback'), {key}
            while key not in pools and fb and fb not in seen:
                if fb in pools:
                    pools[key] = dict(rotate=[fb])
                seen.add(fb)
                fb = ch['pools'][fb].get('fallback')
        for p in pools.values():
            for k in ('rotate', 'daily'):
                if k in p:
                    p[k] = [x for x in p[k] if x in pools]
        missing = sorted({d['pool'] for d in ch['dayparts']} - set(pools))
        if missing:
            errors.append(f"{ch['num']} {ch['name']}: nothing to air for {', '.join(missing)}")
            continue
        logo = ch.get('logo') or (f"{ch['call']}.png" if os.path.exists(os.path.join(LOGOS, f"{ch['call']}.png")) else None)
        out_channels.append(dict(num=ch['num'], call=ch['call'], name=ch['name'], tagline=ch['tagline'],
                                 logo=logo, ads=ch.get('ads'),
                                 pools=pools, dayparts=ch['dayparts'], seasons=ch.get('seasons', [])))
    # live channels: one hour-long block that repeats, so the guide shows the hours
    for ch in IPTV:
        pid = f"l{ch['num']}"
        programs[pid] = dict(k='live', t=ch['name'], d=60, s=ch['tagline'], u=ch['url'],
                             **({'guide': ch['guide']} if ch.get('guide') else {}))
        logo = ch.get('logo') or (f"{ch['call']}.png" if os.path.exists(os.path.join(LOGOS, f"{ch['call']}.png")) else None)
        out_channels.append(dict(num=ch['num'], call=ch['call'], name=ch['name'], tagline=ch['tagline'], live=True, logo=logo,
                                 pools={'live': dict(order='sequential', items=[pid])},
                                 dayparts=[dict(at='06:00', pool='live')], seasons=[]))
    # radio: audio streams with a station card
    for ch in RADIO:
        pid = f"r{ch['num']}"
        programs[pid] = dict(k='radio', t=ch['name'], d=60, s=ch['tagline'], u=ch['url'], city=ch['city'], call=ch['call'])
        out_channels.append(dict(num=ch['num'], call=ch['call'], name=ch['name'], tagline=ch['tagline'], live=True, radio=True,
                                 pools={'live': dict(order='sequential', items=[pid])},
                                 dayparts=[dict(at='06:00', pool='live')], seasons=[]))
    # the weather channel: live NWS data on screen, music underneath
    w = WEATHER
    folder = os.path.join(ROOT, w['music'])
    tracks = sorted(f for f in os.listdir(folder) if f.lower().endswith('.mp3') and not f.startswith('._')) if os.path.isdir(folder) else []
    music = [dict(f=f"{w['music']}/{t}", secs=probe_seconds(os.path.join(folder, t))) for t in tracks]
    music = [m for m in music if m['secs']]
    pid = f"w{w['num']}"
    programs[pid] = dict(k='weather', t='Local Forecast', d=60, s=w['desc'], home=w['home'], tz=w['tz'], cities=w['cities'],
                         maps=w['maps'], radar=dict(bbox=w['maps']['radar'], w=160, h=80), horoscopes=w['horoscopes'], music=music)
    out_channels.append(dict(num=w['num'], call=w['call'], name=w['name'], tagline=w['tagline'], live=True, weather=True,
                             logo=w['logo'], pools={'live': dict(order='sequential', items=[pid])},
                             dayparts=[dict(at='06:00', pool='live')], seasons=[]))
    # the golf weather: the same music under a golf-weather loop for a city's courses
    g = GOLF_WEATHER
    pid = f"w{g['num']}"
    programs[pid] = dict(k='weather', style='golf', t='Golf Weather', d=60, s=g['desc'], tz=g['tz'], home=g['home'],
                         name=g['name'], logo=g['logo'], area=g.get('area', ''),
                         courses=golf_courses(g['courses']), music=music)
    out_channels.append(dict(num=g['num'], call=g['call'], name=g['name'], tagline=g['tagline'], live=True, weather=True,
                             logo=g['logo'], pools={'live': dict(order='sequential', items=[pid])},
                             dayparts=[dict(at='06:00', pool='live')], seasons=[]))
    out_channels.sort(key=lambda c: float(c['num']))
    return out_channels, programs, errors


def check_iptv():
    for ch in IPTV + RADIO:
        if ch['url'].startswith('pluto:'):
            print(f"{ch['num']} {ch['call']:8} Pluto (needs a session; check it on the box)")
            continue
        try:
            out = subprocess.run(['ffprobe', '-v', 'error', '-rw_timeout', '10000000', '-select_streams', 'v:0',
                                  '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ch['url']],
                                 capture_output=True, text=True, timeout=25).stdout.strip().splitlines()
            if not out and ch in RADIO:
                out = subprocess.run(['ffprobe', '-v', 'error', '-rw_timeout', '10000000', '-select_streams', 'a:0',
                                      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', ch['url']],
                                     capture_output=True, text=True, timeout=25).stdout.strip().splitlines()
                status = 'OK audio' if out else 'DEAD'
            else:
                status = f'OK {out[0]}' if out else 'DEAD'
        except subprocess.TimeoutExpired:
            status = 'TIMEOUT'
        print(f"{ch['num']} {ch['call']:8} {status}")


# ── LINEUP.md ─────────────────────────────────────────────────────────────────

def pool_items(ch, key, seen=None):
    seen = seen or set()
    if key in seen:
        return []
    seen.add(key)
    p = ch['pools'][key]
    if 'items' in p:
        return p['items']
    return [i for k in p.get('rotate', p.get('daily', [])) for i in pool_items(ch, k, seen)]


def clock(hhmm):
    h, m = map(int, hhmm.split(':'))
    return f"{h % 12 or 12}:{m:02d} {'am' if h < 12 else 'pm'}"


DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']


def describe_pool(ch, key, programs):
    p = ch['pools'][key]
    if 'rotate' in p:
        return ' / '.join(describe_pool(ch, k, programs) for k in p['rotate']) + (' (alternating)' if len(p['rotate']) > 1 else '')
    if 'daily' in p:
        return f"a different pool every day ({len(p['daily'])}-day cycle)"
    if 'again' in p:
        src = ch['pools'][p['again']]
        return f"{programs[src['items'][0]]['sh']}: the latest episode again"
    first = programs[p['items'][0]]
    if first['k'] == 'tc':
        tapes = list(dict.fromkeys(programs[i]['src'] for i in p['items']))
        hours = sum(programs[i]['d'] for i in p['items']) / 60
        return f"off-air recordings: {', '.join(dict.fromkeys(programs[t]['t'] for t in tapes))} ({len(tapes)} files, {hours:.0f} h)"
    shows = list(dict.fromkeys(programs[i]['sh'] for i in p['items']))
    if len(shows) > 1:
        return f"{len(p['items'])} videos ({p['order']})"
    return f"{shows[0]} ({'in order' if p['order'] == 'sequential' else 'repeats, shuffled'})"


def write_markdown(channels, programs, path):
    now = datetime.datetime.now().strftime('%B %-d, %Y')
    out = ['# Channel Lineup', '', f'{len(channels)} channels. Generated {now} by `tools/build_lineup.py` from `tools/channels.py`.', '',
           '| Ch | Call | Channel | Description |', '|---|---|---|---|']
    out += [f"| {c['num']} | {c['call']} | **{c['name']}** | {c['tagline']} |" for c in channels]
    for ch in channels:
        if ch.get('live'):
            continue
        out += ['', f"## {ch['num']} {ch['call']}: {ch['name']}", '', f"*{ch['tagline']}*", '', '| Starts | Programming |', '|---|---|']
        for d in ch['dayparts']:
            days = f" ({', '.join(DAYS[i] for i in d['days'])} only)" if d.get('days') is not None else ''
            out.append(f"| {clock(d['at'])}{days} | {describe_pool(ch, d['pool'], programs)} |")
    open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check-iptv', action='store_true', help='probe the live streams and exit')
    args = ap.parse_args()
    if args.check_iptv:
        return check_iptv()
    channels, programs, errors = resolve(CHANNELS, Archive())
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.join(ROOT, 'ui', 'data'), exist_ok=True)
    lineup = dict(generated=datetime.datetime.now().isoformat(timespec='seconds'), channels=channels, programs=programs, ads={})
    with open(os.path.join(ROOT, 'ui', 'data', 'lineup.json'), 'w', encoding='utf-8') as f:
        json.dump(lineup, f, ensure_ascii=False, separators=(',', ':'))
    write_markdown(channels, programs, os.path.join(ROOT, 'LINEUP.md'))
    print(f"{len(channels)} channels, {len(programs)} programs.")


if __name__ == '__main__':
    main()
