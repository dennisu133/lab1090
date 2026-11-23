/**
 * A recording's metadata: the `.sigmf-meta` file of its archive (archive.ts), SigMF 1.2.
 * SigMF's own fields where it has them (sample format and rate, frequency, start time,
 * hardware, the recording program, the samples' SHA-512), the rest in our own `lab1090:`
 * namespace, described in lab1090.sigmf-ext.md (next to this file; SigMF wants every
 * namespace written down like that). Its fields only ever get added to: recordings made by
 * an older lab1090 must still read.
 *
 * No position, on purpose: the files are made to be sent to someone, and the demodulator
 * doesn't need it (SigMF's core:geolocation stays out).
 *
 *   {
 *     "global": {
 *       "core:datatype": "cu8", "core:sample_rate": 2400000, "core:version": "1.2.6",
 *       "core:recorder": "lab1090 0.1.0", "core:hw": "Rafael Micro R820T, Generic RTL2832U OEM",
 *       "core:sha512": "…", "core:extensions": [{ "name": "lab1090", … }],
 *       "lab1090:label": "balcony", "lab1090:gain_db": 49.6, "lab1090:messages": 31234, …
 *     },
 *     "captures": [{ "core:sample_start": 0, "core:frequency": 1090000000,
 *                    "core:datetime": "2026-11-23T20:40:12.345Z" }],
 *     "annotations": []
 *   }
 *
 * A new capture segment begins wherever the samples broke off (rtl_sdr restarted, rtl_tcp
 * reconnected): the samples on either side don't belong together.
 */

export const SIGMF_VERSION = '1.2.6';
/** Our namespace's version (lab1090.sigmf-ext.md). */
export const EXTENSION_VERSION = '1.0.0';
/** The metadata has room for this many (archive.ts META_BYTES); after that the recording stops. */
export const MAX_SEGMENTS = 50;

/** Where a run of samples starts, and when. */
export interface Segment {
	/** Index of its first sample (I/Q pair) in the data. */
	sampleStart: number;
	/** ms since epoch. */
	t: number;
}

/** What the demodulator made of the recorded samples (over the recording only). */
export interface RecordedStats {
	/** Messages it passed on, repaired ones included. */
	messages: number;
	candidates: number;
	/** Messages with a sample at the ADC's limit. */
	clipped: number;
	/** Mean noise level, dBFS; null: none measured. */
	noiseDbfs: number | null;
	/** Samples lost on the way from the dongle, as time (ms). */
	lostMs: number;
	/** The dongle crystal's error, ppm, if measured. */
	ppm: number | null;
}

export interface RecordingMetadata {
	/** "lab1090 0.1.0". */
	recorder: string;
	label: string | null;
	/** How the samples came: "rtl_sdr" on this machine, "rtl_tcp" from another. */
	source: 'rtl_sdr' | 'rtl_tcp';
	tuner: string | null;
	/** The USB device's name (rtl_sdr only). */
	device: string | null;
	/** dB: rtl_sdr's confirmation, else what lab1090 asked for. */
	gainDb: number | null;
	sampleRate: number;
	frequencyHz: number;
	/** Samples (I/Q pairs) asked for, and recorded. */
	plannedSamples: number;
	samples: number;
	/** Why the recording ended before plannedSamples; null: it didn't. */
	stopped: string | null;
	/** Of the data, hex; null while recording. */
	sha512: string | null;
	segments: Segment[];
	stats: RecordedStats | null;
}

/** The metadata as SigMF JSON (one line: a person reads it with `jq`). */
export function toSigmf(m: RecordingMetadata): string {
	const global: Record<string, unknown> = {
		'core:datatype': 'cu8',
		'core:sample_rate': m.sampleRate,
		'core:version': SIGMF_VERSION,
		'core:num_channels': 1,
		'core:recorder': m.recorder,
		'core:description': `1090 MHz (Mode S, ADS-B) from an RTL-SDR, for demodulator work${m.label ? `: ${m.label}` : ''}`,
		'core:extensions': [{ name: 'lab1090', version: EXTENSION_VERSION, optional: true }]
	};
	const hw = [m.tuner, m.device].filter(Boolean).join(', ');
	if (hw) global['core:hw'] = hw;
	if (m.sha512) global['core:sha512'] = m.sha512;
	const ours: Record<string, unknown> = {
		label: m.label,
		source: m.source,
		tuner: m.tuner,
		gain_db: m.gainDb,
		planned_samples: m.plannedSamples,
		samples: m.samples,
		stopped: m.stopped
	};
	if (m.stats) {
		ours.messages = m.stats.messages;
		ours.candidates = m.stats.candidates;
		ours.clipped = m.stats.clipped;
		ours.noise_dbfs = m.stats.noiseDbfs === null ? null : round(m.stats.noiseDbfs, 2);
		ours.lost_ms = Math.round(m.stats.lostMs);
		ours.ppm = m.stats.ppm === null ? null : round(m.stats.ppm, 1);
	}
	for (const [key, value] of Object.entries(ours)) {
		if (value !== null) global[`lab1090:${key}`] = value;
	}
	return JSON.stringify({
		global,
		captures: m.segments.map((s) => ({
			'core:sample_start': s.sampleStart,
			'core:frequency': m.frequencyHz,
			'core:datetime': new Date(s.t).toISOString()
		})),
		annotations: []
	});
}

function round(x: number, digits: number): number {
	return Math.round(x * 10 ** digits) / 10 ** digits;
}
