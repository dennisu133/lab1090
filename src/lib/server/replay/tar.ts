/**
 * Reading a file as a stream, in pieces of the size asked for, and the tar archives SigMF
 * recordings come in (record/archive.ts writes them): POSIX ustar headers, with pax extended
 * headers (`x`) for longer paths and sizes above 8 GiB, and GNU's base-256 sizes too, so
 * archives made by other programs read as well.
 */

/** A stream's bytes, `n` at a time. */
export class ByteReader {
	#reader: ReadableStreamDefaultReader<Uint8Array>;
	#pieces: Uint8Array[] = [];
	#buffered = 0;
	#done = false;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.#reader = stream.getReader();
	}

	/** The next `n` bytes; fewer only at the end. */
	async read(n: number): Promise<Uint8Array> {
		while (this.#buffered < n && !this.#done) {
			const { value, done } = await this.#reader.read();
			if (done) this.#done = true;
			else if (value.length > 0) {
				this.#pieces.push(value);
				this.#buffered += value.length;
			}
		}
		const take = Math.min(n, this.#buffered);
		const out = new Uint8Array(take);
		let at = 0;
		while (at < take) {
			const piece = this.#pieces[0];
			const part = Math.min(piece.length, take - at);
			out.set(piece.subarray(0, part), at);
			at += part;
			if (part === piece.length) this.#pieces.shift();
			else this.#pieces[0] = piece.subarray(part);
		}
		this.#buffered -= take;
		return out;
	}

	/** Pass over `n` bytes (a little at a time: an entry may be gigabytes). */
	async skip(n: number): Promise<void> {
		for (let left = n; left > 0;) {
			const got = await this.read(Math.min(left, 1 << 20));
			if (got.length === 0) return;
			left -= got.length;
		}
	}

	/** Done with it: the file is closed. */
	async cancel(): Promise<void> {
		await this.#reader.cancel().catch(() => {});
	}
}

const BLOCK = 512;

export interface TarEntry {
	path: string;
	size: number;
}

/**
 * The next file's header; its `size` bytes follow, then padding to a whole block (skip with
 * endOfEntry). null at the archive's end. Directories and pax global headers are passed over.
 */
export async function nextEntry(reader: ByteReader): Promise<TarEntry | null> {
	let pax: Record<string, string> = {};
	for (;;) {
		const header = await reader.read(BLOCK);
		if (header.length < BLOCK || header.every((b) => b === 0)) return null;
		const text = (from: number, length: number) =>
			new TextDecoder().decode(header.subarray(from, from + length)).replace(/\0.*$/s, '');
		if (text(257, 5) !== 'ustar') throw new Error('not a tar archive (no ustar header)');
		const size = headerSize(header);
		const type = text(156, 1);
		if (type === 'x' || type === 'g') {
			const records = new TextDecoder().decode(await reader.read(size));
			await reader.skip(padding(size));
			if (type === 'x') pax = parsePax(records);
			continue;
		}
		const path = pax.path ?? [text(345, 155), text(0, 100)].filter(Boolean).join('/');
		const entry = { path, size: pax.size !== undefined ? Number(pax.size) : size };
		pax = {};
		if (type === '5') continue;
		return entry;
	}
}

/** After an entry's `size` bytes: its padding to a whole block. */
export function endOfEntry(reader: ByteReader, size: number): Promise<void> {
	return reader.skip(padding(size));
}

const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

/** Octal text, or (GNU) big-endian binary when the first byte's top bit is set. */
function headerSize(header: Uint8Array): number {
	const field = header.subarray(124, 136);
	if (field[0] & 0x80) {
		let value = field[0] & 0x7f;
		for (let i = 1; i < field.length; i++) value = value * 256 + field[i];
		return value;
	}
	const text = new TextDecoder().decode(field).replace(/[\0 ].*$/s, '');
	return text ? parseInt(text, 8) : 0;
}

/** "<length> <key>=<value>\n" records. */
function parsePax(records: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of records.split('\n')) {
		const match = /^\d+ ([^=]+)=(.*)$/s.exec(line);
		if (match) out[match[1]] = match[2];
	}
	return out;
}
