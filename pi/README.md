# Receiver: Raspberry Pi

The Pi is a deliberately "dumb" receiver. It demodulates 1090 MHz with an RTL-SDR,
drops frames that fail the CRC check, and streams the raw frames over TCP.
All decoding and tracking happens on the PC.

|          |                                                                             |
| -------- | --------------------------------------------------------------------------- |
| Hardware | Raspberry Pi 5, RTL-SDR Blog v3 (R820T tuner)                               |
| OS       | Raspberry Pi OS Lite (Debian 13 trixie, arm64)                              |
| Decoder  | [readsb](https://github.com/wiedehopf/readsb) built from source as a `.deb` |
| Outputs  | `pi:30005` Beast binary (main feed), `pi:30002` AVR hex text (debugging)    |

Quick look at live traffic: `nc pi 30002`

## Feeding the app

All the app needs is a Beast feed it can reach over TCP: `lab1090 --connect pi` (add
`:port` if it isn't 30005), or run `lab1090` on the Pi itself, next to readsb (the default,
`localhost:30005`). readsb needs no location, no web interface and no other outputs.

If you already run readsb or dump1090 (e.g. on a Pi that feeds a flight tracking network),
it most likely serves Beast on port 30005 already: point the app at it and skip the setup
below. Check with `nc <host> 30002` (text) or by watching the app's status bar.

## Setup from scratch

DVB-T kernel drivers must be blacklisted so they don't claim the dongle
(`/etc/modprobe.d/`: `dvb_usb_rtl28xxu`, `rtl2832`, `rtl2832_sdr`).

```bash
sudo apt install git build-essential debhelper help2man pkg-config \
    librtlsdr-dev libusb-1.0-0-dev libncurses-dev zlib1g-dev libzstd-dev

git clone --depth 20 https://github.com/wiedehopf/readsb.git ~/src/readsb
cd ~/src/readsb
DEB_BUILD_PROFILES=rtlsdr dpkg-buildpackage -b -us -uc -Prtlsdr

sudo apt install ../readsb_*_arm64.deb
sudo apt-mark hold readsb            # never let apt swap in Debian's build
# from the PC: scp pi/readsb.default <user>@pi:~/
sudo install -m 644 ~/readsb.default /etc/default/readsb
sudo systemctl enable --now readsb
```

### Gotchas

- **Debian's own `readsb` package has no RTL-SDR support**, so it fails with
  `SDR type 'rtlsdr' not recognized`. That's why we build our own.
- **RTL-SDR support is opt-in via a build profile.** `-Prtlsdr` alone did _not_
  reach `debian/rules` here, so we also set `DEB_BUILD_PROFILES=rtlsdr` in the environment.
  Verify the result: `dpkg-deb -I readsb_*.deb | grep Depends` must list `librtlsdr0`.
- Upgrading later: rebuild, then `sudo apt install --allow-change-held-packages ../readsb_*.deb`.

## Config

[`readsb.default`](readsb.default) is the source of truth. Edit it here, copy it to
`/etc/default/readsb`, then run `sudo systemctl restart readsb`.

## Checks

```bash
systemctl status readsb
journalctl -u readsb -f
ss -tlnp | grep 300
```
