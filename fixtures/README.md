# Fixtures

## `capture.beast`

A raw recording of the Pi's Beast output (`pi:30005`), byte for byte as it came off the socket:

```bash
timeout 600 bash -c 'cat < /dev/tcp/pi/30005' > fixtures/capture.beast
```

|          |                                                                                     |
| -------- | ----------------------------------------------------------------------------------- |
| Recorded | 2026-11-13 16:18:23 CET, 10 min (Beast timestamps span 596.8 s)                     |
| Receiver | readsb 3.16.21, RTL-SDR v3, autogain, see [`pi/`](../pi)                            |
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

`oracle/` holds reference values from pyModeS for the capture's messages; see `tools/README.md`.

## `capture-1h.beast`

An hour of the same, recorded during busy traffic (a Monday afternoon) for the experiments
that need more than 10 minutes: coverage and the radar finder.

```bash
timeout 3600 bash -c 'cat < /dev/tcp/pi/30005' > fixtures/capture-1h.beast
```

|          |                                                                                    |
| -------- | ---------------------------------------------------------------------------------- |
| Recorded | 2026-11-16 14:34:44 CET, 60 min (Beast timestamps span 3,599.9 s)                  |
| Receiver | as above                                                                           |
| Size     | 6,629,179 bytes                                                                    |
| Frames   | 338,893 Mode S (170,008 short, 168,885 long), no keepalives                        |
| Escapes  | 24,643 escaped `1A 1A` pairs; the last frame is cut off (`timeout` stopped it)     |

Downlink formats:

| DF     | 0      | 4      | 5      | 11     | 16    | 17     | 18  | 20     | 21     |
| ------ | ------ | ------ | ------ | ------ | ----- | ------ | --- | ------ | ------ |
| Frames | 22,820 | 63,916 | 14,762 | 68,510 | 2,120 | 79,218 | 1   | 60,372 | 27,174 |

DF17 came from 96 distinct aircraft, 84 of them with positions the tracker confirmed. Type
codes: 0 (436), 4 (2,904), 7 (5), 11 (24,423), 12 (4,062), 18 (232), 19 (29,013), 28
(1,528), 29 (11,118), 31 (5,497).

Not used by `bun test`: running it through the tracker takes ~5 s, through the radar finder
~50 s. The tests stay on `capture.beast`. What the hour showed: coverage open from 170° to
350° down to 1.3–4.1° elevation, farthest 266 km (62 % of the radio horizon), the south-east
and east blocked up to 12–18° by the building although traffic flies there, terrain ≤ 0.2°;
the radar finder confirmed 9 radars, all near known sites, no phantoms (~44 s CPU). To
watch it: `bun tools/replay.ts fixtures/capture-1h.beast`.

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
