/**
 * Helpers for the "empty success" bug class: supabase-js sets `data: null`
 * on error, so `!data?.length` looks like a legitimate empty result unless
 * `error` is checked first.
 */

export type SupabaseResultLike<T> = {
  data: T
  error: { message: string } | null
}

/** Throw (or return) when a query failed — never treat error as empty data. */
export function supabaseDataOrThrow<T>(
  result: SupabaseResultLike<T>,
  context: string,
): T {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`)
  }
  return result.data
}

export function supabaseErrorMessage(
  error: { message: string } | null | undefined,
): string | null {
  return error?.message ?? null
}
