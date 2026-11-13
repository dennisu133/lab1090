"""
pyModeS's decoding of every possible 13-bit altitude code (AC) and identity code (ID),
as JSON: {"altitude": [8192 values, feet or null], "squawk": [8192 strings]}.
The index is the code. Exhaustive, so it also covers encodings our capture never contains
(Gillham altitudes, odd squawks). See tools/README.md.
"""

import json

from pyModeS._altcode import altcode_to_altitude
from pyModeS._idcode import idcode_to_squawk

codes = range(1 << 13)
print(
    json.dumps(
        {
            "altitude": [altcode_to_altitude(c) for c in codes],
            "squawk": [idcode_to_squawk(c) for c in codes],
        },
        separators=(",", ":"),
    )
)
