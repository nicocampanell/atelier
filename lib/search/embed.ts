// The single embedding entry point. No EMBEDDING_API_KEY -> null -> keyword-only search.
export type EmbedInput = { text: string } | { image: { bytes: Uint8Array; mediaType: string } };
export type Embedder = (input: EmbedInput) => Promise<number[] | null> | number[] | null;

let fake: Embedder | null = null;

/** Tests inject a fake embedder; pass null to remove it. */
export function setEmbedderForTests(fn: Embedder | null): void {
  fake = fn;
}

/** True when an embedding provider key is configured (or a test embedder is set). */
export function isSemanticEnabled(): boolean {
  return fake !== null || Boolean(process.env.EMBEDDING_API_KEY);
}

export async function embed(input: EmbedInput): Promise<number[] | null> {
  if (fake) return (await fake(input)) ?? null;
  const key = process.env.EMBEDDING_API_KEY;
  if (!key) return null;
  // TODO(provider): the provider and model name could not be verified against
  // current official documentation, so no real call is made yet. Implement the
  // HTTP request here (key from env only; never log the key or the input) and
  // return the vector. Until then semantic search stays off in practice.
  void input;
  return null;
}
