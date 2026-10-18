const TIMEOUT_MS = 20_000;

export async function networkFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('The network timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function explainChainError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Could not complete that.';
  if (/insufficient funds|not enough/i.test(message)) {
    return 'Not enough for that amount and the network fee.';
  }
  if (/timeout|timed out|aborted|network request failed/i.test(message)) {
    return 'The network timed out. Try again.';
  }
  return message.replace(/^error:\s*/i, '').slice(0, 280);
}
