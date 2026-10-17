export class ExchangeError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ExchangeError';
    this.status = status;
    this.body = body;
  }
}

export function explainBody(body: unknown, status: number): string {
  if (body == null || body === '') return `SafeTrade returned HTTP ${status}.`;
  if (typeof body === 'string') {
    if (/<!DOCTYPE|<html|cloudflare/i.test(body)) {
      return 'SafeTrade blocked this request. Try again from the phone app.';
    }
    return body.slice(0, 400);
  }
  if (typeof body !== 'object') return `SafeTrade returned HTTP ${status}.`;
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();
  }
  if (Array.isArray(record.errors) && record.errors.length) {
    return record.errors.map((item) => String(item)).join('; ').slice(0, 400);
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  return `SafeTrade returned HTTP ${status}.`;
}

export async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'WarthogWallet/1.0');
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    if (/header|user-agent/i.test(message)) {
      headers.delete('User-Agent');
      try {
        response = await fetch(url, { ...init, headers });
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : message;
        throw new ExchangeError(retryMessage, 0, null);
      }
    } else {
      throw new ExchangeError(message, 0, null);
    }
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new ExchangeError(explainBody(body, response.status), response.status, body);
  }
  return body;
}

/** Turn a failed SafeTrade call into the sentence the Tools panel shows. */
export function explainExchangeFailure(err: unknown): string {
  if (err instanceof ExchangeError) {
    const base = err.message || `SafeTrade returned HTTP ${err.status}.`;
    if (/address_not_found/i.test(base)) {
      return 'SafeTrade does not have this address in your address book, so it refused the withdrawal. Clear the email code and tap withdraw again. A code to save the address will be emailed.';
    }
    if (/untrusted_ip|unauthorized ip|ip address|not trusted|whitelist/i.test(base)) {
      return 'SafeTrade accepted the key and rejected the address it saw. Trust this computer’s public IPv4 on that API key. SafeTrade cannot store an IPv6 address, and a phone on cellular data uses a different address.';
    }
    if (err.status === 401 || err.status === 403) {
      return `${base} The request reached SafeTrade. A wrong key or secret, or an address that is listed but not trusted, both look like this.`;
    }
    if (err.status === 0 && /failed to fetch|network request failed|load failed/i.test(base)) {
      return 'The browser blocked the signed SafeTrade call before any IP check. Reload this page from the wallet dev server, then check again.';
    }
    return base;
  }
  const message = err instanceof Error ? err.message : 'SafeTrade request failed.';
  if (/failed to fetch|network request failed|cors|access-control|load failed/i.test(message)) {
    return 'This browser blocked the signed SafeTrade call before any IP check. Use the phone app on the whitelisted network.';
  }
  return message;
}
