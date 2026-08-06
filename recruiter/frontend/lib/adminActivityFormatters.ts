export type ActivityTrendInterval = 'day' | 'month';

export function formatTrendDate(value: unknown, interval: ActivityTrendInterval) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return 'Unknown';

  let displayInterval = interval;
  let date: Date;

  if (/^\d{4}-\d{2}$/.test(rawValue)) {
    displayInterval = 'month';
    date = new Date(`${rawValue}-01T00:00:00Z`);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    displayInterval = 'day';
    date = new Date(`${rawValue}T00:00:00Z`);
  } else if (value instanceof Date || typeof value === 'number') {
    date = new Date(value);
  } else {
    date = new Date(rawValue);
  }

  if (Number.isNaN(date.getTime())) return rawValue;

  return new Intl.DateTimeFormat('en-GB', displayInterval === 'month'
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date);
}
