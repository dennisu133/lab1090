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

## `wmm/`

`WMM2025_TestValues.txt`: NOAA's test values for the World Magnetic Model 2025, as shipped
with the coefficients (`WMM2025COF.zip` from
<https://www.ncei.noaa.gov/products/world-magnetic-model>). 100 points from pole to pole,
2025–2029.5, with declination, inclination and field components. Public domain (US
government work). Tested in `src/lib/weather/wmm.test.ts`; the coefficients themselves are
in `src/lib/weather/wmm2025.ts`.
