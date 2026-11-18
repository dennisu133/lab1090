"""
Synthetic messages for what the capture doesn't contain: every ADS-B type code and subtype,
every ADS-B version of the operational status, DF18 with each control field (CF), DF16
coordination replies, and surface positions. Each message gets a random (seeded) payload and
a correct CRC, so it's well-formed but not necessarily sensible: good for comparing field
decoding, not for anything physical.

The surface positions lie near 12 references around the world (the date line, the poles,
the southern hemisphere); every pyModeS decode of our encoder's messages lands within 1 m of
the true position. What pyModeS doesn't decode (DF18's CF and IMF, TC 29 subtype 0, TC 31's
capability and mode bits) has hand-made cases in src/lib/modes/synthetic.test.ts instead.

Writes two files (see tools/README.md):

  fixtures/oracle/synthetic.jsonl   one message per line, with everything pyModeS.decode()
                                    returns, plus "ra" (BDS 3,0 decode) for DF16 with VDS 0x30
  fixtures/oracle/surface.json      surface CPR: true positions near a reference, encoded as
                                    even/odd messages (our own encoder, below), and pyModeS's
                                    decodes with the reference and as pairs

Usage: tools/.venv/bin/python tools/oracle-synthetic.py
"""

import json
import random
from math import cos, floor, radians
from pathlib import Path

import pyModeS
from pyModeS.decoder.bds.bds30 import decode_bds30
from pyModeS.position import cprNL, surface_position_pair, surface_position_with_ref
from pyModeS.util import crc

ROOT = Path(__file__).resolve().parent.parent
rng = random.Random(1090)


def message(df: int, ca: int, icao: int, me: int) -> str:
    """A 112-bit message with its parity (CRC, no address overlay) filled in."""
    head = f"{(df << 3) | ca:02x}{icao:06x}{me:014x}"
    return head + f"{crc(head + '000000'):06x}"


def me_with(tc: int, subtype_bits: int = 3, subtype: int | None = None) -> int:
    """Random 56-bit payload with the given type code (and subtype, if asked)."""
    me = rng.getrandbits(56) & ((1 << 51) - 1) | (tc << 51)
    if subtype is not None:
        shift = 51 - subtype_bits
        mask = ((1 << subtype_bits) - 1) << shift
        me = (me & ~mask) | (subtype << shift)
    return me


def payloads():
    """(df, ca/cf, me) for everything worth covering."""
    for tc in range(32):
        for _ in range(16):
            yield 17, 5, me_with(tc)
    for st in range(8):
        for tc in (19, 23, 28):
            for _ in range(8):
                yield 17, 5, me_with(tc, 3, st)
    for st in range(4):
        for _ in range(24):
            yield 17, 5, me_with(29, 2, st)
    for st in (0, 1, 2):
        for version in range(4):
            for _ in range(16):
                me = me_with(31, 3, st)
                me = (me & ~(0b111 << 13)) | (version << 13)  # ME bits 41–43
                yield 17, 5, me
    for cf in range(8):
        for tc in (2, 6, 11, 19, 21, 28, 29, 31):
            for _ in range(3):
                yield 18, cf, me_with(tc)
    for af in range(8):
        for tc in (4, 11, 19):
            yield 19, af, me_with(tc)


def entries():
    for df, ca, me in payloads():
        msg = message(df, ca, rng.getrandbits(24), me)
        yield {"message": msg, **pyModeS.decode(msg)}
    # DF16: the header fields vary, MV is a coordination reply (VDS 0x30).
    for _ in range(64):
        header = (16 << 27) | rng.getrandbits(27)  # DF16, random VS…AC
        mv = (0x30 << 48) | rng.getrandbits(48)
        head = f"{header:08x}{mv:014x}"
        msg = head + f"{crc(head + '000000') ^ rng.getrandbits(24):06x}"
        yield {"message": msg, **pyModeS.decode(msg), "ra": decode_bds30(mv)}


# --- surface CPR -----------------------------------------------------------------------------

NZ = 15


def encode_surface(lat: float, lon: float, odd: int) -> tuple[int, int]:
    """
    DO-260B A.1.7.3. The spec says 19 bits over the airborne zone (6°), of which the lowest
    17 are sent: the same as 17 bits over a zone a quarter that size (1.5°), as here.
    """
    dlat = 90 / (4 * NZ - odd)
    yz = floor(2**17 * (lat % dlat) / dlat + 0.5)
    rlat = dlat * (yz / 2**17 + floor(lat / dlat))
    zones = cprNL(rlat) - odd
    dlon = 90 / zones if zones > 0 else 90
    xz = floor(2**17 * (lon % dlon) / dlon + 0.5)
    return yz % 2**17, xz % 2**17


def surface_cases():
    references = [(51.47, -0.45), (40.64, -73.78), (-33.94, 151.18), (64.13, -21.94),
                  (1.36, 103.99), (-0.5, 36.9), (21.32, -157.92), (52.0, 179.6),
                  (-52.0, -179.7), (0.2, 0.1), (78.2, 15.5), (-77.85, 166.6)]  # fmt: skip
    for ref in references:
        for _ in range(24):
            # Within ~40 NM (0.6°) of the reference, most of them right at an airport.
            spread = 0.6 if rng.random() < 0.3 else 0.03
            lat = ref[0] + rng.uniform(-spread, spread)
            lon = ref[1] + rng.uniform(-spread, spread) / max(0.2, cos(radians(lat)))
            lon = (lon + 180) % 360 - 180
            even = encode_surface(lat, lon, 0)
            odd = encode_surface(lat, lon, 1)
            yield {
                "reference": ref,
                "truth": [lat, lon],
                "even": even,
                "odd": odd,
                "local_even": surface_position_with_ref(0, *even, *ref),
                "local_odd": surface_position_with_ref(1, *odd, *ref),
                "pair_even_newer": surface_position_pair(*even, *odd, lat_ref=ref[0], lon_ref=ref[1], even_is_newer=True),
                "pair_odd_newer": surface_position_pair(*even, *odd, lat_ref=ref[0], lon_ref=ref[1], even_is_newer=False),
            }  # fmt: skip


with open(ROOT / "fixtures/oracle/synthetic.jsonl", "w") as f:
    for e in entries():
        f.write(json.dumps(e, separators=(",", ":")) + "\n")

with open(ROOT / "fixtures/oracle/surface.json", "w") as f:
    json.dump(list(surface_cases()), f, separators=(",", ":"))
