"""
Reference values from pyModeS (by the author of "The 1090 MHz Riddle"), to test our own
decoder against. Reads hex messages from stdin, writes TSV to stdout:

    message  crc  icao

crc:  CRC-24 remainder over the whole message, parity included ("syndrome"):
      0 for a valid DF17/18, the aircraft address for DF0/4/5/16/20/21.
icao: what pyModeS reports as the address (AA field, or the remainder for AP formats).

The output is committed under fixtures/oracle/, so tests don't need Python. pyModeS 3 has
no top-level pms.crc()/pms.icao() any more: this uses pyModeS.util.crc and
pyModeS.decode(msg)["icao"].
See tools/README.md.
"""

import sys

import pyModeS
from pyModeS.util import crc

print(f"# pyModeS {pyModeS.__version__ if hasattr(pyModeS, '__version__') else ''}".rstrip())
print("message\tcrc\ticao")
for line in sys.stdin:
    msg = line.strip()
    if not msg:
        continue
    decoded = pyModeS.decode(msg)
    print(f"{msg}\t{crc(msg):06x}\t{decoded['icao']}")
