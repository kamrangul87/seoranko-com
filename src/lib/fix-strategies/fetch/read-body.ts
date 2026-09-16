/**
 * Topic 67 — read an HTTP response body to stream completion.
 *
 * Detectors must not classify content from a size- or time-capped prefix.
 * Incomplete reads set streamComplete=false; detectors must refuse to run.
 */

export type BodyReadResult = {
  body: string
  streamComplete: boolean
}

/**
 * Consume the response body stream to completion.
 * On mid-stream failure, returns any bytes already decoded with
 * streamComplete=false (never pretends the prefix is the whole page).
 */
export async function readResponseBodyToCompletion(
  response: Response,
): Promise<BodyReadResult> {
  // No stream body (e.g. some mocks / opaque empty responses): text() is the
  // complete representation.
  if (!response.body) {
    try {
      const body = await response.text()
      return { body, streamComplete: true }
    } catch {
      return { body: '', streamComplete: false }
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return { body, streamComplete: true }
  } catch {
    try {
      body += decoder.decode()
    } catch {
      // ignore flush errors on a failed stream
    }
    return { body, streamComplete: false }
  }
}
