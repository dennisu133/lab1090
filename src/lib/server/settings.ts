/**
 * The server's settings: command-line flags over a config file over defaults. Pure: no
 * process, no file system (live-settings.ts reads argv and the file and writes it back).
 *
 *   lab1090 --gain 40 --position 52.52,13.40 --port 8080
 *
 * The config file (JSON, ~/.config/lab1090/config.json) takes the same keys as the flags,
 * except `config` and `samples`. The setup page (/setup) writes `position` into it; the
 * others are there for whoever prefers a file to flags, e.g. a service:
 *
 *   { "gain": 40, "position": { "lat": 52.52, "lon": 13.4 } }
 *
 * Where the messages come from (Source): the RTL-SDR on this machine by default, one on
 * another machine through rtl_tcp, a Beast feed from readsb or dump1090, or a recording of
 * samples. One of them: a flag for one wins over the file's, and two flags for different
 * ones are a mistake.
 *
 * The position has no default: without one, every page sends you to /setup.
 *
 * `--beast-out` serves what this receiver hears as Beast (beast/server.ts), for another
 * lab1090 or readsb to `--connect` to, on every address of the machine: `--bind` is the web
 * page's alone.
 *
 * `--record` saves the RTL-SDR's samples for a while (record/recorder.ts). A thing done once,
 * so the command line's only, like `--samples`.
 */
import { parseArgs } from 'node:util';
// Only the version is bundled: Vite splits JSON into named exports and drops the rest.
import { version } from '../../../package.json';
import { parseLatLon } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** A host and port to connect to. */
export interface Endpoint {
	host: string;
	port: number;
}

/** Where the messages come from. */
export type Source =
	/** An RTL-SDR on this machine, through the `rtl_sdr` program; we demodulate. */
	| { kind: 'rtlsdr'; device: string; gain: number }
	/** An RTL-SDR on another machine, through its `rtl_tcp` server; we demodulate. */
	| { kind: 'rtl-tcp'; endpoint: Endpoint; gain: number }
	/** Demodulated elsewhere: Beast from another lab1090, readsb, dump1090, tools/replay.ts. */
	| { kind: 'beast'; endpoint: Endpoint }
	/** Samples recorded with rtl_sdr, played at their own pace. */
	| { kind: 'samples'; file: string };

export interface Settings {
	source: Source;
	/** The antenna; null until set (the app then shows /setup). */
	position: LatLon | null;
	/** Where the position came from: a flag can't be changed from the setup page. */
	positionFrom: 'flag' | 'file' | null;
	/** The web server's port. */
	port: number;
	/** Listen on this address only; null: all of them. */
	bind: string | null;
	/** Serve the messages as Beast on this port; null: don't. */
	beastOut: number | null;
	/** Record the samples; null: don't. */
	record: RecordSettings | null;
}

export interface RecordSettings {
	/** How long, ms of samples. */
	durationMs: number;
	/** Goes into the file's name and metadata: letters, digits, - and _. */
	label: string | null;
}

/** readsb and dump1090 serve Beast on 30005 by default (lab1090 only with --beast-out). */
export const BEAST_PORT = 30005;
/** rtl_tcp's default port. */
export const RTL_TCP_PORT = 1234;
/** 1090 MHz is Mode S's frequency, and the port is free on most machines (not below 1024). */
export const DEFAULT_PORT = 1090;
/**
 * The R820T tuner's highest gain step (most dongles have that tuner): faint, distant aircraft
 * need it. Near an airport, strong signals can overload it; then less helps.
 */
export const DEFAULT_GAIN = 49.6;
/** --record's length: like the recordings the demodulator was tuned on (~470 MB). */
export const DEFAULT_RECORD_MS = 5 * 60_000;
/** lab1090's version: package.json's, the one place it is kept. */
export const VERSION: string = version;

/** The first RTL-SDR found. */
const DEFAULT_DEVICE = '0';

export const USAGE = `lab1090 ${VERSION}: live Mode S and ADS-B from your own receiver, decoded in your browser.

Usage: lab1090 [options]

Where the messages come from (default: the first RTL-SDR on this machine):
  --device <index|serial>   which RTL-SDR, if there are several (default: ${DEFAULT_DEVICE}). lab1090
                            runs rtl_sdr to read it: apt install rtl-sdr
  --gain <dB>               the RTL-SDR's gain (default: ${DEFAULT_GAIN}, the most); less if strong
                            signals near an airport overload it
  --rtl-tcp <host[:port]>   an RTL-SDR on another machine, through rtl_tcp there
                            (port ${RTL_TCP_PORT} by default)
  --connect <host[:port]>   messages demodulated by another lab1090 (its --beast-out),
                            readsb or dump1090: their Beast output (port ${BEAST_PORT} by default)
  --samples <file>          a recording made with rtl_sdr -f 1090M -s 2.4M, played at its
                            own pace

Recording the samples, to tune lab1090's demodulator to other dongles and skies:
  --record                  save the RTL-SDR's raw samples to a file in the current
                            directory, lab1090-<date>T<time>[-<label>].sigmf.zst, while
                            the page goes on as usual: 5 minutes are about 470 MB. A SigMF
                            archive, compressed (zstd -d, then tar x, gives the samples as
                            rtl_sdr writes them). It doesn't say where it was made, but the
                            aircraft in it show roughly where, and when
  --record-for <time>       how long, e.g. 90s, 10m (default: 5m)
  --label <name>            a word for the file name, e.g. --label balcony

Passing them on:
  --beast-out <port>        serve every message as Beast on this port, on every address of
                            this machine, like readsb's --net-bo-port (usually ${BEAST_PORT}): for
                            another lab1090's --connect, tar1090 or a feeder (default: off)

The web page:
  --position <lat,lon>      the antenna, in decimal degrees, e.g. 52.5163,13.3777
                            (default: from the config file; without one, the web page asks)
  --port <port>             the web page's port (default: ${DEFAULT_PORT})
  --bind <address>          listen on this address only, e.g. 127.0.0.1 behind a reverse
                            proxy (default: every address of this machine)
  --config <file>           the config file (default: ~/.config/lab1090/config.json,
                            or $XDG_CONFIG_HOME/lab1090/config.json if that is set)
  -h, --help                show this text
  --version                 show lab1090's version

The config file takes the same settings as JSON (not --samples or --record), e.g.
  { "gain": 40, "position": { "lat": 52.5163, "lon": 13.3777 } }
Options on the command line win over the file.`;

/** A mistake in the flags or the config file: the message is for the user, no stack trace. */
export class SettingsError extends Error {}

/** What the command line said; anything left out comes from the file or the defaults. */
export interface Flags {
	help: boolean;
	version: boolean;
	config: string | null;
	device?: string;
	gain?: number;
	rtlTcp?: Endpoint;
	connect?: Endpoint;
	samples?: string;
	position?: LatLon;
	port?: number;
	bind?: string;
	beastOut?: number;
	record?: boolean;
	recordFor?: number;
	label?: string;
}

export function parseFlags(args: string[]): Flags {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			strict: true,
			allowPositionals: false,
			options: {
				device: { type: 'string' },
				gain: { type: 'string' },
				'rtl-tcp': { type: 'string' },
				connect: { type: 'string' },
				samples: { type: 'string' },
				position: { type: 'string' },
				port: { type: 'string' },
				bind: { type: 'string' },
				'beast-out': { type: 'string' },
				record: { type: 'boolean' },
				'record-for': { type: 'string' },
				label: { type: 'string' },
				config: { type: 'string' },
				help: { type: 'boolean', short: 'h' },
				version: { type: 'boolean' }
			}
		}).values;
	} catch (e) {
		// parseArgs: "Unknown option '--conect'", "Option '--port <value>' argument missing", …
		throw new SettingsError((e as Error).message);
	}
	const flags: Flags = {
		help: parsed.help ?? false,
		version: parsed.version ?? false,
		config: parsed.config ?? null
	};
	if (parsed.device !== undefined) flags.device = field('--device', parseDevice, parsed.device);
	if (parsed.gain !== undefined) flags.gain = field('--gain', parseGain, parsed.gain);
	if (parsed['rtl-tcp'] !== undefined) {
		flags.rtlTcp = field('--rtl-tcp', (v) => parseEndpoint(v, RTL_TCP_PORT), parsed['rtl-tcp']);
	}
	if (parsed.connect !== undefined)
		flags.connect = field('--connect', parseEndpoint, parsed.connect);
	if (parsed.samples !== undefined) {
		flags.samples = field('--samples', (v) => nonEmpty(v, 'a file'), parsed.samples);
	}
	const sources = [
		flags.device !== undefined && '--device',
		flags.rtlTcp && '--rtl-tcp',
		flags.connect && '--connect',
		flags.samples !== undefined && '--samples'
	].filter(Boolean);
	if (sources.length > 1) {
		throw new SettingsError(`${sources.join(' and ')} are different sources: pick one`);
	}
	if (parsed.position !== undefined)
		flags.position = field('--position', parseLatLon, parsed.position);
	if (parsed.port !== undefined) flags.port = field('--port', parsePort, parsed.port);
	if (parsed.bind !== undefined) flags.bind = field('--bind', parseBind, parsed.bind);
	if (parsed['beast-out'] !== undefined) {
		flags.beastOut = field('--beast-out', parsePort, parsed['beast-out']);
	}
	if (parsed.record) flags.record = true;
	if (parsed['record-for'] !== undefined) {
		flags.recordFor = field('--record-for', parseDuration, parsed['record-for']);
	}
	if (parsed.label !== undefined) flags.label = field('--label', parseLabel, parsed.label);
	for (const [name, given] of [
		['--record-for', flags.recordFor !== undefined],
		['--label', flags.label !== undefined]
	] as const) {
		if (given && !flags.record) throw new SettingsError(`${name}: only with --record`);
	}
	return flags;
}

/** The config file's contents; every key optional. */
export interface ConfigFile {
	device?: string;
	gain?: number;
	'rtl-tcp'?: string;
	connect?: string;
	position?: LatLon;
	port?: number;
	bind?: string;
	'beast-out'?: number;
}

const CONFIG_KEYS = [
	'device',
	'gain',
	'rtl-tcp',
	'connect',
	'position',
	'port',
	'bind',
	'beast-out'
];

/** Check a config file's text. `path` is only for the messages. */
export function parseConfig(text: string, path: string): ConfigFile {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		throw new SettingsError(`${path}: not valid JSON (${(e as Error).message})`);
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json)) {
		throw new SettingsError(`${path}: expected an object, like { "gain": 40 }`);
	}
	const raw = json as Record<string, unknown>;
	const unknown = Object.keys(raw).filter((k) => !CONFIG_KEYS.includes(k));
	if (unknown.length > 0) {
		throw new SettingsError(
			`${path}: unknown setting ${unknown.map((k) => `"${k}"`).join(', ')} (known: ${CONFIG_KEYS.join(', ')})`
		);
	}
	const at = (key: string) => `${path}: "${key}"`;
	const config: ConfigFile = {};
	if (raw.device !== undefined) {
		config.device = field(at('device'), (v) => parseDevice(String(v)), raw.device);
	}
	if (raw.gain !== undefined) {
		config.gain = field(at('gain'), (v) => parseGain(String(v)), raw.gain);
	}
	if (raw['rtl-tcp'] !== undefined) {
		config['rtl-tcp'] = field(
			at('rtl-tcp'),
			(v) => (parseEndpoint(asString(v), RTL_TCP_PORT), v as string),
			raw['rtl-tcp']
		);
	}
	if (raw.connect !== undefined) {
		config.connect = field(
			at('connect'),
			(v) => (parseEndpoint(asString(v)), v as string),
			raw.connect
		);
	}
	if (raw.position !== undefined)
		config.position = field(at('position'), checkPosition, raw.position);
	if (raw.port !== undefined)
		config.port = field(at('port'), (v) => parsePort(String(v)), raw.port);
	if (raw.bind !== undefined)
		config.bind = field(at('bind'), (v) => parseBind(asString(v)), raw.bind);
	if (raw['beast-out'] !== undefined) {
		config['beast-out'] = field(at('beast-out'), (v) => parsePort(String(v)), raw['beast-out']);
	}
	const sources = (['device', 'rtl-tcp', 'connect'] as const).filter((k) => k in config);
	if (sources.length > 1) {
		throw new SettingsError(
			`${path}: ${sources.map((k) => `"${k}"`).join(' and ')} are different sources: pick one`
		);
	}
	return config;
}

/** Flags over the file over the defaults. */
export function resolveSettings(flags: Flags, file: ConfigFile): Settings {
	const position = flags.position ?? file.position ?? null;
	return {
		source: resolveSource(flags, file),
		position,
		positionFrom: flags.position ? 'flag' : file.position ? 'file' : null,
		port: flags.port ?? file.port ?? DEFAULT_PORT,
		bind: flags.bind ?? file.bind ?? null,
		beastOut: flags.beastOut ?? file['beast-out'] ?? null,
		record: flags.record
			? { durationMs: flags.recordFor ?? DEFAULT_RECORD_MS, label: flags.label ?? null }
			: null
	};
}

/**
 * A source named by a flag wins; otherwise the file's; otherwise the RTL-SDR. The gain goes
 * with an RTL-SDR, wherever each came from (`--gain 40` with a file naming a device).
 */
function resolveSource(flags: Flags, file: ConfigFile): Source {
	const gain = flags.gain ?? file.gain;
	let source: Source;
	if (flags.connect) source = { kind: 'beast', endpoint: flags.connect };
	else if (flags.samples !== undefined) source = { kind: 'samples', file: flags.samples };
	else if (flags.rtlTcp)
		source = { kind: 'rtl-tcp', endpoint: flags.rtlTcp, gain: gain ?? DEFAULT_GAIN };
	else if (flags.device === undefined && file.connect)
		source = { kind: 'beast', endpoint: parseEndpoint(file.connect) };
	else if (flags.device === undefined && file['rtl-tcp']) {
		const endpoint = parseEndpoint(file['rtl-tcp'], RTL_TCP_PORT);
		source = { kind: 'rtl-tcp', endpoint, gain: gain ?? DEFAULT_GAIN };
	} else {
		const device = flags.device ?? file.device ?? DEFAULT_DEVICE;
		source = { kind: 'rtlsdr', device, gain: gain ?? DEFAULT_GAIN };
	}
	if (flags.gain !== undefined && (source.kind === 'beast' || source.kind === 'samples')) {
		throw new SettingsError(
			'--gain: only an RTL-SDR has a gain (the source here is a Beast feed or a recording)'
		);
	}
	if (flags.record && (source.kind === 'beast' || source.kind === 'samples')) {
		throw new SettingsError(
			source.kind === 'beast'
				? '--record: a Beast feed brings messages, not samples: record where the RTL-SDR is'
				: '--record: this is a recording already'
		);
	}
	return source;
}

/** The source for messages and the status bar: "RTL-SDR 0", "pi:1234 (rtl_tcp)", "pi:30005". */
export function describeSource(source: Source): string {
	switch (source.kind) {
		case 'rtlsdr':
			return `RTL-SDR ${source.device}`;
		case 'rtl-tcp':
			return `${formatEndpoint(source.endpoint)} (rtl_tcp)`;
		case 'beast':
			return formatEndpoint(source.endpoint);
		case 'samples':
			return source.file;
	}
}

/** The file with a new position, everything else kept. Six decimals: ~0.1 m. */
export function withPosition(file: ConfigFile, position: LatLon): ConfigFile {
	const round = (x: number) => Math.round(x * 1e6) / 1e6;
	return { ...file, position: { lat: round(position.lat), lon: round(position.lon) } };
}

/** "host", "host:port", "[ipv6]" or "[ipv6]:port"; the port defaults to Beast's 30005. */
export function parseEndpoint(value: string, defaultPort = BEAST_PORT): Endpoint {
	const match = /^(?:\[([^\]]+)\]|([^:[\]]+))(?::(\d+))?$/.exec(value.trim());
	if (!match) {
		throw new Error(
			`expected host or host:port, e.g. "pi:30005" or "192.168.1.20", got "${value}"`
		);
	}
	return {
		host: match[1] ?? match[2],
		port: match[3] === undefined ? defaultPort : parsePort(match[3])
	};
}

/** "host:port" for messages and the status bar; IPv6 addresses in brackets. */
export function formatEndpoint({ host, port }: Endpoint): string {
	return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/** The default config file: $XDG_CONFIG_HOME/lab1090/config.json, else ~/.config/…. */
export function defaultConfigPath(env: Record<string, string | undefined>, home: string): string {
	const base = env.XDG_CONFIG_HOME || `${home}/.config`;
	return `${base}/lab1090/config.json`;
}

/** "90s", "10m", "1.5h": a length of time, in ms. At least a second. */
function parseDuration(value: string): number {
	const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(value.trim());
	const unit = { s: 1000, m: 60_000, h: 3_600_000 };
	const ms = match ? Number(match[1]) * unit[match[2] as keyof typeof unit] : 0;
	if (ms < 1000)
		throw new Error(`expected a time with its unit, e.g. 90s, 10m or 1h, got "${value}"`);
	return ms;
}

/** Letters, digits, - and _: it goes into a file name, and SigMF's names avoid the rest. */
function parseLabel(value: string): string {
	if (!/^[A-Za-z0-9_-]{1,40}$/.test(value.trim())) {
		throw new Error(`expected up to 40 letters, digits, - or _, e.g. balcony, got "${value}"`);
	}
	return value.trim();
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!/^\d+$/.test(value.trim()) || port < 1 || port > 65535) {
		throw new Error(`expected a TCP port (1–65535), got "${value}"`);
	}
	return port;
}

function parseBind(value: string): string {
	return nonEmpty(value, 'an address, e.g. 127.0.0.1');
}

/** An index (0, 1, …) or a serial number: rtl_sdr takes either. */
function parseDevice(value: string): string {
	return nonEmpty(value, 'an index (0 for the first RTL-SDR) or a serial number');
}

/**
 * dB, as the dongle's tuner has it. It only has certain steps (the R820T: 0.0 to 49.6 in 29
 * steps) and picks the nearest. 0 isn't allowed: rtl_sdr takes it as "the tuner's own
 * automatic gain", which follows the noise and suits broadcast reception, not short pulses.
 */
function parseGain(value: string): number {
	const gain = Number(value);
	if (!/^\d+(\.\d+)?$/.test(value.trim()) || gain <= 0 || gain > 60) {
		throw new Error(`expected a gain in dB above 0, e.g. 49.6 or 40, got "${value}"`);
	}
	return gain;
}

function nonEmpty(value: string, what: string): string {
	if (!value.trim()) throw new Error(`expected ${what}`);
	return value.trim();
}

function checkPosition(value: unknown): LatLon {
	const { lat, lon } = (value ?? {}) as Record<string, unknown>;
	if (typeof lat !== 'number' || typeof lon !== 'number') {
		throw new Error('expected { "lat": <number>, "lon": <number> } in decimal degrees');
	}
	return parseLatLon(`${lat},${lon}`);
}

function asString(value: unknown): string {
	if (typeof value !== 'string') throw new Error('expected a string');
	return value;
}

/** Run a parser; its error message gets the flag's or key's name in front. */
function field<T, V>(name: string, parse: (value: V) => T, value: V): T {
	try {
		return parse(value);
	} catch (e) {
		throw new SettingsError(`${name}: ${(e as Error).message}`);
	}
}
