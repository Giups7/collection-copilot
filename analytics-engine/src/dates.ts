const MS_DAY = 86_400_000;

function toMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromMs(toMs(iso) + days * MS_DAY);
}

/** Giorni da `a` a `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / MS_DAY);
}

/** Primo giorno del mese di `iso`, spostato di `months` mesi. */
export function addMonthsFirstDay(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  return fromMs(Date.UTC(Math.floor(total / 12), total % 12, 1));
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
