/**
 * The server's settings: command-line flags over a config file over defaults. Pure: no
 * process, no file system (live-settings.ts reads argv and the file and writes it back).
 *
 *   lab1090 --connect pi:30005 --position 52.52,13.40 --port 8080
 *
 * The config file (JSON, ~/.config/lab1090/config.json) takes the same keys as the flags,
 * except `config` itself. The setup page (/setup) writes `position` into it; the others are
 * there for whoever prefers a file to flags, e.g. a service:
 *
 *   { "connect": "pi:30005", "position": { "lat": 52.52, "lon": 13.4 } }
 *
 * The position has no default: without one, every page sends you to /setup.
 */
import { parseArgs } from 'node:util';
import { parseLatLon } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** Where the Beast feed comes from: readsb, dump1090 or `tools/replay.ts`. */
export interface Endpoint {
	host: string;
	port: number;
}

export interface Settings {
	connect: Endpoint;
	/** The antenna; null until set (the app then shows /setup). */
	position: LatLon | null;
	/** Where the position came from: a flag can't be changed from the setup page. */
	positionFrom: 'flag' | 'file' | null;
	/** The web server's port. */
	port: number;
	/** Listen on this address only; null: all of them. */
	bind: string | null;
}

/** readsb and dump1090 serve Beast on 30005 by default. */
export const BEAST_PORT = 30005;
/** 1090 MHz is Mode S's frequency, and the port is free on most machines (not below 1024). */
export const DEFAULT_PORT = 1090;
/** readsb on the same machine. Later: the RTL-SDR itself. */
const DEFAULT_CONNECT: Endpoint = { host: 'localhost', port: BEAST_PORT };

export const USAGE = `lab1090: live Mode S and ADS-B from your own receiver, decoded in your browser.

Usage: lab1090 [options]

  --connect <host[:port]>   readsb's or dump1090's Beast output
                            (default: localhost:${BEAST_PORT})
  --position <lat,lon>      the antenna, in decimal degrees, e.g. 52.5163,13.3777
                            (default: from the config file; without one, the web page asks)
  --port <port>             the web page's port (default: ${DEFAULT_PORT})
  --bind <address>          listen on this address only, e.g. 127.0.0.1 behind a reverse
                            proxy (default: every address of this machine)
  --config <file>           the config file (default: ~/.config/lab1090/config.json)
  -h, --help                show this text

The config file takes the same settings as JSON, e.g.
  { "connect": "pi:30005", "position": { "lat": 52.5163, "lon": 13.3777 } }
Options on the command line win over the file.`;

/** A mistake in the flags or the config file: the message is for the user, no stack trace. */
export class SettingsError extends Error {}

/** What the command line said; anything left out comes from the file or the defaults. */
export interface Flags {
	help: boolean;
	config: string | null;
	connect?: Endpoint;
	position?: LatLon;
	port?: number;
	bind?: string;
}

export function parseFlags(args: string[]): Flags {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			strict: true,
			allowPositionals: false,
			options: {
				connect: { type: 'string' },
				position: { type: 'string' },
				port: { type: 'string' },
				bind: { type: 'string' },
				config: { type: 'string' },
				help: { type: 'boolean', short: 'h' }
			}
		}).values;
	} catch (e) {
		// parseArgs: "Unknown option '--conect'", "Option '--port <value>' argument missing", …
		throw new SettingsError((e as Error).message);
	}
	const flags: Flags = { help: parsed.help ?? false, config: parsed.config ?? null };
	if (parsed.connect !== undefined)
		flags.connect = field('--connect', parseEndpoint, parsed.connect);
	if (parsed.position !== undefined)
		flags.position = field('--position', parseLatLon, parsed.position);
	if (parsed.port !== undefined) flags.port = field('--port', parsePort, parsed.port);
	if (parsed.bind !== undefined) flags.bind = field('--bind', parseBind, parsed.bind);
	return flags;
}

/** The config file's contents; every key optional. */
export interface ConfigFile {
	connect?: string;
	position?: LatLon;
	port?: number;
	bind?: string;
}

const CONFIG_KEYS = ['connect', 'position', 'port', 'bind'];

/** Check a config file's text. `path` is only for the messages. */
export function parseConfig(text: string, path: string): ConfigFile {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		throw new SettingsError(`${path}: not valid JSON (${(e as Error).message})`);
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json)) {
		throw new SettingsError(`${path}: expected an object, like { "connect": "pi:30005" }`);
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
	return config;
}

/** Flags over the file over the defaults. */
export function resolveSettings(flags: Flags, file: ConfigFile): Settings {
	const position = flags.position ?? file.position ?? null;
	return {
		connect: flags.connect ?? (file.connect ? parseEndpoint(file.connect) : DEFAULT_CONNECT),
		position,
		positionFrom: flags.position ? 'flag' : file.position ? 'file' : null,
		port: flags.port ?? file.port ?? DEFAULT_PORT,
		bind: flags.bind ?? file.bind ?? null
	};
}

/** The file with a new position, everything else kept. Six decimals: ~0.1 m. */
export function withPosition(file: ConfigFile, position: LatLon): ConfigFile {
	const round = (x: number) => Math.round(x * 1e6) / 1e6;
	return { ...file, position: { lat: round(position.lat), lon: round(position.lon) } };
}

/** "host", "host:port", "[ipv6]" or "[ipv6]:port"; the port defaults to Beast's 30005. */
export function parseEndpoint(value: string): Endpoint {
	const match = /^(?:\[([^\]]+)\]|([^:[\]]+))(?::(\d+))?$/.exec(value.trim());
	if (!match) {
		throw new Error(
			`expected host or host:port, e.g. "pi:30005" or "192.168.1.20", got "${value}"`
		);
	}
	return {
		host: match[1] ?? match[2],
		port: match[3] === undefined ? BEAST_PORT : parsePort(match[3])
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

function parsePort(value: string): number {
	const port = Number(value);
	if (!/^\d+$/.test(value.trim()) || port < 1 || port > 65535) {
		throw new Error(`expected a TCP port (1–65535), got "${value}"`);
	}
	return port;
}

function parseBind(value: string): string {
	if (!value.trim()) throw new Error('expected an address, e.g. 127.0.0.1');
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
