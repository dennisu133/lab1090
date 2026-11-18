/**
 * What the Content columns show: everything the decoders found in one frame, as a flat
 * list of short, labelled values. Each one has a tooltip that says what it means.
 *
 * Labels are the field names from the specs (FS, SL, RI, …), so they match the literature.
 *
 * This file covers the frame: header fields (DF, CA, FS, …), the DF18/19 formats, DF16's
 * register copy and decoded positions. The ADS-B payload is in squitter.ts, the shared
 * builders (Field, altitude, squawk, …) in field.ts.
 */
import { bearing, compass, distanceKm } from '#lib/geo.ts';
import { resolutionAdvisory } from '#lib/modes/acas.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { bits, downlinkFormat, payload } from '#lib/modes/frame.ts';
import {
	CAPABILITIES,
	CONTROL_FIELDS,
	REPLY_INFO,
	RESERVATION_TYPES,
	downlinkRequestText,
	messageHeader,
	type FlightStatus,
	type Header
} from '#lib/modes/header.ts';
import { airbornePosition } from '#lib/modes/position.ts';
import { esFormat, extendedSquitter, imf } from '#lib/modes/squitter.ts';
import { advisoryFields, altitudeField, squawkField, type Field } from './field';
import { n } from './format';
import { cprFields, squitterFields } from './squitter';

export interface Located {
	reference: LatLon;
	/** Decoded with the reference point (local CPR decoding). */
	local: LatLon;
	/** Decoded from the even/odd pair (global CPR decoding), if there was one. */
	global: LatLon | null;
	/** Surface position (TC 5–8): quarter-size CPR zones. */
	surface?: boolean;
}

const TONE_ORDER = { main: 0, alert: 1, minor: 2 };

export function describe(data: Uint8Array, located: Located | null = null): Field[] {
	const fields: Field[] = [];
	const header = messageHeader(data);
	if (header) fields.push(...headerFields(header));

	const df = downlinkFormat(data);
	if (df === 18 || df === 19) fields.push(...nonTransponderFields(data));
	const squitter = extendedSquitter(data);
	if (squitter) fields.push(...squitterFields(squitter));

	if (df === 16) fields.push(...mvFields(payload(data)!));
	if (df === 20 || df === 21) {
		fields.push({
			label: 'MB',
			value: 'Comm-B',
			title:
				"56 bits from one of the transponder's registers, read out by a radar. The message doesn't say which register: /comm-b infers it.",
			tone: 'minor'
		});
	}
	if (located) fields.push(...locationFields(located));
	// Stable sort: headline values first, details last, each group in decoding order.
	return fields.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

// --- position ----------------------------------------------------------------------------

/** Two decodes of the same message closer than this are the same position (float noise). */
const SAME_KM = 0.05;

function locationFields({ reference, local, global, surface = false }: Located): Field[] {
	const fields: Field[] = [];
	let position: LatLon;
	if (global) {
		const off = distanceKm(local, global);
		if (off < SAME_KM) {
			position = local;
			fields.push({
				value: '✓ pair',
				title:
					"Decoded with the receiver's position as the reference point, and the even/odd pair (global decoding) gives the same position: confirmed",
				tone: 'minor'
			});
		} else {
			position = global; // a fresh pair beats a reference that's too far away
			fields.push(
				{
					value: 'pair',
					title: 'Decoded from the even/odd pair (global decoding)',
					tone: 'minor'
				},
				{
					value: `reference decode ${n(Math.round(off))} km off`,
					title: `Decoding with the receiver's position as the reference point picked the wrong zone: the aircraft is probably more than ~${surface ? 45 : 180} NM from it (half a zone). Nothing in the message itself reveals this; only the even/odd pair does. Showing the pair's position instead`,
					tone: 'alert'
				}
			);
		}
	} else {
		position = local;
		fields.push({
			value: 'unconfirmed',
			title:
				"Decoded with the receiver's position as the reference point only. No message from this aircraft's other grid within the last 10 s (yet), so it can't be confirmed",
			tone: 'minor'
		});
	}

	const digits = surface ? 5 : 4;
	fields.unshift({
		value: `${position.lat.toFixed(digits)}, ${position.lon.toFixed(digits)}`,
		title: surface
			? 'Latitude, longitude in degrees (WGS84). Surface CPR resolves about 1.25 m; 5 decimals are about 1 m'
			: 'Latitude, longitude in degrees (WGS84). CPR resolves about 5 m; 4 decimals are about 10 m',
		tone: 'main',
		mono: true
	});
	fields.splice(1, 0, {
		value: `${n(Math.round(distanceKm(reference, position)))} km ${compass(bearing(reference, position))}`,
		title: 'Distance and direction from the receiver, along the great circle',
		tone: 'main'
	});
	return fields;
}

// --- header ------------------------------------------------------------------------------

function headerFields(h: Header): Field[] {
	switch (h.df) {
		case 0:
		case 16:
			return [
				altitudeField(h.altitude),
				{
					label: 'VS',
					value: h.onGround ? 'ground' : 'airborne',
					title: 'Vertical status: whether the aircraft says it is on the ground or airborne',
					tone: 'minor'
				},
				...(h.crossLink === null
					? []
					: [
							{
								label: 'CC',
								value: h.crossLink ? 'yes' : 'no',
								title:
									'Cross-link capability: can answer air-air requests for a register with a long reply (DF16)',
								tone: 'minor' as const
							}
						]),
				{
					label: 'SL',
					value: String(h.sensitivity),
					title:
						'ACAS sensitivity level: 0 inoperative, 1 standby, 2 traffic advisories only, 3–7 resolution advisories too, set by altitude (higher = a larger protection volume)',
					tone: 'minor'
				},
				{
					label: 'RI',
					value: String(h.replyInfo),
					title: `Reply information: ${REPLY_INFO[h.replyInfo] ?? 'not assigned'}`,
					tone: 'minor'
				}
			];
		case 4:
		case 20:
			return [altitudeField(h.altitude), ...statusFields(h)];
		case 5:
		case 21:
			return [squawkField(h.squawk), ...statusFields(h)];
		case 11:
		case 17:
			return [
				{
					label: 'CA',
					value: String(h.capability),
					title: `Capability: ${CAPABILITIES[h.capability] ?? 'reserved'}`,
					tone: 'minor'
				}
			];
		case 18:
			return [
				{
					label: 'CF',
					value: String(h.control),
					title: `Control field: ${CONTROL_FIELDS[h.control]}`,
					tone: 'minor'
				}
			];
		case 19:
			return [
				{
					label: 'AF',
					value: String(h.application),
					title: `Application field ${h.application}: military extended squitter. What the other 104 bits mean is up to the military`,
					tone: 'minor'
				}
			];
		case 24:
			return [
				{
					label: 'KE',
					value: h.ke ? 'uplink ack' : 'downlink',
					title:
						'Comm-D: one segment of an extended length message (ELM). KE 0: a segment of a downlink message; 1: acknowledges an uplink ELM',
					tone: 'main'
				},
				{
					label: 'ND',
					value: String(h.nd),
					title: 'Segment number (0–15) within the extended length message',
					tone: 'minor'
				},
				{
					label: 'MD',
					value: h.md,
					title:
						'The 80 bits of message data in this segment. Its meaning depends on the application that sent it',
					tone: 'minor',
					mono: true
				}
			];
	}
}

/**
 * DF18/19: where the message comes from, and anything the regular ADS-B decoders can't read:
 * relayed traffic (TIS-B, ADS-R) and formats with their own layout.
 */
function nonTransponderFields(data: Uint8Array): Field[] {
	const format = esFormat(data);
	const df = downlinkFormat(data);
	if (!format) {
		const field = bits(data, 6, 3);
		return [
			{
				label: 'ME',
				value: 'not decoded',
				title:
					df === 19
						? 'Military format, layout not public. Not laid out like ADS-B (DF17) either: its last 24 bits are not the CRC of the rest'
						: field === 3
							? 'Coarse TIS-B airborne position and velocity: a compressed layout of its own, only used in the US (not decoded)'
							: field === 4
								? 'TIS-B/ADS-R management message: information about the ground station (not decoded)'
								: 'Reserved control field: no defined layout',
				tone: 'minor'
			}
		];
	}
	const fields: Field[] = [];
	if (df === 19) {
		fields.push({
			value: 'decoded as DF17',
			title:
				"A military squitter whose last 24 bits are the CRC of the rest, as in ADS-B (DF17): so it's decoded as ADS-B. A message laid out differently would pass this check once in 16.7 million times",
			tone: 'alert'
		});
	}
	if (format.source !== 'ads-b') {
		fields.push({
			value: format.source === 'tis-b' ? 'TIS-B' : 'ADS-R',
			title:
				format.source === 'tis-b'
					? 'Traffic information service: a ground station relays an aircraft its radar sees (often one without ADS-B). Position and speed come from the radar, not the aircraft'
					: 'ADS-B rebroadcast: a ground station repeats what an aircraft sent on the other ADS-B link (978 MHz UAT, US only)',
			tone: 'main'
		});
	}
	const flag = format.address === 'imf' ? imf(payload(data)!) : null;
	if (format.address === 'non-icao' || flag) {
		fields.push({
			label: 'addr',
			value: 'non-ICAO',
			title:
				format.source === 'tis-b'
					? 'The address is not an ICAO address: 12 bits Mode A code + 12 bits track number the ground station assigned'
					: 'The address is not an ICAO aircraft address: anonymous, a ground vehicle or an obstacle',
			tone: 'alert'
		});
	}
	return fields;
}

function statusFields(h: {
	flightStatus: FlightStatus;
	downlinkRequest: number;
	utility: { iis: number; ids: number };
}): Field[] {
	const fs = h.flightStatus;
	const fields: Field[] = [
		{
			label: 'FS',
			value: [
				fs.onGround === null ? null : fs.onGround ? 'ground' : 'airborne',
				fs.alert ? 'alert' : null,
				fs.spi ? 'SPI' : null,
				fs.code >= 6 ? 'reserved' : null
			]
				.filter(Boolean)
				.join(', '),
			title: `Alert: the squawk changed in the last 18 s or is an emergency code. SPI: the pilot pressed IDENT`,
			tone: fs.alert || fs.spi ? 'alert' : 'minor'
		}
	];
	// Both are 0 in nearly every reply: only show them when they say something.
	if (h.downlinkRequest) {
		fields.push({
			label: 'DR',
			value: String(h.downlinkRequest),
			title: `Downlink request: ${downlinkRequestText(h.downlinkRequest)}`,
			tone: 'minor'
		});
	}
	if (h.utility.iis || h.utility.ids) {
		fields.push({
			label: 'UM',
			value: `IIS ${h.utility.iis}/${RESERVATION_TYPES[h.utility.ids]}`,
			title: h.utility.ids
				? `Utility message: interrogator ${h.utility.iis} has reserved the transponder (${RESERVATION_TYPES[h.utility.ids]})`
				: `Utility message: interrogator ${h.utility.iis}, no reservation (IDS 0)`,
			tone: 'minor'
		});
	}
	return fields;
}

/**
 * DF16: the MV field. VDS 0x30: an ACAS coordination reply, the same resolution advisory
 * as register 3,0. In practice it mostly holds a copy of the position register, asked for
 * air-to-air.
 */
function mvFields(mv: Uint8Array): Field[] {
	if (mv[0] === 0x30) {
		return [
			{
				label: 'MV',
				value: 'ACAS coordination',
				title:
					"Payload of a long air-air reply, VDS 0x30: this aircraft's ACAS resolution advisory, as another aircraft's ACAS asked for it to coordinate (same layout as register 3,0)",
				tone: 'minor'
			},
			...advisoryFields(resolutionAdvisory(mv))
		];
	}
	const position = airbornePosition(mv);
	const title =
		'Payload of a long air-air (ACAS) reply. Its first 5 bits read like an ADS-B type code: a copy of the airborne position register (BDS 0,5), requested by another aircraft';
	if (!position || position.tc === 0) {
		return [
			{
				label: 'MV',
				value: `VDS ${bits(mv, 1, 8).toString(16)}`,
				title: 'Payload of a long air-air (ACAS) reply',
				tone: 'minor'
			}
		];
	}
	return [
		{ label: 'MV', value: 'position register', title, tone: 'minor' },
		...cprFields(position)
	];
}
