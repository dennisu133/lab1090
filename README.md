# lab1090

A tool for visualizing and learning about what aircraft transmit on 1090 MHz, where transponders answer radars and
broadcast [ADS-B](https://en.wikipedia.org/wiki/Automatic_Dependent_Surveillance%E2%80%93Broadcast). lab1090 decodes live [Mode S](https://en.wikipedia.org/wiki/Aviation_transponder_interrogation_modes) and ADS-B from a [software defined radio (SDR)](https://en.wikipedia.org/wiki/Software-defined_radio) and shows it in the browser.

Aircraft data lives purely in memory (unless `--record` is used). The only persistent storage is a config file and a few display preferences in the browser.

> **Made with and for an RTL-SDR.** Developed with an RTL-SDR Blog v3 (R820T tuner) on a Raspberry Pi 5. lab1090 reads RTL2832U dongles (through `rtl_sdr`), and its gain advice knows the R820T and R828D tuners (RTL-SDR Blog v3 and v4); how well other dongles do is untested. Other SDRs can feed it through readsb or dump1090 (`--connect`, below).

## Setup

On the machine the RTL-SDR is plugged into (**requires 64-bit Linux**, e.g. Raspberry Pi OS):

```sh
sudo apt install rtl-sdr   # drivers and permissions for the dongle
./lab1090
```

By default a web server will start on port 1090. The first run will ask for your antenna's position. This is required to check and decode aircraft positions, and for distances, coverage and weather. Be mindful that the position is drawn on the map and visible to every visitor.

The dongle can also be on another machine:

- **rtl_tcp** there (`rtl_tcp -a 0.0.0.0`, from the same package), then
  `./lab1090 --rtl-tcp <host>`. It sends the raw samples, 38 Mbit/s: fine over Ethernet, too
  much for weak Wi-Fi. While it waits for a client it ignores a plain kill: stop it with
  `pkill -9 rtl_tcp`.
- **lab1090** there with `--beast-out 30005`, or **readsb or dump1090**, then
  `./lab1090 --connect <host>`: their Beast output, already demodulated, about 20 KB/s. A
  receiver that feeds a flight tracking site can be used as it is.

Use `./lab1090 --help` for more information.

## Development

[Bun](https://bun.sh) installs, runs, tests and builds it; Node.js and npm aren't needed.

```sh
bun install
bun run dev      # the dev server; lab1090's options go after it, e.g. --rtl-tcp <host>
bun test
bun run check    # type check
bun run lint     # formatting and ESLint (bun run format fixes the formatting)
```

Receiver on another machine? Run lab1090 there with `--beast-out 30005` and develop with
`bun run dev --connect <host>`.

Nothing in the sky? `bun tools/replay.ts --loop` plays the recorded capture on
127.0.0.1:30105, for `bun run dev --connect 127.0.0.1:30105`. The tests run on recordings
and on reference values from pyModeS, weather balloons and NOAA: [oracle/](oracle/README.md)
and [tools/](tools/README.md) say more.

## Deployment

```sh
bun run build:binary   # for the machine you build on
bun run build:arm64    # for 64-bit ARM Linux (e.g. a Raspberry Pi)
```

The binary is written to `build/lab1090`.

## Attribution

lab1090 owes a lot to the projects below and the people behind them. It is an independent project and not affiliated with them.

- **readsb** ([wiedehopf/readsb](https://github.com/wiedehopf/readsb): Matthias Wirth,
  Michael Wolf; from dump1090-fa by Oliver Jowett, from dump1090 by Salvatore Sanfilippo):
  the reference lab1090's demodulator was compared with and tuned against, and the source of
  a few of its tricks. Code that follows readsb's says so at the top of its file.
- **Junzi Sun**: [pyModeS](https://github.com/junzis/pyModeS), which lab1090's decoders are
  tested against, and [The 1090 MHz Riddle](https://mode-s.org/1090mhz/), which explains
  what they decode.

The lab1090 server never goes online; your browser fetches the rest itself:

- Map tiles: [OpenFreeMap](https://openfreemap.org/) (© OpenStreetMap contributors), drawn
  with [MapLibre GL JS](https://maplibre.org/)
- Hillshading and terrain: [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
- Aircraft, airlines and routes: [adsbdb](https://www.adsbdb.com/) by Jack Wills (aircraft
  data from PlaneBase, routes collected by David Taylor and Jim Mason)
- Aircraft photos: [airport-data.com](https://www.airport-data.com/)
- Address search: [Nominatim](https://nominatim.org/)

## License

[GPL](LICENSE), version 3 or (at your option) any later version. You may use, change and pass on lab1090; whoever passes it on, changed or not, as source or as the binary, passes on its source too, under the same license.
