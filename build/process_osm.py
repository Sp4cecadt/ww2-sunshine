# Convert raw Overpass JSON into compact game map data in local metres (x east, z south, origin = map centre).
import json, math, random
b = json.load(open('../data/bounds.json')); d = json.load(open('../data/osm_raw.json'))
W, H = b['width_m'], b['height_m']
def my(lat): return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
yn, ys = my(b['north']), my(b['south'])
def xy(p):
    x = ((p['lon'] - b['west']) / (b['east'] - b['west']) - 0.5) * W
    z = ((yn - my(p['lat'])) / (yn - ys) - 0.5) * H
    return round(x, 1), round(z, 1)
def area(pts):
    a = 0
    for i in range(len(pts)):
        x1, z1 = pts[i]; x2, z2 = pts[(i + 1) % len(pts)]; a += x1 * z2 - x2 * z1
    return a / 2
out = dict(bounds=b, size=[round(W, 1), round(H, 1)], buildings=[], roads=[], rail=[], water=[], green=[])
RW = dict(primary=11, secondary=9, tertiary=8, residential=6.5, unclassified=6, service=4, trunk=12, primary_link=7, secondary_link=6, tertiary_link=6)
for e in d['elements']:
    t = e.get('tags', {})
    if e['type'] == 'relation':
        geoms = [m['geometry'] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
    else:
        geoms = [e['geometry']] if 'geometry' in e else []
    for g in geoms:
        pts = [xy(p) for p in g]
        if 'building' in t:
            if pts[0] == pts[-1]: pts = pts[:-1]
            if len(pts) < 3: continue
            a = area(pts)
            if a < 0: pts = pts[::-1]
            a = abs(a)
            if a < 12: continue
            random.seed(e['id'])
            if 'height' in t:
                try: h = float(t['height'].split()[0])
                except: h = 6
            elif 'building:levels' in t:
                try: h = float(t['building:levels']) * 3.2 + 1.5
                except: h = 6
            else:
                bt = t['building']
                if bt in ('shed', 'garage', 'roof'): h = 3
                elif bt in ('house', 'terrace', 'detached'): h = 5 + random.random() * 1.5
                elif a < 180: h = 4.5 + random.random() * 2
                elif a < 1500: h = 7 + random.random() * 4
                else: h = 9 + random.random() * 4
            out['buildings'].append(dict(h=round(h, 1), p=[c for xz in pts for c in xz], k=t['building'][:10]))
        elif 'highway' in t and t['highway'] in RW:
            out['roads'].append(dict(w=RW[t['highway']], p=[c for xz in pts for c in xz]))
        elif t.get('railway') == 'rail':
            out['rail'].append([c for xz in pts for c in xz])
        elif 'waterway' in t or t.get('natural') == 'water':
            out['water'].append([c for xz in pts for c in xz])
        elif t.get('leisure') or t.get('landuse'):
            out['green'].append([c for xz in pts for c in xz])
s = json.dumps(out, separators=(',', ':'))
open('../data/map.json', 'w').write(s)
print(len(out['buildings']), len(out['roads']), len(out['rail']), len(out['water']), len(out['green']), len(s) // 1024, 'KB')
