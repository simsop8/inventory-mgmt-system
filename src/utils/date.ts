// Convert YYYY-MM-DD or ISO string to DD-MM-YYYY
export const fd = (d?: string) => {
  if (!d) return '—';
  const s = d.includes('T') ? d.split('T')[0] : d;
  const p = s.split('-');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s;
};

export const todayISO = () => new Date().toISOString().split('T')[0];

// Lease end date for a fixed term: N months after the start date, minus a day
// (a "24 month" lease starting 1 Jan runs through 31 Dec the following year,
// not 1 Jan). Handles month-length overflow (e.g. 31 Jan + 1 month clamps to
// 28/29 Feb instead of rolling into March).
export function calcLeaseEndDate(startISO: string, months: number): string {
  const [y, m, d] = startISO.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const targetMonthIndex = start.getMonth() + months;
  const end = new Date(start.getFullYear(), targetMonthIndex, start.getDate());
  if (end.getMonth() !== ((targetMonthIndex % 12) + 12) % 12) {
    end.setDate(0); // rolled over — clamp back to the last day of the intended month
  }
  end.setDate(end.getDate() - 1);
  const yyyy = end.getFullYear();
  const mm = String(end.getMonth() + 1).padStart(2, '0');
  const dd = String(end.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
