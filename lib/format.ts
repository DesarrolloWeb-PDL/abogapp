/**
 * Date formatting shared by every screen — one helper, so the list and the
 * detail view can never disagree again.
 *
 * A `YYYY-MM-DD` value is rendered by splitting the string, never through
 * `new Date(...)`: date-only ISO strings are UTC midnight, which shows the
 * previous day in UTC−3. Full timestamps keep the local-time render.
 */
export function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
