"""
pyModeS's CPR decoding of every airborne position (DF17, TC 9-18) in the capture, as JSON:

  {"nl_boundaries": [...], "reference": [lat, lon], "positions": [...]}

- nl_boundaries: the latitudes where the number of longitude zones (NL) drops by one.
- positions: in capture order, each with the global decode (paired with the same aircraft's
  latest message from the other grid, if at most 10 s old) and the local decode against
  `reference`.
- reference: the mean of all global positions, rounded to whole degrees. Derived from the
  capture itself, so the fixture doesn't contain anyone's location.

Reads "seconds hex" lines (bun tools/dump-messages.ts --timed). See tools/README.md.
"""

import json
import sys

import pyModeS
from pyModeS.position import _cpr

MAX_AGE_S = 10

positions = []
latest = {}  # icao -> {0: (t, lat, lon), 1: ...}
for line in sys.stdin:
    t, msg = line.split()
    t = float(t)
    d = pyModeS.decode(msg)
    if d.get("df") != 17 or not 9 <= d.get("typecode", 0) <= 18:
        continue
    fmt, lat, lon = d["cpr_format"], d["cpr_lat"], d["cpr_lon"]
    mine = latest.setdefault(d["icao"], {})
    mine[fmt] = (t, lat, lon)
    partner = mine.get(1 - fmt)
    pos = None
    if partner and t - partner[0] <= MAX_AGE_S:
        even, odd = (mine[0], mine[1])
        pos = _cpr.airborne_position_pair(
            even[1], even[2], odd[1], odd[2], even_is_newer=fmt == 0
        )
    positions.append({"t": t, "message": msg, "icao": d["icao"], "global": pos})

found = [p["global"] for p in positions if p["global"]]
reference = [
    round(sum(p[0] for p in found) / len(found)),
    round(sum(p[1] for p in found) / len(found)),
]
for p in positions:
    d = pyModeS.decode(p["message"])
    p["local"] = _cpr.airborne_position_with_ref(
        d["cpr_format"], d["cpr_lat"], d["cpr_lon"], *reference
    )

print(
    json.dumps(
        {
            "nl_boundaries": list(_cpr._NL_BOUNDARIES),
            "reference": reference,
            "positions": positions,
        },
        separators=(",", ":"),
    )
)
