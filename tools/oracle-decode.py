"""
Everything pyModeS decodes from each message, as JSON lines (one object per message,
plus the message itself under "message"). Reads hex messages from stdin.
Reference for our decoders beyond the CRC; see tools/README.md.
"""

import json
import sys

import pyModeS

for line in sys.stdin:
    msg = line.strip()
    if msg:
        print(json.dumps({"message": msg, **pyModeS.decode(msg)}, separators=(",", ":")))
