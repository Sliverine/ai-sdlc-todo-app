export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean }

export async function readLimitedJson(request: Request, maximumBytes = 64 * 1024): Promise<LimitedJsonResult> {
  const reader = request.body?.getReader()
  if (!reader) return { ok: false, tooLarge: false }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel()
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) as unknown }
  } catch {
    return { ok: false, tooLarge: false }
  } finally {
    reader.releaseLock()
  }
}