# lab1090

A learning tool for what aircraft transmit on 1090 MHz, where transponders answer radars and
broadcast ADS-B. lab1090 decodes live Mode S and ADS-B from an RTL-SDR, from the raw radio
samples up, and shows it in the browser: a tracker map, every frame as it arrives, what
radars read from aircraft (Comm-B), the weather the aircraft measure, and the receiver
itself. Every value comes with an explanation of what it is, how it was worked out and what
it means, using the field names from the specifications (ICAO Doc 9871, RTCA DO-260B), so it
can be read alongside the literature. The name follows dump1090 and tar1090, with "lab" for
what this one is: a place to learn how it works.

lab1090 keeps nothing: aircraft, messages and statistics live in memory and start over when
it restarts. All it saves are its settings (a config file) and a few display preferences in
the browser.

> **Made with and for an RTL-SDR.** Developed with an RTL-SDR Blog v3 (R820T tuner) on a
> Raspberry Pi 5. lab1090 reads RTL2832U dongles (through `rtl_sdr`), and its gain advice
> knows the R820T and R828D tuners (RTL-SDR Blog v3 and v4); how well other dongles do is
> untested. Other SDRs can feed it through readsb or dump1090 (`--connect`, below).

## Setup

On the machine the RTL-SDR is plugged into (64-bit Linux, e.g. Raspberry Pi OS):

```sh
sudo apt install rtl-sdr   # rtl_sdr, which lab1090 reads the dongle with
./lab1090
```

Then open the address it prints (port 1090) in a browser, on any device in your network.
The first time, the page asks where the antenna is. Every browser that opens the page sees
that position, so mind it before sharing screenshots.

The dongle can also be on another machine:

- **rtl_tcp** there (`rtl_tcp -a 0.0.0.0`, from the same package), then
  `lab1090 --rtl-tcp <host>`. It sends the raw samples, 38 Mbit/s: fine over Ethernet, too
  much for weak Wi-Fi. While it waits for a client it ignores a plain kill: stop it with
  `pkill -9 rtl_tcp`.
- **lab1090** there with `--beast-out 30005`, or **readsb or dump1090**, then
  `lab1090 --connect <host>`: their Beast output, already demodulated, about 20 KB/s. A
  receiver that feeds a flight tracking site can be used as it is.

`lab1090 --help` lists every option (gain, which dongle, port, …); the config file takes the
same settings. The page is plain HTTP: browsers only show system notifications (for alerts)
on HTTPS or `localhost`, so for those put it behind a reverse proxy (`--bind 127.0.0.1`).

## Development

[Bun](https://bun.sh) installs, runs, tests and builds it; Node.js and npm aren't needed.

```sh
bun install
bun run dev      # the dev server; lab1090's options go after it, e.g. --rtl-tcp pi
bun test
bun run check    # type check
bun run lint     # formatting and ESLint (bun run format fixes the formatting)
```

Receiver on another machine? Run lab1090 there with `--beast-out 30005` and develop with
`bun run dev --connect <host>`. Nothing in the sky? `bun tools/replay.ts --loop` plays the recorded capture on
127.0.0.1:30105, for `bun run dev --connect 127.0.0.1:30105`. The tests run on recordings
and on reference values from pyModeS: [fixtures/](fixtures/README.md) and
[tools/](tools/README.md) say more.

## Deployment

```sh
bun run build:binary   # build/lab1090, for this machine
bun run build:arm64    # build/lab1090, for a 64-bit Raspberry Pi
```

One file with the Bun runtime and the web page inside: copy it to the machine and run it. It
needs 64-bit Linux with glibc and, for a dongle on that machine, the rtl-sdr package.

## Attribution

An independent learning project, not affiliated with any of the projects below. It stands on
their shoulders:

- **readsb** ([wiedehopf/readsb](https://github.com/wiedehopf/readsb): Matthias Wirth,
  Michael Wolf; from dump1090-fa by Oliver Jowett, from dump1090 by Salvatore Sanfilippo):
  the reference lab1090's demodulator was compared with and tuned against, and the source of
  a few of its tricks. Code that follows readsb's says so at the top of its file.
- **Junzi Sun**: [pyModeS](https://github.com/junzis/pyModeS), which lab1090's decoders are
  tested against, and [The 1090 MHz Riddle](https://mode-s.org/1090mhz/), which explains
  what they decode.

The lab1090 server never goes online; your browser fetches the rest itself:
[OpenFreeMap](https://openfreemap.org/) map tiles (© OpenStreetMap contributors), drawn with
[MapLibre GL JS](https://maplibre.org/); hillshading and terrain from the
[Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/); aircraft, airlines and
routes from [adsbdb](https://www.adsbdb.com/) by Jack Wills (aircraft data from PlaneBase,
routes collected by David Taylor and Jim Mason); photos from
[airport-data.com](https://www.airport-data.com/); address search from
[Nominatim](https://nominatim.org/). Flags: [flag-icons](https://github.com/lipis/flag-icons)
(MIT).

## License

[GPL](LICENSE), version 3 or (at your option) any later version. You may use, change and
pass on lab1090; whoever passes it on, changed or not, as source or as the binary, passes on
its source too, under the same license.
