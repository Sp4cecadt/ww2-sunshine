# Download Esri World Imagery tiles around Sunshine VIC and stitch to one texture (z17, 8x8 = 2048px).
import math, io, json, urllib.request
from PIL import Image
LAT, LON, Z, N = -37.788, 144.832, 17, 8
def tile(lat, lon, z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y
cx, cy = tile(LAT, LON, Z)
x0, y0 = int(cx - N / 2 + 0.5), int(cy - N / 2 + 0.5)
img = Image.new('RGB', (256 * N, 256 * N))
for j in range(N):
    for i in range(N):
        url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{Z}/{y0+j}/{x0+i}'
        req = urllib.request.Request(url, headers={'User-Agent': 'ww2-sunshine-game-build/1.0'})
        img.paste(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB'), (256 * i, 256 * j))
img.save('../data/sunshine_sat.jpg', quality=82)
def lonlat(x, y, z):
    n = 2 ** z; lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))); return lat, lon
n_, w_ = lonlat(x0, y0, Z); s_, e_ = lonlat(x0 + N, y0 + N, Z)
bounds = dict(north=n_, south=s_, west=w_, east=e_)
# metres per degree at centre
clat = (n_ + s_) / 2
bounds['width_m'] = (e_ - w_) * 111320 * math.cos(math.radians(clat))
bounds['height_m'] = (n_ - s_) * 110574
json.dump(bounds, open('../data/bounds.json', 'w'), indent=1); print(bounds)
