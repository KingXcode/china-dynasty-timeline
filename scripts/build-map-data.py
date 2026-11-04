#!/usr/bin/env python3
"""Reproducible selective extract, no invented/retimed geometry. Python stdlib only.
Usage: python3 scripts/build-map-data.py /path/cliopatria_polities_only_v021.geojson
Coordinates are retained exactly; compact JSON and curated regional names only.
"""
import json, hashlib, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE_SHA='fc6f0d1e4cc42f45da83522b3696db6f2cc85ec0d12259a85c89b31347b8fc0a'
p=Path(sys.argv[1]); raw=p.read_bytes()
assert hashlib.sha256(raw).hexdigest()==SOURCE_SHA, 'Source must match pinned v0.2.1 bytes'
names=json.loads((ROOT/'map-data/polities.json').read_text())
data=json.loads(raw); out=[]
for i,f in enumerate(data['features']):
    a=f['properties']
    if a['Name'] not in names or a['FromYear']>1911 or a['ToYear']<-221 or a['Type']!='POLITY':continue
    # Preserve original record properties and full geometry; do not use corrupt
    # Wikidata identifiers as identity keys or relabel the original Name.
    out.append({'type':'Feature','id':i,'properties':a,'geometry':f['geometry']})
result={'type':'FeatureCollection','features':out}
text=json.dumps(result,ensure_ascii=False,separators=(',',':'))
# Each file contains records intersecting one century, avoiding a full 8 MB download.
for century in range(-300,1901,100):
    fs=[f for f in out if f['properties']['FromYear']<=century+99 and f['properties']['ToYear']>=century]
    (ROOT/f'map-data/era-{century}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':fs},ensure_ascii=False,separators=(',',':')))
index={'records':[{'id':f['id'],'name':f['properties']['Name'],'from':f['properties']['FromYear'],'to':f['properties']['ToYear']} for f in out]}
(ROOT/'map-data/index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')))
print(len(out),'source records;',len({f['properties']['Name'] for f in out}),'names;',len(text.encode()),'bytes')
