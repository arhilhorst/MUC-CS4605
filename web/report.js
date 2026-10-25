/* Verification and summary statistics.
 *
 * The four claims we are replicating, with the values Dobbelstein et al.
 * reported from sixteen participants and ten estimates each. */

import { SECTOR_IDS, SECTORS, norm } from './protocol.js';

export const ORIGINAL = {
  C1: { label: 'Correct sector identified', value: 0.975, kind: 'prop' },
  C2: { label: 'Angle judged within ±10°',  value: 0.72,  kind: 'prop' },
  C3: { label: 'Angle judged within ±20°',  value: 0.88,  kind: 'prop' },
  C4: { label: 'Top sectors under-, bottom over-estimated', value: null, kind: 'pattern' },
};

/* Percentile bootstrap over the trial rows. 2000 resamples is plenty
 * for a live readout; the analysis notebook can do more. */
export function bootstrapCI(rows, statFn, iters = 2000, alpha = 0.05) {
  const n = rows.length;
  if (n < 2) return null;
  const stats = new Array(iters);
  for (let b = 0; b < iters; b++) {
    const sample = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = rows[(Math.random() * n) | 0];
    stats[b] = statFn(sample);
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(iters * alpha / 2)], stats[Math.ceil(iters * (1 - alpha / 2)) - 1]];
}

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

export function summarize(rows) {
  if (!rows.length) return null;

  const pSector = rs => mean(rs.map(r => r.sector_correct));
  const p10     = rs => mean(rs.map(r => r.within10));
  const p20     = rs => mean(rs.map(r => r.within20));

  /* Signed error by TRUE sector — this is what claim C4 is about.
   * Negative mean = participants judged the angle smaller than it was
   * (under-estimated); positive = over-estimated. */
  const bySector = SECTOR_IDS.map(id => {
    const rs = rows.filter(r => r.true_sector === id);
    const meta = SECTORS.find(s => s.id === id);
    return {
      id, name: meta.short, n: rs.length,
      meanSigned: rs.length ? mean(rs.map(r => r.signed_error)) : null,
      meanAbs:    rs.length ? mean(rs.map(r => r.abs_error))    : null,
      acc:        rs.length ? mean(rs.map(r => r.sector_correct)) : null,
    };
  });

  /* 6x6 confusion, true sector (row) against response sector (column). */
  const confusion = SECTOR_IDS.map(t =>
    SECTOR_IDS.map(r => rows.filter(x => x.true_sector === t && x.response_sector === r).length));

  /* C4 check: the top sectors are the ones a tactor on the TOP of the
   * wrist serves (ahead and the 30-90 pair); the bottom sectors are
   * behind and the 90-150 pair. */
  const topIds = ['F', 'L1', 'R1'], botIds = ['B', 'L2', 'R2'];
  const topRows = rows.filter(r => topIds.includes(r.true_sector));
  const botRows = rows.filter(r => botIds.includes(r.true_sector));

  return {
    n: rows.length,
    participants: [...new Set(rows.map(r => r.participant))],
    C1: { value: pSector(rows), ci: bootstrapCI(rows, pSector) },
    C2: { value: p10(rows),     ci: bootstrapCI(rows, p10) },
    C3: { value: p20(rows),     ci: bootstrapCI(rows, p20) },
    C4: {
      topMean: topRows.length ? mean(topRows.map(r => r.signed_error)) : null,
      botMean: botRows.length ? mean(botRows.map(r => r.signed_error)) : null,
      topN: topRows.length, botN: botRows.length,
      matches: topRows.length && botRows.length
        ? (mean(topRows.map(r => r.signed_error)) < 0 &&
           mean(botRows.map(r => r.signed_error)) > 0)
        : null,
    },
    bySector,
    confusion,
    meanAbsError: mean(rows.map(r => r.abs_error)),
    replays: rows.reduce((s, r) => s + (r.replays || 0), 0),
  };
}

/* A live verdict is indicative only — the real classification happens
 * in the analysis notebook against the preregistered margin. */
export function verdict(ci, originalValue) {
  if (!ci || originalValue == null) return { id: 'none', text: '—' };
  if (originalValue >= ci[0] && originalValue <= ci[1])
    return { id: 'in', text: 'interval contains the original' };
  return originalValue < ci[0]
    ? { id: 'above', text: 'ours is higher than the original' }
    : { id: 'below', text: 'ours is lower than the original' };
}

/* ---- onset jitter, from the board's own timestamps ---------------- */
export function jitterStats(rows) {
  const gaps = [];
  for (const r of rows) {
    if (r.cmd_sent_ms != null && r.stim_start_us != null && r.stim_start_us !== '')
      gaps.push(r.onset_latency_ms);
  }
  if (gaps.length < 2) return null;
  const m = mean(gaps);
  const sd = Math.sqrt(mean(gaps.map(g => (g - m) ** 2)));
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    n: gaps.length, mean: m, sd,
    min: sorted[0], max: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

export const CSV_COLUMNS = [
  'participant', 'session_id', 'sequence', 'block_feedback', 'trial', 'rep',
  'true_angle', 'true_sector', 'response_angle', 'response_sector',
  'signed_error', 'abs_error', 'sector_correct', 'within10', 'within20',
  'replays', 'cmd_sent_ms', 'stim_start_us', 'stim_end_us', 'onset_latency_ms',
  'stim_duration_ms', 'rt_ms', 'iso_time', 'order_seed', 'drive_duty',
];

export function toCSV(rows) {
  const esc = v => (v == null ? '' : String(v).includes(',') ? `"${v}"` : String(v));
  return [CSV_COLUMNS.join(',')]
    .concat(rows.map(r => CSV_COLUMNS.map(c => esc(r[c])).join(',')))
    .join('\n');
}
