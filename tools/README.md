# tools/

Helpers that aren't part of the app. Nothing in `src/` imports from here.

## pyModeS oracle

[pyModeS](https://github.com/junzis/pyModeS) is the reference decoder by the author of
"The 1090 MHz Riddle". We use it as an **oracle**: it computes the expected values for
the messages in our capture, and our own TypeScript decoder is tested against them.

The output is committed (`fixtures/oracle/`), so `bun test` doesn't need Python. You
only need the setup below to regenerate or extend it.

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt

bun tools/dump-messages.ts fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle.py > fixtures/oracle/crc.tsv
bun tools/dump-messages.ts fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle-decode.py > fixtures/oracle/decoded.jsonl
tools/.venv/bin/python tools/oracle-codes.py > fixtures/oracle/codes.json
bun tools/dump-messages.ts --timed fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle-cpr.py > fixtures/oracle/cpr.json
bun tools/dump-messages.ts fixtures/capture.beast \
  | tools/.venv/bin/python tools/oracle-commb.py > fixtures/oracle/commb.jsonl
tools/.venv/bin/python tools/oracle-synthetic.py   # writes synthetic.jsonl and surface.json
```

- `dump-messages.ts`: prints every distinct Mode S message of a Beast capture as hex,
  using our own Beast parser (the parser has its own tests). With `--timed`: every
  message in order, with its receiver timestamp in seconds.
- `oracle.py`: reads hex messages, writes `message  crc  icao` as TSV.
- `oracle-codes.py`: no input; decodes all 8,192 possible 13-bit altitude and identity
  codes, so those decoders are tested exhaustively, including encodings the capture
  doesn't contain (the old Gillham altitude code).
- `oracle-cpr.py`: reads timed messages, pairs each airborne position with the same
  aircraft's latest one from the other CPR grid (≤ 10 s), and writes pyModeS's global and
  local decodes. The reference for local decoding is the mean of all global positions,
  rounded to whole degrees: derived from the capture, not anyone's configured location.
- `oracle-commb.py`: reads hex messages, and for every distinct Comm-B payload (MB) of
  DF20/21 writes which registers pyModeS's validators accept (1,0 1,7 2,0 3,0 4,0 4,4
  4,5 5,0 6,0), what each decodes to, and which one its inference picks without aircraft
  state, both by default and with the meteorological registers (`include_meteo`). Each
  payload is also included with 1–3 random bit flips (seeded), so the validators are
  compared near their edges too. pyModeS doesn't know 5,1/5,2; those are tested against
  the capture's own ADS-B instead (`src/lib/modes/comm-b.test.ts`). pyModeS 3 dropped
  5,3; that one has hand-made tests, from the layout in pyModeS 2 and ICAO Doc 9871.
- `oracle-synthetic.py`: no input; covers what the capture doesn't contain. Generates
  messages with random (seeded) payloads and a correct CRC for every type code and
  subtype, every operational status version (TC 31), DF18 with each control field, DF19,
  and DF16 coordination replies (VDS 0x30), and writes pyModeS's decode of each. Plus
  surface positions: true positions near 12 references around the world (date line,
  poles, southern hemisphere), encoded as even/odd messages by an encoder in the script
  (checked against pyModeS: every decode lands within 1 m), with pyModeS's local and pair
  decodes. Where pyModeS doesn't decode something (DF18's CF and IMF, TC 29 subtype 0,
  TC 31's capability and mode bits), `synthetic.test.ts` has hand-made cases; their
  layouts come from readsb's decoder and, for the aircraft size, EUROCONTROL's ASTERIX
  CAT021 spec.
- `oracle-decode.py`: reads hex messages, writes everything `pyModeS.decode()` returns
  as JSON lines (callsign, altitude, position fields, velocity, …). This is the reference
  for all decoders after the CRC.

| File                              | Content                                                             | Tested in                                                |
| --------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `fixtures/oracle/crc.tsv`         | CRC remainder (syndrome) and address of all 7,481 distinct messages | `src/lib/modes/crc.test.ts`                              |
| `fixtures/oracle/decoded.jsonl`   | Full pyModeS decode of the same messages (1.7 MB)                   | `identification`, `altitude`, `header`, `squitter` tests |
| `fixtures/oracle/codes.json`      | All 8,192 altitude codes and squawks                                | `src/lib/modes/altitude.test.ts`                         |
| `fixtures/oracle/cpr.json`        | NL zone boundaries; global and local CPR decodes of all positions   | `src/lib/modes/cpr.test.ts`                              |
| `fixtures/oracle/commb.jsonl`     | Comm-B registers: validators, decodes, inference (5,467 payloads)   | `src/lib/modes/registers.test.ts`                        |
| `fixtures/oracle/synthetic.jsonl` | 1,272 synthetic messages: every TC/subtype/version, DF16/18/19      | `src/lib/modes/synthetic.test.ts`                        |
| `fixtures/oracle/surface.json`    | 288 surface positions: truth, encoded pair, pyModeS's decodes       | `src/lib/modes/synthetic.test.ts`                        |

pyModeS 3 changed its API (no more `pms.crc()`/`pms.icao()` at the top level); this
uses `pyModeS.util.crc` and `pyModeS.decode(msg)["icao"]`.
