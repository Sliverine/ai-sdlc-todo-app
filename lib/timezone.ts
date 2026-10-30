export const SINGAPORE_TIMEZONE = 'Asia/Singapore';
const OFFSET_MS = 8 * 60 * 60 * 1000;

export function getSingaporeNow(): Date {
  return new Date();
}

export function dateFromTimestamp(timestamp: number): Date {
  return new Date(timestamp);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseSingaporeDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new Error('Invalid date');
  const [, y, mo, d, h, mi, s = '0', , offset] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
      hour > 23 || minute > 59 || second > 59) throw new Error('Invalid date');
  if (offset && offset !== 'Z') {
    const [oh, om] = offset.slice(1).split(':').map(Number);
    if (oh > 23 || om > 59) throw new Error('Invalid date offset');
  }
  const normalized = value.replace(' ', 'T') + (offset ? '' : '+08:00');
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid date');
  return result;
}

export function toSingaporeParts(value: Date | string) {
  const date = typeof value === 'string' ? parseSingaporeDate(value) : value;
  const local = new Date(date.getTime() + OFFSET_MS);
  return {
    year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(),
    millisecond: local.getUTCMilliseconds(),
  };
}

export function fromSingaporeParts(
  parts: { year: number; month: number; day: number },
  hour = 0, minute = 0, second = 0, millisecond = 0,
): string {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, minute, second, millisecond)).toISOString();
}

export function formatSingaporeDate(value: Date | string, pattern = 'dd MMM yyyy, HH:mm'): string {
  const date = typeof value === 'string' ? parseSingaporeDate(value) : value;
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  const p = toSingaporeParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    yyyy: String(p.year), MM: pad(p.month), dd: pad(p.day),
    HH: pad(p.hour), mm: pad(p.minute), ss: pad(p.second),
    MMM: new Intl.DateTimeFormat('en-SG', { month: 'short', timeZone: SINGAPORE_TIMEZONE }).format(date),
    EEE: new Intl.DateTimeFormat('en-SG', { weekday: 'short', timeZone: SINGAPORE_TIMEZONE }).format(date),
    d: String(p.day),
  };
  return pattern.replace(/yyyy|MMM|MM|dd|HH|mm|ss|EEE|d/g, (token) => tokens[token]);
}

export function toSingaporeInput(value: string | null): string {
  return value ? formatSingaporeDate(value, 'yyyy-MM-dd') + 'T' + formatSingaporeDate(value, 'HH:mm') : '';
}
