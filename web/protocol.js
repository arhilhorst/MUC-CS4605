/* Encoding mirror + serial transport.
 * Everything here must stay in step with firmware/tactor_band/tactor_band.ino.
 * 0 degrees = target ahead, positive = target to the RIGHT. */

export const TACTORS = [
  { id: 'LT', ch: 0, pin: 11, label: 'left-top' },
  { id: 'RT', ch: 1, pin: 10, label: 'right-top' },
  { id: 'LB', ch: 2, pin: 6,  label: 'left-bottom' },
  { id: 'RB', ch: 3, pin: 9,  label: 'right-bottom' },
];

export const SECTORS = [
  { id: 'F',  lo: -30,  hi: 30,   name: 'Ahead',        short: 'ahead' },
  { id: 'R1', lo: 30,   hi: 90,   name: 'Right 30–90',  short: 'R 30–90' },
  { id: 'R2', lo: 90,   hi: 150,  name: 'Right 90–150', short: 'R 90–150' },
  { id: 'B',  lo: 150,  hi: 210,  name: 'Behind',       short: 'behind' },
  { id: 'L2', lo: -150, hi: -90,  name: 'Left 90–150',  short: 'L 90–150' },
  { id: 'L1', lo: -90,  hi: -30,  name: 'Left 30–90',   short: 'L 30–90' },
];
export const SECTOR_IDS = ['F', 'R1', 'R2', 'B', 'L2', 'L1'];

export const norm = a => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

export function sectorOf(angle) {
  const a = norm(angle), m = Math.abs(a);
  if (m <= 30) return 'F';
  if (m <= 90) return a > 0 ? 'R1' : 'L1';
  if (m <= 150) return a > 0 ? 'R2' : 'L2';
  return 'B';
}

/* What the firmware will actually do for this angle. Used to show the
 * operator what should be playing, and to sanity-check the mapping. */
export function encodingFor(angle) {
  const a = norm(angle), m = Math.abs(a), right = a > 0;
  if (m <= 30)
    return { kind: 'pulses', tactors: ['LT', 'RT'], count: 3, totalMs: 3 * 180 + 2 * 120,
             desc: 'both top, 3 pulses' };
  if (m <= 90) {
    const d = 500 + Math.round((m - 30) * 1500 / 60);
    return { kind: 'single', tactors: [right ? 'RT' : 'LT'], totalMs: d,
             desc: `${right ? 'right' : 'left'}-top, ${d} ms` };
  }
  if (m <= 150) {
    const extra = Math.round((m - 90) * 2000 / 60);
    return { kind: 'escalate', tactors: [right ? 'RT' : 'LT', right ? 'RB' : 'LB'],
             totalMs: 2000 + extra,
             desc: `${right ? 'right' : 'left'}-top 2000 ms, then +bottom ${extra} ms` };
  }
  return { kind: 'pulses', tactors: ['LB', 'RB'], count: 3, totalMs: 3 * 180 + 2 * 120,
           desc: 'both bottom, 3 pulses' };
}

/* ------------------------------------------------------------------ */

export class Board extends EventTarget {
  constructor() { super(); this.port = null; this.writer = null; this._buf = ''; }

  get connected() { return !!this.writer; }

  static get supported() { return 'serial' in navigator; }

  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });
    this.writer = this.port.writable.getWriter();
    this._read();
    this.dispatchEvent(new Event('open'));
  }

  async disconnect() {
    try { this.writer?.releaseLock(); await this.port?.close(); } catch (e) { /* already gone */ }
    this.writer = null; this.port = null;
    this.dispatchEvent(new Event('close'));
  }

  async _read() {
    const dec = new TextDecoderStream();
    this.port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader();
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch (e) { break; }
      if (chunk.done) break;
      this._buf += chunk.value;
      let i;
      while ((i = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, i).trim();
        this._buf = this._buf.slice(i + 1);
        if (line) this.dispatchEvent(new CustomEvent('line', { detail: line }));
      }
    }
    this.writer = null;
    this.dispatchEvent(new Event('close'));
  }

  async send(cmd) {
    if (!this.writer) throw new Error('not connected');
    await this.writer.write(new TextEncoder().encode(cmd + '\n'));
  }

  /* Resolves with { startUs, endUs } once the board reports END, or
   * rejects on timeout so a dropped line cannot hang a session. */
  play(angle, timeoutMs = 10000) {
    const hostSendMs = performance.now();
    return new Promise((resolve, reject) => {
      let startUs = null, hostStartMs = null;
      const onLine = ev => {
        const p = ev.detail.split(',');
        if (p[0] === 'START') { startUs = +p[2]; hostStartMs = performance.now(); }
        else if (p[0] === 'END') {
          cleanup();
          resolve({ startUs, endUs: +p[2], hostSendMs, hostStartMs,
                    onsetLatencyMs: hostStartMs == null ? null : hostStartMs - hostSendMs,
                    durationMs: startUs == null ? null : (+p[2] - startUs) / 1000 });
        }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.removeEventListener('line', onLine); };
      this.addEventListener('line', onLine);
      this.send(`P,${Math.round(angle)}`).catch(e => { cleanup(); reject(e); });
    });
  }

  testChannel(ch, ms) { return this.send(`T,${ch},${ms}`); }
  setDuty(d)          { return this.send(`D,${Math.max(0, Math.min(255, d | 0))}`); }
  stop()              { return this.send('S'); }
  info()              { return this.send('?'); }
}
