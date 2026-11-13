/**
 * The first layer of Mode S decoding: what kind of message is this, and from whom?
 * Pure functions on the raw message bytes (7 or 14), shared by server and browser.
 */

/**
 * Downlink Format: the first 5 bits of every Mode S message.
 * DF 24 is special: only its first two bits ("11") are fixed, so DF 24–31 all mean Comm-D.
 */
export function downlinkFormat(data: Uint8Array): number {
	const df = data[0] >> 3;
	return df >= 24 ? 24 : df;
}

/**
 * ADS-B Type Code: the first 5 bits of the 56-bit ME field (byte 4) in DF17/18.
 * Decides what the message carries (identification, position, velocity, …).
 */
export function typeCode(data: Uint8Array): number | null {
	const df = downlinkFormat(data);
	return df === 17 || df === 18 ? data[4] >> 3 : null;
}

/**
 * The 24-bit ICAO aircraft address, where it's sent in the clear (AA field, bytes 1–3).
 * In the other formats (DF0/4/5/16/20/21) the address is XORed into the parity (AP field)
 * and can only be recovered via the CRC.
 */
export function icaoAddress(data: Uint8Array): string | null {
	const df = downlinkFormat(data);
	if (df !== 11 && df !== 17 && df !== 18) return null;
	return toHex(data.subarray(1, 4)).toUpperCase();
}

/**
 * Beast signal byte -> dBFS. readsb sends sqrt(power) * 255, with power relative to full
 * scale (0–1), so power = (s / 255)² and dBFS = 20·log10(s / 255).
 */
export function signalDbfs(signal: number): number {
	return signal === 0 ? -Infinity : 20 * Math.log10(signal / 255);
}

export function toHex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

export function fromHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
	return out;
}

export const DF_NAMES: Record<number, string> = {
	0: 'Short air-air surveillance (ACAS)',
	4: 'Surveillance, altitude reply',
	5: 'Surveillance, identity reply',
	11: 'All-call reply',
	16: 'Long air-air surveillance (ACAS)',
	17: 'Extended squitter (ADS-B)',
	18: 'Extended squitter, non-transponder (TIS-B / ADS-R)',
	19: 'Military extended squitter',
	20: 'Comm-B, altitude reply',
	21: 'Comm-B, identity reply',
	24: 'Comm-D (extended length message)'
};

export function typeCodeName(tc: number): string {
	if (tc === 0) return 'No position information';
	if (tc <= 4) return 'Aircraft identification';
	if (tc <= 8) return 'Surface position';
	if (tc <= 18) return 'Airborne position (barometric altitude)';
	if (tc === 19) return 'Airborne velocity';
	if (tc <= 22) return 'Airborne position (GNSS height)';
	if (tc === 28) return 'Aircraft status';
	if (tc === 29) return 'Target state and status';
	if (tc === 31) return 'Aircraft operational status';
	return 'Reserved';
}
