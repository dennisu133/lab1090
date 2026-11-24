/**
 * Gzip for the responses SvelteKit renders: pages and JSON. The static files (scripts,
 * styles) come gzipped and brotli'd from the build (adapter-bun's `precompress`, patched in
 * `patches/` so the single binary carries them too); they never reach the hooks.
 *
 * Gzip only, compressed on the fly: over plain HTTP to another machine (http://pi:1090),
 * browsers offer nothing better (Chrome sends "gzip, deflate"; brotli and zstd only over
 * HTTPS), and the page is ~45 KB of text that gzips to a quarter. The event stream stays
 * as it is: compressing it would hold its events back until a block is full.
 */

/** What's worth compressing: text that SvelteKit renders. */
const COMPRESSIBLE = /^(text\/html|application\/json)\b/;

/** Whether the request accepts gzip (and doesn't refuse it with q=0). */
export function acceptsGzip(acceptEncoding: string | null): boolean {
	for (const part of acceptEncoding?.split(',') ?? []) {
		const [coding, ...params] = part.trim().toLowerCase().split(';');
		if (coding !== 'gzip' && coding !== '*') continue;
		const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
		return q === undefined || Number(q.slice(2)) > 0;
	}
	return false;
}

/**
 * The response gzipped if the request accepts it and it's worth it; otherwise as it was.
 * The ETag gets the encoding appended (like the static files' `"hash-gz"`): the bytes
 * differ, and SvelteKit's 304 check compares the request's If-None-Match with the ETag the
 * hooks leave, so revalidation keeps working.
 */
export function gzipResponse(request: Request, response: Response): Response {
	const type = response.headers.get('content-type') ?? '';
	if (
		request.method !== 'GET' ||
		response.status !== 200 ||
		!response.body ||
		!COMPRESSIBLE.test(type) ||
		response.headers.has('content-encoding') ||
		!acceptsGzip(request.headers.get('accept-encoding'))
	) {
		return response;
	}
	const headers = new Headers(response.headers);
	headers.set('content-encoding', 'gzip');
	headers.delete('content-length');
	headers.append('vary', 'accept-encoding');
	const etag = headers.get('etag');
	if (etag?.endsWith('"')) headers.set('etag', `${etag.slice(0, -1)}-gzip"`);
	return new Response(response.body.pipeThrough(new CompressionStream('gzip')), {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
