/**
 * This server's settings (settings.ts): read once when the server starts, from the command
 * line and the config file. A wrong flag or file ends the program with a message, not a
 * stack trace: it's the first thing a new user sees.
 *
 * The flags: everything after the program's name for the binary (`lab1090 --connect pi`)
 * and `bun ./build`; in dev, everything after `--` (`bun run dev --connect pi`: the script
 * is `vite dev --`, since Vite rejects options it doesn't know).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { building } from '$app/env';
import type { LatLon } from '#lib/modes/cpr.ts';
import {
	defaultConfigPath,
	parseConfig,
	parseFlags,
	resolveSettings,
	SettingsError,
	USAGE,
	withPosition,
	type ConfigFile,
	type Settings
} from './settings';

function args(argv: string[]): string[] {
	const dashes = argv.indexOf('--');
	return dashes === -1 ? argv.slice(2) : argv.slice(dashes + 1);
}

/** The file's settings; none yet if it doesn't exist (setup creates it). */
function readConfig(path: string): ConfigFile {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw new SettingsError(`${path}: ${(e as Error).message}`);
	}
	return parseConfig(text, path);
}

/** Exit with the message: for mistakes in the flags or the file. */
function fail(message: string): never {
	console.error(`lab1090: ${message}\nRun "lab1090 --help" for the options.`);
	process.exit(2);
}

class LiveSettings {
	readonly configPath: string;
	#settings: Settings;

	constructor() {
		// Vite's build runs this module too (with its own argv): defaults, nothing read.
		if (building) {
			this.configPath = '';
			this.#settings = resolveSettings({ help: false, config: null }, {});
			return;
		}
		try {
			const flags = parseFlags(args(process.argv));
			if (flags.help) {
				console.log(USAGE);
				process.exit(0);
			}
			this.configPath = flags.config ?? defaultConfigPath(process.env, homedir());
			this.#settings = resolveSettings(flags, readConfig(this.configPath));
		} catch (e) {
			if (e instanceof SettingsError) fail(e.message);
			throw e;
		}
	}

	get connect(): Settings['connect'] {
		return this.#settings.connect;
	}
	get position(): LatLon | null {
		return this.#settings.position;
	}
	get positionFrom(): Settings['positionFrom'] {
		return this.#settings.positionFrom;
	}
	get port(): number {
		return this.#settings.port;
	}
	get bind(): string | null {
		return this.#settings.bind;
	}

	/**
	 * Save a new position from /setup into the config file (the rest of the file stays). The
	 * file is written to a temporary name and renamed, so a crash can't leave half of it.
	 * Throws if the position came from --position: the flag would win again at the next start.
	 */
	setPosition(position: LatLon): void {
		if (this.#settings.positionFrom === 'flag') {
			throw new Error('the position is set with --position on the command line');
		}
		const file = withPosition(readConfig(this.configPath), position);
		mkdirSync(dirname(this.configPath), { recursive: true });
		const temporary = `${this.configPath}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(file, null, '\t')}\n`);
		renameSync(temporary, this.configPath);
		this.#settings = { ...this.#settings, position: file.position!, positionFrom: 'file' };
	}
}

export const settings = new LiveSettings();
