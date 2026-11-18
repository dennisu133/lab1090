# Fixtures

## `capture.beast`

A raw recording of the Pi's Beast output (`pi:30005`), byte for byte as it came off the socket:

```bash
timeout 600 bash -c 'cat < /dev/tcp/pi/30005' > fixtures/capture.beast
```

|          |                                                                                     |
| -------- | ----------------------------------------------------------------------------------- |
| Recorded | 2026-11-13 16:18:23 CET, 10 min (Beast timestamps span 596.8 s)                     |
| Receiver | readsb 3.16.21, RTL-SDR v3, autogain                                                |
| Size     | 663,697 bytes                                                                       |
| Frames   | 33,973: 33,968 Mode S + 5 keepalives (type `'1'`, all zeros) at the start           |
| Escapes  | 1,889 escaped `1A 1A` pairs (37,751 `0x1A` bytes = 33,973 frame starts + 2 × 1,889) |

Downlink formats:

| DF     | 0     | 4     | 5     | 11    | 16  | 17    | 20    | 21    |
| ------ | ----- | ----- | ----- | ----- | --- | ----- | ----- | ----- |
| Frames | 2,147 | 6,576 | 1,692 | 6,658 | 139 | 7,545 | 6,327 | 2,884 |

DF17 came from 19 distinct aircraft. Type codes: 0 (26), 4 (267), 11 (2,196), 12 (506),
18 (61), 19 (2,747), 28 (132), 29 (1,096), 31 (514).

The file starts at a frame boundary, because readsb starts each new client on a frame. The
timestamps are 12 MHz receiver ticks and are monotonic throughout. They count from when
readsb started, not wall-clock time.

Parity: every DF11 and DF17 passes the CRC, and every address recovered from the parity of
DF0/4/5/16/20/21 belongs to an aircraft that also sent DF11/17 (readsb already filtered).
Replayed in order through `AddressFilter`, 13 AP messages come out "unknown": they precede
their aircraft's first DF11/17 in the recording.

## `oracle/`

pyModeS's answers for the capture's messages (and for synthetic ones covering what the
capture lacks), which our decoders are tested against. Written by the `tools/oracle*.py`
scripts, kept exactly as they write them (`bun fmt` skips this folder), so regenerating
them (`tools/README.md`) and seeing `git status` stay clean proves nothing changed.

| File              | Content                                                             | Tested in                                                |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `crc.tsv`         | CRC remainder (syndrome) and address of all 7,481 distinct messages | `src/lib/modes/crc.test.ts`                              |
| `decoded.jsonl`   | Full pyModeS decode of the same messages (1.7 MB)                   | `identification`, `altitude`, `header`, `squitter` tests |
| `codes.json`      | All 8,192 altitude codes and squawks                                | `src/lib/modes/altitude.test.ts`                         |
| `cpr.json`        | NL zone boundaries; global and local CPR decodes of all positions   | `src/lib/modes/cpr.test.ts`                              |
| `commb.jsonl`     | Comm-B registers: validators, decodes, inference (5,467 payloads)   | `src/lib/modes/registers.test.ts`                        |
| `synthetic.jsonl` | 1,272 synthetic messages: every TC/subtype/version, DF16/18/19      | `src/lib/modes/synthetic.test.ts`                        |
| `surface.json`    | 288 surface positions: truth, encoded pair, pyModeS's decodes       | `src/lib/modes/synthetic.test.ts`                        |

An hour of the same, for the experiments, is in `local/` (not committed).

## `wmm/`

`WMM2025_TestValues.txt`: NOAA's test values for the World Magnetic Model 2025, as shipped
with the coefficients (`WMM2025COF.zip` from
<https://www.ncei.noaa.gov/products/world-magnetic-model>). 100 points from pole to pole,
2025–2029.5, with declination, inclination and field components. Public domain (US
government work). Tested in `src/lib/weather/wmm.test.ts`; the coefficients themselves are
in `src/lib/weather/wmm2025.ts`.

## `sounding/`

Two weather balloon ascents from Lindenberg (WMO station 10393, 52.21°N 14.12°E),
bracketing the capture: launched 10:45 and 16:45 UTC on 13 Nov
2026, nominally the 12 and 18 UTC soundings. One row per 25 m up to 100 hPa: time, position,
pressure, geopotential height, temperature, mixing ratio and wind. Data: Deutscher
Wetterdienst, via the University of Wyoming's sounding archive (`tools/sounding.ts`,
`tools/README.md`).

`src/lib/weather/sounding.test.ts` checks the capture's /weather results against them. The
sea-level pressure for that comes from Berlin Brandenburg airport's report at 15:20 UTC,
`EDDB 131520Z AUTO 28016KT 9999 SCT041 08/01 Q1007` (Iowa Environmental Mesonet's METAR
archive), quoted in the test rather than stored.
