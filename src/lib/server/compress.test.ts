import { expect, test } from 'bun:test';
import { acceptsGzip, gzipResponse } from './compress';

const PAGE = '<!doctype html><p>' + 'aircraft '.repeat(500) + '</p>';

function page(headers: Record<string, string> = {}): Response {
	return new Response(PAGE, {
		headers: { 'content-type': 'text/html', etag: '"abc"', 'content-length': '4518', ...headers }
	});
}

function get(acceptEncoding: string | null): Request {
	return new Request('http://pi:1090/', {
		headers: acceptEncoding === null ? {} : { 'accept-encoding': acceptEncoding }
	});
}

test('gzip is accepted as Chrome offers it over HTTP, and refused with q=0', () => {
	expect(acceptsGzip('gzip, deflate')).toBe(true);
	expect(acceptsGzip('br;q=1.0, gzip;q=0.8')).toBe(true);
	expect(acceptsGzip('*')).toBe(true);
	expect(acceptsGzip('gzip;q=0')).toBe(false);
	expect(acceptsGzip('identity')).toBe(false);
	expect(acceptsGzip(null)).toBe(false);
});

test('a page is gzipped, with its own ETag and no stale length', async () => {
	const res = gzipResponse(get('gzip, deflate'), page());
	expect(res.headers.get('content-encoding')).toBe('gzip');
	expect(res.headers.get('etag')).toBe('"abc-gzip"');
	expect(res.headers.get('content-length')).toBeNull();
	expect(res.headers.get('vary')).toBe('accept-encoding');
	const bytes = new Uint8Array(await res.arrayBuffer());
	expect(bytes.length).toBeLessThan(PAGE.length / 4);
	expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(PAGE);
});

test('left alone: no gzip accepted, the event stream, other statuses', () => {
	const plain = page();
	expect(gzipResponse(get(null), plain)).toBe(plain);
	const stream = page({ 'content-type': 'text/event-stream' });
	expect(gzipResponse(get('gzip'), stream)).toBe(stream);
	const missing = new Response('not found', {
		status: 404,
		headers: { 'content-type': 'text/html' }
	});
	expect(gzipResponse(get('gzip'), missing)).toBe(missing);
});
