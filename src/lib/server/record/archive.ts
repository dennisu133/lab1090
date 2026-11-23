/**
 * The file a recording goes into: a SigMF archive (https://sigmf.org, spec 1.2), compressed
 * with zstd: `x.sigmf.zst`. `zstd -d x.sigmf.zst` gives the standard archive, `tar xf x.sigmf`
 * its two files, `x/x.sigmf-meta` (JSON, metadata.ts) and `x/x.sigmf-data` (the samples,
 * UC8, exactly what rtl_sdr writes). Compressed, because the samples are mostly faint noise
 * around the middle code, 127.4: zstd keeps a third (32 % on a.u8, at level 1; level 3 and
 * xz were no smaller), 5 minutes 470 MB instead of 1.44 GB.
 *
 * The archive is a tar (POSIX.1-2001, as SigMF asks), written as it is recorded:
 *
 *   ┌ raw zstd frame, HEADER_BYTES, rewritten at the end ───────────────────────────────┐
 *   │ ustar header: x/x.sigmf-meta │ the JSON, padded with spaces to META_BYTES          │
 *   │ pax header (size= and path= of the data, for sizes above ustar's 8 GiB)           │
 *   │ ustar header: x/x.sigmf-data                                                      │
 *   └───────────────────────────────────────────────────────────────────────────────────┘
 *   zstd frames: the samples, one per second of them (compressed on another thread)
 *   raw zstd frame: the data's padding to 512 bytes, then tar's end (two empty blocks)
 *
 * The metadata comes first, so a replay knows what it plays before the samples. But its
 * numbers (the samples' SHA-512, the messages found) and the data's size are only known
 * at the end. So the first frame is a RAW one (zstd's stored block: the bytes as they are,
 * behind a 9-byte frame header): its length doesn't depend on its content, and at the end
 * it's written again in place with the real numbers. If lab1090 dies without that (power
 * cut), the data's size is the planned one: tar complains at the end, and the samples up
 * to there are still there.
 *
 * zstd frames simply follow each other: a decompressor gives their contents one after the
 * other (RFC 8878 3.1: a stream is a series of frames), so the archive is one stream.
 */

/** tar works in blocks of 512 bytes. */
export const BLOCK = 512;
/** Room for the metadata: ~1 KB, plus ~120 bytes per capture segment (MAX_SEGMENTS). */
export const META_BYTES = 28 * BLOCK;
/** The first frame's content: meta header + meta + pax header and record + data header. */
export const HEADER_BYTES = BLOCK + META_BYTES + 2 * BLOCK + BLOCK;

const ZSTD_MAGIC = 0xfd2fb528;
/** RFC 8878 3.1.1.2: a block holds at most 128 KiB. */
const MAX_BLOCK = 128 * 1024;

/** The archive's names for a recording called `base` ("lab1090-2026-11-23T21-40-12-balcony"). */
export function archiveNames(base: string) {
	return {
		meta: `${base}/${base}.sigmf-meta`,
		data: `${base}/${base}.sigmf-data`
	};
}

/**
 * The first frame: the metadata and the data's header. `meta` is the JSON, at most
 * META_BYTES long (UTF-8); `dataBytes` the data's size; `mtime` seconds since 1970.
 */
export function headerFrame(
	base: string,
	meta: string,
	dataBytes: number,
	mtime: number
): Uint8Array {
	const names = archiveNames(base);
	const json = new TextEncoder().encode(meta);
	if (json.length > META_BYTES) {
		throw new Error(
			`the metadata is ${json.length} bytes, more than the ${META_BYTES} kept for it`
		);
	}
	const tar = new Uint8Array(HEADER_BYTES);
	tar.set(ustarHeader(names.meta, META_BYTES, mtime, '0'), 0);
	// Spaces after the JSON (any JSON reader skips them), a newline to end the file.
	tar.fill(0x20, BLOCK + json.length, BLOCK + META_BYTES - 1);
	tar.set(json, BLOCK);
	tar[BLOCK + META_BYTES - 1] = 0x0a;
	const pax = paxRecords({ path: names.data, size: String(dataBytes) });
	const at = BLOCK + META_BYTES;
	tar.set(ustarHeader('PaxHeader', pax.length, mtime, 'x'), at);
	tar.set(pax, at + BLOCK);
	tar.set(ustarHeader(names.data, dataBytes, mtime, '0'), at + 2 * BLOCK);
	return rawFrame(tar);
}

/** The last frame: the data's padding to a whole block, then two empty blocks. */
export function trailerFrame(dataBytes: number): Uint8Array {
	const padding = (BLOCK - (dataBytes % BLOCK)) % BLOCK;
	return rawFrame(new Uint8Array(padding + 2 * BLOCK));
}

/**
 * A zstd frame holding `content` as it is (RFC 8878 3.1.1): the magic number, a frame
 * header saying "single segment, content size in 4 bytes", then raw blocks of at most
 * 128 KiB, the last one marked.
 */
export function rawFrame(content: Uint8Array): Uint8Array {
	const blocks = Math.max(1, Math.ceil(content.length / MAX_BLOCK));
	const out = new Uint8Array(4 + 1 + 4 + blocks * 3 + content.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, ZSTD_MAGIC, true);
	// Frame_Header_Descriptor: Frame_Content_Size_flag 2 (4 bytes), Single_Segment_flag 1.
	out[4] = (2 << 6) | (1 << 5);
	view.setUint32(5, content.length, true);
	let at = 9;
	for (let i = 0; i < blocks; i++) {
		const part = content.subarray(i * MAX_BLOCK, (i + 1) * MAX_BLOCK);
		const last = i === blocks - 1 ? 1 : 0;
		// Block_Header, 3 bytes little-endian: Last_Block, Block_Type 0 (raw), Block_Size.
		const header = (part.length << 3) | last;
		out[at] = header & 0xff;
		out[at + 1] = (header >> 8) & 0xff;
		out[at + 2] = (header >> 16) & 0xff;
		out.set(part, at + 3);
		at += 3 + part.length;
	}
	return out;
}

/**
 * A ustar header block (POSIX.1-1988, the base of POSIX.1-2001's pax). Numbers are octal
 * text; a size that doesn't fit 11 octal digits (8 GiB) is written as 0, and the pax
 * record before it has the real one.
 */
function ustarHeader(path: string, size: number, mtime: number, type: '0' | 'x'): Uint8Array {
	const block = new Uint8Array(BLOCK);
	const ascii = (text: string, at: number, length: number) => {
		for (let i = 0; i < Math.min(text.length, length); i++) block[at + i] = text.charCodeAt(i);
	};
	const octal = (value: number, at: number, length: number) =>
		ascii(value.toString(8).padStart(length - 1, '0'), at, length - 1);
	// The name field takes 100 bytes; a longer path goes into the prefix (155) at a slash.
	let name = path;
	let prefix = '';
	if (path.length > 100) {
		const slash = path.lastIndexOf('/');
		prefix = path.slice(0, slash);
		name = path.slice(slash + 1);
	}
	ascii(name, 0, 100);
	octal(0o644, 100, 8);
	octal(0, 108, 8); // uid
	octal(0, 116, 8); // gid
	octal(size < 8 ** 11 ? size : 0, 124, 12);
	octal(Math.floor(mtime), 136, 12);
	block.fill(0x20, 148, 156); // the checksum counts its own field as spaces
	ascii(type, 156, 1);
	ascii('ustar\0', 257, 6);
	ascii('00', 263, 2);
	ascii(prefix, 345, 155);
	const sum = block.reduce((a, b) => a + b, 0);
	ascii(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
	return block;
}

/** pax extended header records ("<length> <key>=<value>\n"), padded to one block. */
function paxRecords(records: Record<string, string>): Uint8Array {
	let text = '';
	for (const [key, value] of Object.entries(records)) {
		const body = ` ${key}=${value}\n`;
		// The length counts its own digits.
		let length = body.length + 1;
		while (String(length).length + body.length !== length)
			length = String(length).length + body.length;
		text += `${length}${body}`;
	}
	if (text.length > BLOCK) throw new Error('pax records longer than a block');
	const block = new Uint8Array(BLOCK);
	block.set(new TextEncoder().encode(text));
	return block.subarray(0, text.length);
}
