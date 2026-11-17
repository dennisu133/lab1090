# lab1090

Live Mode S / ADS-B traffic from an RTL-SDR on a Raspberry Pi, decoded and shown by a
SvelteKit app. 1090 MHz is the frequency it all happens on, where transponders answer
radars and broadcast ADS-B; the name follows the custom of tools like dump1090 and tar1090,
with "lab" for what this one is: a place to learn how it works.

An independent learning project, not affiliated with dump1090, readsb, tar1090 or any
other 1090 MHz tool. It stands on their shoulders: readsb is the reference its demodulator
is compared with, and [pyModeS](https://github.com/junzis/pyModeS) the one its decoders are
tested against.

## What this is

A learning project about aviation tech, starting with what aircraft transmit on 1090 MHz.
It's meant to become a tracker, but it's built as a learning tool first: the app doesn't
just show decoded values, it explains them. Every field has a tooltip that says what it is,
how it was calculated and what it means, using the field names from the specifications
(ICAO Doc 9871, RTCA DO-260B), so it can be read alongside the literature.

Everything is decoded here, from the raw bits: CRC and address recovery, altitude codes,
callsigns, CPR positions, velocities, status messages and Comm-B registers. The decoders are
tested against [pyModeS](https://github.com/junzis/pyModeS), see [tools/](tools/README.md).

Pages:

- **/frames**: every frame as it arrives, color-coded hex, decoded content, counts and rates
  per downlink format, type code and parity verdict, signal histogram.
- **/comm-b**: Comm-B replies (DF20/21), which register they most likely came from and how
  that was inferred, compared with what the same aircraft broadcasts via ADS-B.
- **/weather**: two tabs.
  - **Now**: the air above the receiver, from all aircraft of the last half hour, in
    1,000 ft layers: temperature, lapse rate and wind by altitude, the tropopause (WMO
    definition) and the strongest wind (jet stream or not), and the mean temperature of
    the air column below each layer, from the gap between GNSS height and pressure
    altitude (hypsometric equation, with the EGM96 geoid and the pilots' QNH from 4,0 and
    TC 29). Three more ways to the wind: the geostrophic wind from how the pressure
    surfaces slope (GNSS − baro along each level flight), heading checks that compare each
    aircraft's wind with the others' and correct a compass that's clearly off, and winds
    from turns (a circle fitted through the ADS-B ground vectors: no heading needed).
    Checked against weather balloons in the tests (`fixtures/sounding/`).
  - **Per aircraft**: wind and temperature at each aircraft, worked out from its Comm-B
    registers (5,0 and 6,0): the wind triangle with the World Magnetic Model for the
    declination, and the temperature from true airspeed and Mach. From those: tailwind,
    crosswind and drift, the deviation from the standard atmosphere, the total air
    temperature, the air density.

  Every step shown with its own numbers.

- **/receiver**: the receiver itself. A diagnosis first: is the gain right (from the noise in
  ADC steps and from messages that clipped, with a gain to try), are samples getting lost,
  how much CPU demodulating takes, how far off the dongle's crystal is. Then the tuner and
  the link's history, what the demodulator does with 2.4 million samples a second step by
  step (and why the rest stops where it does), the last hour of noise and message rate,
  and signal against distance with the free-space line. With a Beast feed only the rate and
  the signal levels: the rest happens on the machine that demodulates.

- **/**: the tracker. Live aircraft on a map, coloured by altitude, with their trails of the
  last 10 minutes, a dotted line predicting where each one goes next, circles showing how
  accurate its position is, and range rings around the receiver. These, the wind barbs, the
  coverage, the radars and the base map's roads and place names can be switched on and off.
  Tap one for everything known about it (identity, position, flight, autopilot settings,
  what radars read from it, reception) and its live messages, each value explained. Plus
  what no radio message says, looked up in a database: a photo, the type, registration and
  owner, the airline, how the callsign is said on the radio, and the route, drawn on the map
  and checked against what the aircraft actually does (callsigns get reused, and routes in
  the database go stale). Works on phones too. How positions are
  checked before they're believed: `src/lib/tracker/positions.ts`; how the path ahead is
  predicted: `src/lib/tracker/motion.ts`.

  Alerts, on every page: emergencies (squawk 7500/7600/7700, the ADS-B emergency states),
  ACAS resolution advisories and flights asking for priority get a banner, a ring on the map
  (with a line between the two aircraft of an advisory), a mark in the list and in the tab
  title, and a section in the panel on what it means and what happens next. IDENT makes the
  aircraft blink, as on a controller's screen. Optionally also as system notifications
  (desktop browsers, HTTPS or `localhost` only; the switch is in the navigation bar). The
  rules: `src/lib/tracker/alerts.ts`.

  Map: [MapLibre GL JS](https://maplibre.org/) with vector tiles from
  [OpenFreeMap](https://openfreemap.org/) (OpenStreetMap data) and hillshading from the
  [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/), all free and without
  an API key. The browser loads the tiles from those servers directly.

  Aircraft and flights: [adsbdb](https://www.adsbdb.com/) by Jack Wills, with aircraft data
  from PlaneBase, photos from [airport-data.com](https://www.airport-data.com/) and routes
  collected by David Taylor and Jim Mason. The browser asks adsbdb directly, for the selected
  aircraft only, and keeps nothing beyond the tab.

  **Coverage** (a map layer, and the panel behind the receiver's dot): where this antenna
  hears aircraft. Each position is placed by its elevation angle, how far above the horizon
  it stood as seen from the antenna, since a wall or a hill hides everything below its own
  angle, near or far. A sky plot shows the lowest angle heard in each direction against the
  terrain's own skyline (traced over the same elevation tiles as the hillshading); the map
  shows, per altitude band, the farthest position heard in each direction against the radio
  horizon. Where the measured skyline stands well above the terrain's, something near the
  antenna is in the way. Collects from the start, like everything else: `src/lib/coverage/`.

  **Radars** (an experimental map layer, off by default): the ground radars, found from the
  replies alone. Every all-call reply (DF11) names the radar that asked, and a rotating radar
  asks only while its beam points at the aircraft. So its replies come in bursts, one per
  turn, which give the rotation period, and the moments the beam passed aircraft whose
  positions we know give where the radar stands (a resection). Drawn with an uncertainty
  ellipse and the beam sweeping round as the fit predicts; tap one for every step with its
  own numbers. A radar is only shown once its position is pinned down (an ellipse at most
  50 km long) and every fit has found it again for 2 minutes. Against the radar sites mapped
  on OpenStreetMap, the ones it shows lie 1–35 km from one; a few have no mapped site nearby.
  It costs more CPU than everything else together, so it only runs while switched on:
  `src/lib/radar/`.

## Hardware

The reference setup:

- Raspberry Pi 5 (any 64-bit Linux machine with a USB port will do)
- [RTL-SDR Blog v3](https://www.rtl-sdr.com/) dongle
- The RTL-SDR Blog dipole antenna kit, mounted outdoors

Notes on the antenna:

- **Length.** At 1090 MHz the wavelength is 27.5 cm. A half-wave dipole is 13.75 cm tip to
  tip (two arms of ~6.9 cm), a quarter-wave monopole over a ground plane is ~6.9 cm. The
  telescopic dipole from the kit doesn't collapse quite that short (~16 cm), which is a bit
  off but works fine.
- **Orientation.** ADS-B is vertically polarized: mount the dipole or monopole vertically.
- **Placement matters most.** 1090 MHz is line of sight: high up, outdoors, with a clear
  view of the horizon beats any antenna upgrade.
- **Keep the coax short.** Thin coax loses a lot at 1090 MHz (RG-174 around 1 dB/m). A
  longer USB cable to a dongle close to the antenna, or a 1090 MHz filtered LNA at the
  antenna, is better than a long coax run.

## Receiver

lab1090 reads the RTL-SDR itself. It runs `rtl_sdr` (from the rtl-sdr package), which tunes
the dongle to 1090 MHz and hands over 2.4 million raw samples a second, and demodulates
them: it finds each message's preamble, reads the bits from the pulses and keeps what passes
the parity check ([src/lib/demod/](src/lib/demod/demodulator.ts)). That and the address
check is all the server does: it passes the messages on to the browser four times a second
(Server-Sent Events), and all decoding happens there.

Other ways in:

- **An RTL-SDR on another machine**, through `rtl_tcp` there: `--rtl-tcp pi`. It sends the
  raw samples over the network, 38 Mbit/s: fine over Ethernet, too much for weak Wi-Fi.
- **Messages demodulated by readsb or dump1090**, from their Beast output: `--connect pi`.
  A Pi that already feeds a flight tracking network can be used as is.
- **A recording of samples** (`rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 72000000 sky.u8`, 30 s):
  `--samples sky.u8`.

The Pi: [pi/README.md](pi/README.md).

## Getting started

lab1090 is one program: it reads the RTL-SDR and serves the web page. Plug in the dongle,
then:

```sh
sudo apt install rtl-sdr     # rtl_sdr, which lab1090 reads the dongle with
lab1090
```

Then open the address it prints (port 1090) from any device on your network. The first
time, the page asks where the antenna is ([below](#receiver-position)). If something is
wrong with the dongle (not found, in use by another program), the program and the page's
status bar say so, and it keeps trying.

## Configuration

Everything is optional; `lab1090 --help` lists it too.

| Option                    | Default                         | What it is                                               |
| ------------------------- | ------------------------------- | -------------------------------------------------------- |
| `--device <index/serial>` | `0`, the first RTL-SDR          | Which RTL-SDR, if there are several                      |
| `--gain <dB>`             | `49.6`, the most                | The RTL-SDR's gain; less if strong signals overload it   |
| `--rtl-tcp <host[:port]>` |                                 | An RTL-SDR on another machine, via rtl_tcp (port 1234)   |
| `--connect <host[:port]>` |                                 | readsb's or dump1090's Beast output (port 30005)         |
| `--samples <file>`        |                                 | A recording of samples, played at its own pace           |
| `--position <lat,lon>`    | from the config file            | Where the antenna is, decimal degrees (below)            |
| `--port <port>`           | `1090`                          | The web page's port                                      |
| `--bind <address>`        | all                             | Listen on this address only (`127.0.0.1` behind a proxy) |
| `--config <file>`         | `~/.config/lab1090/config.json` | The config file                                          |

`--rtl-tcp`, `--connect` and `--samples` replace the RTL-SDR on this machine: one source
at a time.

The config file takes the same settings as JSON (all but `--samples`), and options on the
command line win over it. The setup page writes `position` into it:

```json
{ "gain": 40, "position": { "lat": 52.5163, "lon": 13.3777 } }
```

The page is plain HTTP. Browsers only allow system notifications on HTTPS pages or on
`localhost`, so for those, open it on the same machine or put it behind a reverse proxy
with HTTPS (`--bind 127.0.0.1`).

### Receiver position

Where the antenna is, to about 100 m. On the first start every page leads to the setup
page, which finds it from an address (OpenStreetMap's Nominatim, asked by your browser) or
takes coordinates or a map link. To correct it later: the receiver's panel on the map
(tap the receiver), "Change". `--position` sets it for one run instead, and then the page
can't change it.

It's used for:

- **Decoding positions**: the reference point that picks which CPR zone an aircraft is in,
  so a single ADS-B message is enough (local CPR decoding). Aircraft on the ground need it
  even for message pairs: a pair leaves four possible positions, 90° apart.
- **The tracker's range check**: positions beyond the radio horizon are thrown out.
- **Distances and directions**, the receiver and its range rings on the map.
- **Coverage**: how low above the horizon the antenna hears in each direction. Elevation
  angles of a few degrees are where a position off by a few km shows, so be exact here
  (~100 m).
- **/weather**, for aircraft that don't broadcast an ADS-B position: it looks up the magnetic
  declination (and the geoid) there.

The page data carries it to every browser, and the map shows it, so mind that before
sharing screenshots or running the app where others can see it.

## Development

The project is Bun-native: [Bun](https://bun.sh) installs, runs, tests and builds it.
Node.js and npm are not needed.

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `bun install`          | Install the dependencies                                |
| `bun run dev`          | Dev server (Vite, running on Bun); options as above     |
| `bun test`             | Tests (Bun's test runner)                               |
| `bun run check`        | Type check (`svelte-check`)                             |
| `bun run lint`         | Prettier and ESLint                                     |
| `bun run format`       | Format everything with Prettier                         |
| `bun run build:binary` | The `lab1090` program for this machine: `build/lab1090` |
| `bun run build:arm64`  | The same for a 64-bit Raspberry Pi (Linux arm64)        |

Options go after the command. With the dongle on the Pi, run `rtl_tcp -a 0.0.0.0` there
and `bun run dev --rtl-tcp pi` here. The dev server shares the config file with the
program, so the position set up once is there for both.

Nothing in the sky (at night, say)? Replay the recording instead, at its original pace,
either as messages or turned back into samples for the demodulator:

```sh
bun tools/replay.ts --loop                     # serves it on 127.0.0.1:30105
bun run dev --connect 127.0.0.1:30105

bun tools/modulate.ts --seconds 120 --sigma 0.0095 --out sky.u8
bun run dev --samples sky.u8
```

The tests run against a 10-minute recording from the receiver
([fixtures/](fixtures/README.md); there's an hour too, for the experiments, and to replay)
and reference values from pyModeS, which are committed:
Python is only needed to regenerate them ([tools/](tools/README.md)).

## Deployment

`bun run build:binary` (or `build:arm64` for a Pi) makes one file, `build/lab1090`, with
the Bun runtime and the web page inside: copy it to the machine and run it. It runs on
64-bit Linux with glibc (Raspberry Pi OS, Debian, Ubuntu); the only other thing it needs
is the rtl-sdr package, for a dongle on that machine. The Pi's is ~116 MB. On a Pi 5 it
uses about 7 % of one core (`rtl_sdr` included) and 55 MB of memory.
