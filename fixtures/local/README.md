# Local recordings

Recordings of the sky that aren't committed: too big for the repository, and an hour of one
receiver's traffic says a lot about where it stands. Everything here but this file is
gitignored. The tests don't need any of it (they use the files one level up); the tools below do. Make
your own with the commands given.

## Samples: `{a,b,c}.u8` and `.readsb`

Raw RTL-SDR samples (UC8, 2.4 MS/s), and readsb's messages from the same file. The
demodulator was tuned on them: a change made for speed must leave its output identical on
all three (`tools/demod-bench.ts x.u8 --save x.out` before, `--check x.out` after), and
`tools/demod-compare.ts x.u8 x.readsb` says message by message what readsb found that we
didn't.

| Recording | When (18 Nov 2026) | Gain    | Length         |
| --------- | ------------------ | ------- | -------------- |
| `a.u8`    | 14:26              | 49.6 dB | 5 min, 1.44 GB |
| `b.u8`    | 14:33              | 49.6 dB | 5 min, 1.44 GB |
| `c.u8`    | afternoon          | 40.2 dB | 2 min, 0.58 GB |

The pulse shape (`src/lib/demod/pulse.ts`) was fitted on A; B and C are the check.

```bash
rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 720000000 a.u8                # on the Pi
readsb --device-type ifile --ifile a.u8 --iformat UC8 > a.readsb  # not --raw: tools/readsb.ts
```

## Messages: `capture-1h.beast`

An hour of the Pi's Beast output (readsb, like `fixtures/capture.beast`), during busy
traffic, for what needs more than 10 minutes: coverage and the radar finder. Through the
tracker it takes ~5 s, through the radar finder ~50 s: too slow for `bun test`. To watch
it: `bun tools/replay.ts fixtures/local/capture-1h.beast`.

```bash
timeout 3600 bash -c 'cat < /dev/tcp/pi/30005' > fixtures/local/capture-1h.beast
```

Recorded 2026-11-16 14:34:44 CET (a Monday afternoon), 60 min: 338,893 Mode S frames, 79,218
of them DF17 from 96 aircraft (84 with positions the tracker confirmed). The last frame is
cut off (`timeout` stopped it).

What the hour showed: coverage open from 170° to 350° down to 1.3–4.1° elevation, farthest
266 km (62 % of the radio horizon), the south-east and east blocked up to 12–18° by the
antenna's own building although traffic flies there, terrain ≤ 0.2°; the radar finder
confirmed 9 radars, all near known sites, no phantoms (~44 s CPU).
