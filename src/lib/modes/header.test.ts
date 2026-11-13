import { expect, test } from 'bun:test';
import { fromHex } from './frame';
import { flightStatus, messageHeader } from './header';
import { oracle } from './testing';

test('DF0/16 (ACAS): agree with pyModeS', () => {
	const airAir = oracle.filter((o) => o.df === 0 || o.df === 16);
	expect(airAir.length).toBe(66 + 128);
	for (const o of airAir) {
		const h = messageHeader(o.data);
		if (h?.df !== 0 && h?.df !== 16) throw new Error(`not an air-air reply: ${o.message}`);
		expect(h.onGround).toBe(o.vertical_status === 'on-ground');
		expect(h.sensitivity).toBe(o.sensitivity_level);
		expect(h.replyInfo).toBe(o.reply_information);
		// pyModeS reports CC for DF16 too, but DF16 has no such field (bit 7 is spare).
		if (o.df === 0) expect(h.crossLink).toBe(o.cross_link_capability === 1);
		expect(h.altitude.feet).toBe(o.altitude);
	}
});

test('DF4/5/20/21: agree with pyModeS', () => {
	const replies = oracle.filter((o) => [4, 5, 20, 21].includes(o.df));
	expect(replies.length).toBeGreaterThan(3000);
	for (const o of replies) {
		const h = messageHeader(o.data)!;
		if (!('flightStatus' in h)) throw new Error(`not a ground reply: ${o.message}`);
		// pyModeS 3 leaves DR/UM out of its DF20/21 output; check them where it gives them.
		if ('flight_status' in o) expect(h.flightStatus.code).toBe(o.flight_status);
		if ('downlink_request' in o) expect(h.downlinkRequest).toBe(o.downlink_request);
		if ('utility_message' in o)
			expect((h.utility.iis << 2) | h.utility.ids).toBe(o.utility_message);
	}
});

test('DF11: agree with pyModeS', () => {
	for (const o of oracle.filter((o) => o.df === 11)) {
		expect(messageHeader(o.data)).toEqual({ df: 11, capability: o.capability });
	}
});

test('field positions, bit by bit', () => {
	// DF4, FS 5 (SPI), DR 1, UM: IIS 9, IDS 1, AC 0
	//   00100 101 | 00001 100101 | 0…
	const h = messageHeader(fromHex('25' + '0c' + 'a0' + '00' + '000000'));
	expect(h).toMatchObject({
		df: 4,
		flightStatus: { code: 5, onGround: null, alert: false, spi: true },
		downlinkRequest: 1,
		utility: { iis: 9, ids: 1 },
		altitude: { feet: null, encoding: 'none' }
	});
});

test('flight status', () => {
	expect(flightStatus(0)).toEqual({ code: 0, onGround: false, alert: false, spi: false });
	expect(flightStatus(3)).toEqual({ code: 3, onGround: true, alert: true, spi: false });
	expect(flightStatus(4)).toEqual({ code: 4, onGround: null, alert: true, spi: true });
});

test('formats without these fields', () => {
	expect(messageHeader(fromHex('98' + '00'.repeat(13)))).toBeNull(); // DF19
});
