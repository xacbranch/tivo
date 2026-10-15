"""The golf weather channel's courses: Albuquerque's municipal golf courses, put together
from free, keyless sources and cached in tools/.golf.json so a rebuild doesn't ask again.

  OpenGolfAPI (api.opengolfapi.org, ODbL)   scorecards: par, handicap and yardage per hole and
                                            tee, course rating and slope, architect, year built
  OpenStreetMap (Overpass, ODbL)            each hole's line from tee to green, and the course outline
  USGS elevation point query (epqs)         tee and green elevations, for uphill and downhill

The flyovers are drawn, not photographed: every mapped fairway, green, tee, bunker, pond,
tree and cart path on the course (OpenStreetMap), in local meters from the course's middle
(x east, y north), simplified to about a meter. Each hole has its line in the same meters.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.golf.json')
UA = {'User-Agent': 'TvChannel golf weather (personal project)'}
OPENGOLF = 'https://api.opengolfapi.org/api/v1/courses/'
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
EPQS = 'https://epqs.nationalmap.gov/v1/json'


def _get(url, data=None, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
            if body[:1] in (b'{', b'['):
                return json.loads(body)
        except Exception as err:  # busy servers: back off and try again
            print(f'  golf data: {url[:60]}… {err}', file=sys.stderr)
        time.sleep(4 * (i + 1))
    raise RuntimeError(f'no answer from {url[:60]}')


def bearing(a, b):
    """compass bearing (0 = north, clockwise) from a to b, both (lon, lat)"""
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def yards(pts):
    t = 0.0
    for a, b in zip(pts, pts[1:]):
        dy = (b[1] - a[1]) * 111320
        dx = (b[0] - a[0]) * 111320 * math.cos(math.radians(a[1]))
        t += math.hypot(dx, dy)
    return t * 1.09361


class Local:
    """lon/lat to meters from an origin: x east, y north (flat over a golf course)"""

    def __init__(self, lon0, lat0):
        self.lon0, self.lat0 = lon0, lat0
        self.kx = 111320 * math.cos(math.radians(lat0))

    def __call__(self, lon, lat):
        return [round((lon - self.lon0) * self.kx, 1), round((lat - self.lat0) * 110540, 1)]


def simplify(pts, tol=0.8):
    """Douglas-Peucker, in meters"""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    far, idx = 0.0, 0
    for i, (x, y) in enumerate(pts[1:-1], 1):
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm if (dx or dy) else math.hypot(x - x1, y - y1)
        if d > far:
            far, idx = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


# OpenStreetMap features, by the layer they're drawn in
POLY = {'fairway': 'fairway', 'green': 'green', 'tee': 'tee', 'bunker': 'bunker', 'water_hazard': 'water',
        'lateral_water_hazard': 'water', 'rough': 'rough', 'driving_range': 'range', 'clubhouse': 'clubhouse'}
LINE = {'cartpath': 'path', 'path': 'path'}


class GolfData:
    def __init__(self):
        self.cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

    def save(self):
        json.dump(self.cache, open(CACHE, 'w'), indent=0)

    def opengolf(self, cid):
        key = f'og:{cid}'
        if key not in self.cache:
            self.cache[key] = _get(OPENGOLF + cid)
            self.save()
        return self.cache[key]

    def osm(self, way_id):
        """the course outline and every golf=hole line inside it"""
        key = f'osm:{way_id}'
        if key not in self.cache:
            q = f'[out:json][timeout:90];way({way_id})->.c;.c out geom;.c map_to_area->.a;way["golf"="hole"](area.a);out tags geom;'
            data = None
            for ep in OVERPASS:
                try:
                    data = _get(ep, urllib.parse.urlencode({'data': q}).encode(), tries=4)
                    break
                except RuntimeError:
                    continue
            if data is None:
                raise RuntimeError('OpenStreetMap (Overpass) is busy; run the build again in a few minutes')
            self.cache[key] = data
            self.save()
        return self.cache[key]

    def features(self, way_id):
        """everything mapped on the course: golf areas, water, woods, trees and paths"""
        key = f'feat:{way_id}'
        if key not in self.cache:
            q = (f'[out:json][timeout:120];way({way_id})->.c;.c map_to_area->.a;('
                 'way["golf"](area.a);relation["golf"](area.a);'
                 'way["natural"~"^(water|wood|scrub|tree_row)$"](area.a);relation["natural"="water"](area.a);'
                 'way["landuse"~"^(grass|forest)$"](area.a);way["highway"~"^(path|footway|service|track)$"](area.a);'
                 'node["natural"="tree"](area.a););out geom;')
            data = None
            for ep in OVERPASS:
                try:
                    data = _get(ep, urllib.parse.urlencode({'data': q}).encode(), tries=4)
                    break
                except RuntimeError:
                    continue
            if data is None:
                raise RuntimeError('OpenStreetMap (Overpass) is busy; run the build again in a few minutes')
            self.cache[key] = data
            self.save()
        return self.cache[key]

    def vectors(self, way_id, outline, local):
        """the course as layers of polygons, lines and tree points, in local meters"""
        layers = {}
        add = lambda layer, pts: layers.setdefault(layer, []).append(simplify([local(*p) for p in pts]))
        for e in self.features(way_id)['elements']:
            t = e.get('tags', {})
            golf, nat, land, hw = t.get('golf'), t.get('natural'), t.get('landuse'), t.get('highway')
            if e['type'] == 'node':
                if nat == 'tree':
                    layers.setdefault('trees', []).append(local(e['lon'], e['lat']))
                continue
            rings = ([[[p['lon'], p['lat']] for p in e['geometry']]] if e['type'] == 'way'
                     else [[[p['lon'], p['lat']] for p in m['geometry']] for m in e.get('members', [])
                           if m.get('role') == 'outer' and m.get('geometry')])
            for pts in rings:
                if golf in POLY:
                    add(POLY[golf], pts)
                elif golf in LINE or hw in ('path', 'footway', 'service', 'track'):
                    add('path', pts)
                elif nat == 'water':
                    add('water', pts)
                elif nat in ('wood', 'scrub') or land == 'forest':
                    add('wood', pts)
                elif nat == 'tree_row':
                    add('treerow', pts)
                elif land == 'grass':
                    add('grass', pts)
        layers['outline'] = [simplify([local(*p) for p in outline])] if outline else []
        return layers

    def elevation(self, lon, lat):
        key = f'el:{lon:.5f},{lat:.5f}'
        if key not in self.cache:
            r = _get(f'{EPQS}?x={lon:.6f}&y={lat:.6f}&units=Feet&wkid=4326&includeDate=false')
            self.cache[key] = round(float(r['value']), 1)
            self.save()
        return self.cache[key]

    def course(self, spec):
        og = self.opengolf(spec['opengolf'])
        holes_og = [h for h in og.get('holes_data') or [] if h.get('par')]
        # the middle set of tees (whites at most places): the yardage most people play
        keys = [k for k in (holes_og[0].get('yardages') or {}) if all((h.get('yardages') or {}).get(k) for h in holes_og)]
        keys.sort(key=lambda k: sum(h['yardages'][k] for h in holes_og))
        named = [k for k in ('white', 'regular', 'middle') if k in keys]
        tee_key = named[0] if named else keys[len(keys) // 2] if keys else None
        back_key = keys[-1] if keys else None
        osm = self.osm(spec['osm'])
        outline = next((e for e in osm['elements'] if e['type'] == 'way' and e['id'] == spec['osm']), None)
        lines = [e for e in osm['elements'] if e['type'] == 'way' and e.get('tags', {}).get('golf') == 'hole']
        ring = [[p['lon'], p['lat']] for p in outline['geometry']] if outline else []
        lons, lats = [p[0] for p in ring] or [og['lng']], [p[1] for p in ring] or [og['lat']]
        local = Local((min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2)
        holes, used = [], set()
        for h in holes_og:
            n = h['number']
            back = (h.get('yardages') or {}).get(back_key) or 0
            # OSM's hole n: the one closest to the scorecard's length (a course with two
            # nines in one outline has two hole 1s)
            cands = [e for e in lines if e.get('tags', {}).get('ref') == str(n) and e['id'] not in used]
            line = min(cands, key=lambda e: abs(yards([[p['lon'], p['lat']] for p in e['geometry']]) - back), default=None)
            entry = dict(n=n, par=h['par'], hcp=h.get('handicap_index'), yds=(h.get('yardages') or {}).get(tee_key))
            if line:
                used.add(line['id'])
                pts = [[p['lon'], p['lat']] for p in line['geometry']]
                tee_el, green_el = self.elevation(*pts[0]), self.elevation(*pts[-1])
                entry.update(brg=round(bearing(pts[0], pts[-1])), rise=round(green_el - tee_el),
                             line=[local(*p) for p in pts])
            holes.append(entry)
        # the whole course, for courses whose holes aren't mapped: a sweep down its longest
        # stretch (its two farthest-apart corners, pulled in a little)
        overview = None
        if ring:
            xy = [local(*p) for p in ring]
            a, b = max(((p, q) for i, p in enumerate(xy) for q in xy[i + 1:]),
                       key=lambda pq: (pq[0][0] - pq[1][0]) ** 2 + (pq[0][1] - pq[1][1]) ** 2)
            pull = lambda u, v: [round(u[k] + (v[k] - u[k]) * 0.14, 1) for k in (0, 1)]
            overview = dict(line=[pull(a, b), pull(b, a)])
        # that set's rating and slope: the tee listing nearest its length
        total = sum(h['yds'] or 0 for h in holes)
        tees = [t for t in og.get('tees') or [] if t.get('yardage')]
        tee = min(tees, key=lambda t: abs(t['yardage'] - total), default=None)
        ins = og.get('insights') or {}
        return dict(
            key=spec['key'], name=spec['name'], full=og.get('course_name'), lat=og.get('lat'), lng=og.get('lng'),
            address=og.get('address'), phone=og.get('phone'), architect=og.get('architect'), built=og.get('year_built'),
            holes=holes, par=sum(h['par'] for h in holes), yards=sum(h['yds'] or 0 for h in holes), tee=tee_key,
            rating=tee and tee.get('course_rating'), slope=tee and tee.get('slope'),
            bunkers=ins.get('bunker_count'), hardest=(ins.get('hardest_hole') or {}).get('number'),
            elevation=self.elevation(og['lng'], og['lat']) if og.get('lng') else None,
            overview=overview, map=self.vectors(spec['osm'], ring, local),
        )


def courses(specs):
    g = GolfData()
    out = [g.course(s) for s in specs]
    g.save()
    return out


if __name__ == '__main__':
    sys.path.insert(0, HERE)
    from channels import GOLF_WEATHER
    for c in courses(GOLF_WEATHER['courses']):
        mapped = sum(1 for h in c['holes'] if 'line' in h)
        print('   layers:', {k: len(v) for k, v in c['map'].items()}, f"{len(json.dumps(c['map'])) // 1024} KB")
        print(f"{c['name']:15} par {c['par']} {c['yards']} yds ({c['tee']}) {c['rating']}/{c['slope']} {c['elevation']} ft"
              f" | holes mapped {mapped}/{len(c['holes'])}")
        for h in c['holes'][:3]:
            print('   ', {k: h.get(k) for k in ('n', 'par', 'hcp', 'yds', 'brg', 'rise')})
