/**
 * Alias for GET /api/fix-strategies/findings?…
 *
 * Without this static segment, `/findings/list` falls into `[id]` with
 * id="list", which used to 500 on Postgres uuid parse. The dashboard already
 * calls the collection route; this keeps accidental /list callers safe.
 * #208 did not remove this path — it never existed as a dedicated route.
 */
export { dynamic, GET } from '../route'
