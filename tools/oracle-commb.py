"""
pyModeS's view of every Comm-B payload (MB) in the capture: which registers its validators
accept, what each accepted register decodes to, and which one its inference picks (without
any aircraft state): once by default, once with the meteorological registers 4,4 and 4,5
(include_meteo). Reads hex messages from stdin; see tools/README.md.

Besides the real payloads, each one is also included with 1-3 random bit flips (seeded),
so the validators get compared near their edges too, not only on clean data.

pyModeS doesn't know 5,1 and 5,2: those are checked against the capture's own ADS-B
(src/lib/modes/comm-b.test.ts). pyModeS 3 dropped 5,3: hand-made tests from ICAO Doc 9871
and pyModeS 2 (registers.test.ts).
"""

import json
import random
import sys

from pyModeS.decoder.bds import (
    _infer,
    bds10,
    bds17,
    bds20,
    bds30,
    bds40,
    bds44,
    bds45,
    bds50,
    bds60,
)

REGISTERS = {
    "1,0": (bds10.is_bds10, bds10.decode_bds10),
    "1,7": (bds17.is_bds17, bds17.decode_bds17),
    "2,0": (bds20.is_bds20, bds20.decode_bds20),
    "3,0": (bds30.is_bds30, bds30.decode_bds30),
    "4,0": (bds40.is_bds40, bds40.decode_bds40),
    "5,0": (bds50.is_bds50, bds50.decode_bds50),
    "6,0": (bds60.is_bds60, bds60.decode_bds60),
    "4,4": (bds44.is_bds44, bds44.decode_bds44),
    "4,5": (bds45.is_bds45, bds45.decode_bds45),
}


def entry(mb: int, real: bool) -> dict:
    valid = {code: fns[1](mb) for code, fns in REGISTERS.items() if mb and fns[0](mb)}
    return {
        "mb": f"{mb:014x}",
        "real": real,
        "inferred": _infer.infer(mb, 20),
        "inferred_meteo": _infer.infer(mb, 20, include_meteo=True),
        "valid": valid,
    }


rng = random.Random(1090)
seen: set[int] = set()
out = []
for line in sys.stdin:
    msg = line.strip()
    if not msg or (int(msg[:2], 16) >> 3) not in (20, 21):
        continue
    mb = int(msg[8:22], 16)
    if mb in seen:
        continue
    seen.add(mb)
    out.append(entry(mb, True))
    flipped = mb
    for bit in rng.sample(range(56), rng.randint(1, 3)):
        flipped ^= 1 << bit
    if flipped not in seen:
        seen.add(flipped)
        out.append(entry(flipped, False))

for e in out:
    print(json.dumps(e, separators=(",", ":")))
