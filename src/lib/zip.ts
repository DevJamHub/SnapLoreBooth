/**
 * A ZIP archive written as a stream, one file at a time, without compression: photos and
 * videos are already compressed, and storing them keeps memory to one file however large the
 * event. Plain ZIP (no ZIP64), so up to 65,535 files and 4 GB — far beyond one event.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as ZIP stores them (local time, two-second steps). */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  /** The file's bytes; null skips it (e.g. it is gone from disk). */
  read: () => Promise<Uint8Array | null>;
  date?: Date;
}

const UTF8_NAMES = 0x0800;

export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const central: Buffer[] = [];
  let offset = 0;
  let next = 0;
  let count = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (next < entries.length) {
        const entry = entries[next++];
        const data = await entry.read().catch(() => null);
        if (!data) continue;
        const name = Buffer.from(entry.name, 'utf8');
        const crc = crc32(data);
        const { time, date } = dosDateTime(entry.date ?? new Date());

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        controller.enqueue(new Uint8Array(Buffer.concat([local, name])));
        controller.enqueue(data);

        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE(20, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt16LE(UTF8_NAMES, 8);
        record.writeUInt16LE(0, 10);
        record.writeUInt16LE(time, 12);
        record.writeUInt16LE(date, 14);
        record.writeUInt32LE(crc, 16);
        record.writeUInt32LE(data.length, 20);
        record.writeUInt32LE(data.length, 24);
        record.writeUInt16LE(name.length, 28);
        record.writeUInt32LE(offset, 42);
        central.push(Buffer.concat([record, name]));

        offset += local.length + name.length + data.length;
        count++;
        return;
      }

      const directory = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(count, 8);
      end.writeUInt16LE(count, 10);
      end.writeUInt32LE(directory.length, 12);
      end.writeUInt32LE(offset, 16);
      controller.enqueue(new Uint8Array(Buffer.concat([directory, end])));
      controller.close();
    },
  });
}
