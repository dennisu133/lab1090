# Receiver: Raspberry Pi

The Pi runs lab1090 with the RTL-SDR plugged in: it reads the dongle (through `rtl_sdr`),
demodulates, and serves the web page. Or, while developing on another machine, it only
serves the dongle's raw samples over the network (`rtl_tcp`).

|          |                                                              |
| -------- | ------------------------------------------------------------ |
| Hardware | Raspberry Pi 5, RTL-SDR Blog v3 (R820T tuner)                |
| OS       | Raspberry Pi OS Lite (Debian 13 trixie, arm64)               |
| Packages | `rtl-sdr` (`rtl_sdr`, `rtl_tcp`, `rtl_test`, the udev rules) |

## Setup

```bash
sudo apt install rtl-sdr
```

The DVB-T TV drivers in the kernel claim the dongle as soon as it's plugged in. Blacklist
them, then unplug the dongle and plug it in again (or reboot):

```bash
printf 'blacklist %s\n' dvb_usb_rtl28xxu rtl2832 rtl2832_sdr | sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf
```

Check: `rtl_test -t` finds the dongle (its "No E4000 tuner found" is fine: it only looks
for that one tuner).

## Running lab1090 on the Pi

From the PC: `bun run build:arm64`, then copy `build/lab1090` over and run it:

```bash
./lab1090
```

## Developing on the PC with the dongle on the Pi

On the Pi, serve the samples (it keeps listening after a client leaves):

```bash
rtl_tcp -a 0.0.0.0
```

On the PC: `bun run dev --rtl-tcp pi`. lab1090 sets the frequency, sample rate and gain
itself. Stop rtl_tcp with `pkill -9 rtl_tcp`: while it waits for a client it ignores a
plain `pkill`, and holds on to the dongle.

## Checks

- "the RTL-SDR is in use by another program": something else has it open. `pgrep -a
'rtl_|readsb|dump1090'` shows what.
- Live traffic in words: `rtl_adsb` (the rtl-sdr package's own little decoder) prints raw
  messages as hex, if nothing else holds the dongle.
