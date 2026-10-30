#!/bin/bash
# Download OSM buildings + roads + rail + water/parks for the map bbox (Overpass API).
B=$(python3 -c "import json;b=json.load(open('../data/bounds.json'));print(f\"{b['south']},{b['west']},{b['north']},{b['east']}\")")
Q="[out:json][timeout:120];(way[building]($B);relation[building]($B);way[highway]($B);way[railway=rail]($B);way[natural=water]($B);way[waterway]($B);way[leisure~\"park|pitch\"]($B);way[landuse~\"grass|recreation_ground\"]($B););out geom tags;"
curl -sS --fail-with-body -A "ww2-sunshine-game-build/1.0" --data-urlencode "data=$Q" https://overpass-api.de/api/interpreter -o ../data/osm_raw.json
ls -la ../data/osm_raw.json
