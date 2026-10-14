/** Postgres uuid / finding primary key shape. */
const FINDING_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isFindingId(value: string): boolean {
  return FINDING_ID_RE.test(value)
}
