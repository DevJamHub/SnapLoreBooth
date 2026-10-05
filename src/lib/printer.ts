import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { getSetting, setSetting } from './db';

const run = promisify(execFile);
/** CUPS ships these on macOS and on Linux with cups-ipp-utils. */
const IPPTOOL = ['/usr/bin/ipptool', '/usr/sbin/ipptool'].find((p) => existsSync(p)) ?? 'ipptool';
const IPPFIND = ['/usr/bin/ippfind', '/usr/sbin/ippfind'].find((p) => existsSync(p)) ?? 'ippfind';
const ENV = { ...process.env, LANG: 'C', LC_ALL: 'C' };
const PRINTER_KEY = 'printer.uri';

export interface PrinterInk {
  name: string;
  /** CSS colour the printer gives for the ink, when it gives one. */
  color: string | null;
  /** 0–100, or null when the printer will not say (refillable tanks often do not). */
  level: number | null;
}

export interface PrinterProblem {
  code: string;
  text: string;
  severity: 'error' | 'warning';
}

export interface PrinterStatus {
  uri: string;
  reachable: boolean;
  model: string | null;
  state: 'idle' | 'printing' | 'stopped' | 'unknown';
  problems: PrinterProblem[];
  inks: PrinterInk[];
  /** Paper sizes loaded, as the printer names them (e.g. na_index-4x6_4x6in). */
  media: string[];
  checkedAt: string;
  error: string | null;
}

/** IPP's printer-state-reasons, in the words an operator acts on. */
const REASONS: Record<string, string> = {
  'media-empty': 'Kertas habis',
  'media-needed': 'Masukkan kertas',
  'media-low': 'Kertas hampir habis',
  'media-jam': 'Kertas macet',
  'marker-supply-empty': 'Tinta habis',
  'marker-supply-low': 'Tinta hampir habis',
  'toner-empty': 'Tinta habis',
  'toner-low': 'Tinta hampir habis',
  'marker-waste-full': 'Kotak tinta bekas penuh',
  'marker-waste-almost-full': 'Kotak tinta bekas hampir penuh',
  'door-open': 'Penutup printer terbuka',
  'cover-open': 'Penutup printer terbuka',
  'input-tray-missing': 'Baki kertas tidak terpasang',
  'output-area-full': 'Baki keluaran penuh',
  'offline': 'Printer tidak tersambung',
  'connecting-to-device': 'Printer tidak tersambung',
  'paused': 'Printer dijeda',
  'shutdown': 'Printer mati',
  'stopped-partly': 'Sebagian fungsi printer berhenti',
};

export function printerUri(): string | null {
  return getSetting(PRINTER_KEY);
}

export function setPrinterUri(uri: string | null) {
  setSetting(PRINTER_KEY, uri);
}

export function validPrinterUri(uri: string): boolean {
  return /^ipps?:\/\/[^\s]+$/i.test(uri);
}

/** `name (type) = value` lines of ipptool's verbose output. */
function attributes(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = /^\s+([a-z0-9-]+) \([^)]*\) = (.*)$/.exec(line);
    if (match && !map.has(match[1])) map.set(match[1], match[2].trim());
  }
  return map;
}

const list = (value: string | undefined) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : []);

/** Asks the printer itself over IPP: state, problems, ink levels, loaded paper. */
export async function readPrinter(uri: string): Promise<PrinterStatus> {
  const base: PrinterStatus = {
    uri,
    reachable: false,
    model: null,
    state: 'unknown',
    problems: [],
    inks: [],
    media: [],
    checkedAt: new Date().toISOString(),
    error: null,
  };
  let output: string;
  try {
    ({ stdout: output } = await run(IPPTOOL, ['-T', '6', '-tv', uri, 'get-printer-attributes.test'], {
      timeout: 10_000,
      killSignal: 'SIGKILL',
      env: ENV,
    }));
  } catch (error) {
    const failed = error as { stdout?: string; code?: string };
    if (failed.code === 'ENOENT') return { ...base, error: 'ipptool tidak terpasang di server ini.' };
    output = failed.stdout ?? '';
    if (!output.includes('printer-state')) return { ...base, error: 'Printer tidak menjawab. Cek printer menyala dan satu jaringan dengan server.' };
  }

  const attrs = attributes(output);
  const state = attrs.get('printer-state') ?? '';
  const problems: PrinterProblem[] = [];
  for (const raw of list(attrs.get('printer-state-reasons'))) {
    if (raw === 'none') continue;
    const severity = raw.endsWith('-warning') || raw.endsWith('-report') ? 'warning' : 'error';
    const code = raw.replace(/-(error|warning|report)$/, '');
    const text = REASONS[code] ?? code;
    if (!problems.some((p) => p.text === text)) problems.push({ code, text, severity: code === 'offline' ? 'error' : severity });
  }

  const names = list(attrs.get('marker-names'));
  const levels = list(attrs.get('marker-levels')).map(Number);
  const colors = list(attrs.get('marker-colors'));
  const inks = names.map((name, i) => {
    const level = levels[i];
    // -1/-2 unknown, -3 "some left": a number only when the printer really knows.
    return { name, color: /^#[0-9a-f]{6}/i.test(colors[i] ?? '') ? colors[i].slice(0, 7) : null, level: level >= 0 && level <= 100 ? level : null };
  });

  return {
    ...base,
    reachable: true,
    model: attrs.get('printer-make-and-model') ?? attrs.get('printer-name') ?? null,
    state: state.startsWith('idle') ? 'idle' : state.startsWith('processing') ? 'printing' : state.startsWith('stopped') ? 'stopped' : 'unknown',
    problems,
    inks,
    media: list(attrs.get('media-ready')),
  };
}

export interface FoundPrinter {
  name: string;
  uri: string;
  /** On the network (AirPrint), or a queue on the server's own CUPS (USB printers). */
  source: 'jaringan' | 'server';
}

/** AirPrint printers on the network, and the printers set up on the server itself. */
export async function discoverPrinters(): Promise<FoundPrinter[]> {
  const found: FoundPrinter[] = [];
  const network = run(IPPFIND, ['-T', '4'], { timeout: 8000, killSignal: 'SIGKILL', env: ENV })
    .then(({ stdout }) => stdout)
    .catch((error: { stdout?: string }) => error.stdout ?? '');
  const local = run('lpstat', ['-e'], { timeout: 5000, env: ENV })
    .then(({ stdout }) => stdout)
    .catch(() => '');
  const [networkOut, localOut] = await Promise.all([network, local]);

  for (const uri of networkOut.split('\n').map((l) => l.trim()).filter((l) => /^ipps?:\/\//.test(l))) {
    const name = decodeURIComponent(uri.replace(/^ipps?:\/\//, '').split('._')[0]);
    if (!found.some((f) => f.name === name)) found.push({ name, uri, source: 'jaringan' });
  }
  for (const queue of localOut.split('\n').map((l) => l.trim()).filter(Boolean)) {
    found.push({ name: queue.replace(/_/g, ' '), uri: `ipp://localhost/printers/${queue}`, source: 'server' });
  }
  return found;
}
