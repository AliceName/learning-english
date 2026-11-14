export class InvalidBody extends Error {
  constructor(public status: 400 | 413) { super("Invalid request body"); }
}

export async function readJsonBody(request: Request, limit: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidBody(400);
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new InvalidBody(413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new InvalidBody(400);
    return data;
  } catch (error) { throw error instanceof InvalidBody ? error : new InvalidBody(400); }
  finally { reader.releaseLock(); }
}
