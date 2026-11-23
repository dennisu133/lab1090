import { expect, test } from 'bun:test';
import {
	BEAST_PORT,
	DEFAULT_GAIN,
	DEFAULT_PORT,
	DEFAULT_RECORD_MS,
	RTL_TCP_PORT,
	SettingsError,
	defaultConfigPath,
	describeSource,
	formatEndpoint,
	parseConfig,
	parseEndpoint,
	parseFlags,
	resolveSettings,
	withPosition
} from './settings';

test('endpoints: host, host:port, IPv6 in brackets; Beast port by default', () => {
	expect(parseEndpoint('pi')).toEqual({ host: 'pi', port: BEAST_PORT });
	expect(parseEndpoint('192.168.1.20:30105')).toEqual({ host: '192.168.1.20', port: 30105 });
	expect(parseEndpoint('[::1]:30005')).toEqual({ host: '::1', port: 30005 });
	expect(parseEndpoint('[fe80::1]')).toEqual({ host: 'fe80::1', port: BEAST_PORT });
	expect(() => parseEndpoint('pi:')).toThrow();
	expect(() => parseEndpoint('pi:70000')).toThrow('TCP port');
	expect(() => parseEndpoint('::1')).toThrow(); // ambiguous without brackets
	expect(formatEndpoint({ host: '::1', port: 30005 })).toBe('[::1]:30005');
	expect(formatEndpoint({ host: 'pi', port: 30005 })).toBe('pi:30005');
});

test('flags', () => {
	expect(parseFlags([])).toEqual({ help: false, version: false, config: null });
	expect(
		parseFlags(['--connect', 'pi', '--position', '52,14', '--port', '8080', '--bind', '127.0.0.1'])
	).toEqual({
		help: false,
		version: false,
		config: null,
		connect: { host: 'pi', port: BEAST_PORT },
		position: { lat: 52, lon: 14 },
		port: 8080,
		bind: '127.0.0.1'
	});
	expect(parseFlags(['--connect=pi:1234']).connect).toEqual({ host: 'pi', port: 1234 });
	expect(parseFlags(['--rtl-tcp', 'pi']).rtlTcp).toEqual({ host: 'pi', port: RTL_TCP_PORT });
	expect(parseFlags(['--device', '00000001', '--gain', '40'])).toMatchObject({
		device: '00000001',
		gain: 40
	});
	expect(parseFlags(['--replay', 'x.u8'])).toMatchObject({ replay: 'x.u8' });
	expect(parseFlags(['--replay', 'x.beast', '--loop'])).toMatchObject({
		replay: 'x.beast',
		loop: true
	});
	expect(() => parseFlags(['--loop'])).toThrow('--loop: only with --replay');
	expect(parseFlags(['-h']).help).toBe(true);
	expect(parseFlags(['--version']).version).toBe(true);
});

test('one source at a time', () => {
	expect(() => parseFlags(['--connect', 'pi', '--device', '0'])).toThrow(
		'--device and --connect are different sources'
	);
	expect(() => parseFlags(['--rtl-tcp', 'pi', '--replay', 'x.u8'])).toThrow('pick one');
	expect(() => parseConfig('{"device": "0", "connect": "pi"}', 'c.json')).toThrow(
		'c.json: "device" and "connect" are different sources'
	);
	// A gain only goes with an RTL-SDR.
	expect(() => resolveSettings(parseFlags(['--connect', 'pi', '--gain', '40']), {})).toThrow(
		'--gain: only an RTL-SDR'
	);
	expect(() => resolveSettings(parseFlags(['--gain', '40']), { connect: 'pi' })).toThrow('--gain');
});

test('gains are dB above 0', () => {
	expect(() => parseFlags(['--gain', '0'])).toThrow('--gain: expected a gain');
	expect(() => parseFlags(['--gain', 'max'])).toThrow('--gain');
	expect(() => parseConfig('{"gain": -3}', 'c.json')).toThrow('c.json: "gain"');
	expect(parseConfig('{"gain": 33.8, "device": 1}', 'c.json')).toEqual({ gain: 33.8, device: '1' });
});

test('flag mistakes name the flag', () => {
	expect(() => parseFlags(['--conect', 'pi'])).toThrow(SettingsError);
	expect(() => parseFlags(['--port', 'eighty'])).toThrow('--port: expected a TCP port');
	expect(() => parseFlags(['--position', '52'])).toThrow('--position:');
	expect(() => parseFlags(['--position', '95,14'])).toThrow('within ±90');
	expect(() => parseFlags(['build'])).toThrow(SettingsError); // no positionals
});

test('config file', () => {
	const text = JSON.stringify({ connect: 'pi:30005', position: { lat: 52, lon: 14 }, port: 8080 });
	expect(parseConfig(text, 'c.json')).toEqual({
		connect: 'pi:30005',
		position: { lat: 52, lon: 14 },
		port: 8080
	});
	expect(parseConfig('{}', 'c.json')).toEqual({});
});

test('config mistakes name the file and the key', () => {
	expect(() => parseConfig('{', 'c.json')).toThrow('c.json: not valid JSON');
	expect(() => parseConfig('[]', 'c.json')).toThrow('expected an object');
	expect(() => parseConfig('{"conect": "pi"}', 'c.json')).toThrow('unknown setting "conect"');
	expect(() => parseConfig('{"position": "52,14"}', 'c.json')).toThrow('c.json: "position"');
	expect(() => parseConfig('{"position": {"lat": 52, "lon": 200}}', 'c.json')).toThrow('±180');
	expect(() => parseConfig('{"connect": 30005}', 'c.json')).toThrow('c.json: "connect"');
	expect(() => parseConfig('{"port": 0}', 'c.json')).toThrow('c.json: "port"');
});

test('flags win over the file, the file over the defaults', () => {
	const file = parseConfig(
		JSON.stringify({ connect: 'pi', position: { lat: 52, lon: 14 }, port: 8080 }),
		'c.json'
	);
	expect(resolveSettings(parseFlags([]), {})).toEqual({
		source: { kind: 'rtlsdr', device: '0', gain: DEFAULT_GAIN },
		position: null,
		positionFrom: null,
		port: DEFAULT_PORT,
		bind: null,
		beastOut: null,
		record: null
	});
	expect(resolveSettings(parseFlags([]), file)).toMatchObject({
		source: { kind: 'beast', endpoint: { host: 'pi', port: BEAST_PORT } },
		position: { lat: 52, lon: 14 },
		positionFrom: 'file',
		port: 8080
	});
	expect(
		resolveSettings(parseFlags(['--position', '50,10', '--connect', 'localhost:30105']), file)
	).toMatchObject({
		source: { kind: 'beast', endpoint: { host: 'localhost', port: 30105 } },
		position: { lat: 50, lon: 10 },
		positionFrom: 'flag',
		port: 8080
	});
});

test('a source flag wins over the file’s; the gain goes with any RTL-SDR', () => {
	const tcp = { 'rtl-tcp': 'pi', gain: 30 };
	expect(resolveSettings(parseFlags([]), tcp).source).toEqual({
		kind: 'rtl-tcp',
		endpoint: { host: 'pi', port: RTL_TCP_PORT },
		gain: 30
	});
	expect(resolveSettings(parseFlags(['--device', '1']), tcp).source).toEqual({
		kind: 'rtlsdr',
		device: '1',
		gain: 30
	});
	expect(resolveSettings(parseFlags(['--gain', '20']), { device: '1' }).source).toEqual({
		kind: 'rtlsdr',
		device: '1',
		gain: 20
	});
	expect(resolveSettings(parseFlags(['--replay', 'x.u8']), tcp).source).toEqual({
		kind: 'replay',
		loop: false,
		file: 'x.u8'
	});
	expect(describeSource({ kind: 'rtlsdr', device: '0', gain: 1 })).toBe('RTL-SDR 0');
	expect(describeSource({ kind: 'rtl-tcp', endpoint: { host: 'pi', port: 1234 }, gain: 1 })).toBe(
		'pi:1234 (rtl_tcp)'
	);
});

test('a new position keeps the rest of the file, rounded to ~0.1 m', () => {
	expect(withPosition({ connect: 'pi' }, { lat: 52.123456789, lon: 13.987654321 })).toEqual({
		connect: 'pi',
		position: { lat: 52.123457, lon: 13.987654 }
	});
});

test('a Beast output: a port, from a flag or the file', () => {
	expect(parseFlags(['--beast-out', '30005']).beastOut).toBe(30005);
	expect(() => parseFlags(['--beast-out', 'pi:30005'])).toThrow('--beast-out: expected a TCP port');
	expect(
		resolveSettings(parseFlags([]), parseConfig('{"beast-out": 30005}', 'c.json')).beastOut
	).toBe(30005);
	expect(
		resolveSettings(parseFlags(['--beast-out', '30105']), { 'beast-out': 30005 }).beastOut
	).toBe(30105);
	expect(() => parseConfig('{"beast-out": "x"}', 'c.json')).toThrow('c.json: "beast-out"');
});

test('a recording: 5 minutes unless --record-for, of samples only', () => {
	const record = (args: string[], file = {}) => resolveSettings(parseFlags(args), file).record;
	expect(record([])).toBeNull();
	expect(record(['--record'])).toEqual({ durationMs: DEFAULT_RECORD_MS, label: null });
	expect(DEFAULT_RECORD_MS).toBe(300_000);
	expect(record(['--record', '--record-for', '90s', '--label', 'balcony'])).toEqual({
		durationMs: 90_000,
		label: 'balcony'
	});
	expect(record(['--record', '--record-for=1.5h'])?.durationMs).toBe(5_400_000);
	expect(record(['--record', '--rtl-tcp', 'pi', '--record-for', '10m'])?.durationMs).toBe(600_000);
	expect(() => parseFlags(['--record', '--record-for', '90'])).toThrow(
		'--record-for: expected a time'
	);
	expect(() => parseFlags(['--record', '--record-for', '0.5s'])).toThrow('--record-for');
	expect(() => parseFlags(['--record', '--label', 'my balcony'])).toThrow('--label: expected');
	expect(() => parseFlags(['--record', '--label', '../x'])).toThrow('--label');
	expect(() => parseFlags(['--record-for', '5m'])).toThrow('--record-for: only with --record');
	expect(() => parseFlags(['--label', 'x'])).toThrow('--label: only with --record');
	expect(() => record(['--record', '--connect', 'pi'])).toThrow('--record: a Beast feed');
	expect(() => record(['--record'], { connect: 'pi' })).toThrow('--record: a Beast feed');
	expect(() => record(['--record', '--replay', 'x.u8'])).toThrow('--record');
});

test('config path follows XDG', () => {
	expect(defaultConfigPath({}, '/home/a')).toBe('/home/a/.config/lab1090/config.json');
	expect(defaultConfigPath({ XDG_CONFIG_HOME: '/x' }, '/home/a')).toBe('/x/lab1090/config.json');
});
