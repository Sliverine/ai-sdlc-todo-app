import type { RecurrencePattern } from './db';
import { dateFromTimestamp, daysInMonth, fromSingaporeParts, parseSingaporeDate, toSingaporeParts } from './timezone';

export function calculateNextDueDate(currentDueDate: string, pattern: RecurrencePattern): string {
  const p = toSingaporeParts(currentDueDate);
  if (pattern === 'daily' || pattern === 'weekly') {
    return dateFromTimestamp(parseSingaporeDate(currentDueDate).getTime() + (pattern === 'daily' ? 1 : 7) * 86_400_000).toISOString();
  }
  if (pattern !== 'monthly' && pattern !== 'yearly') throw new Error('Invalid recurrence pattern');
  const month = pattern === 'yearly' ? p.month : p.month === 12 ? 1 : p.month + 1;
  const year = p.year + (pattern === 'yearly' || p.month === 12 ? 1 : 0);
  return fromSingaporeParts({ year, month, day: Math.min(p.day, daysInMonth(year, month)) }, p.hour, p.minute, p.second, p.millisecond);
}
