import { Price, TokenDecimals } from 'warthog-ts';

/**
 * Encode a human-readable limit price (WART per 1 token) to the 6-char hex
 * the node expects for limit swaps. Client-side only — no API call.
 *
 * Mirrors wartbunker `encodeLimitPriceHex` / warthog-js Price.fromNumberPrecision.
 * warthog-ts 0.4.3 still provides Price.fromNumberDecimals; this wrapper is app code.
 */
export function encodeLimitPrice(
  priceStr: string | number,
  decimals: number | string = 8,
  options: { ceil?: boolean } = {},
): string {
  const ceil = options.ceil === true;
  const normalized = String(priceStr).trim().replace(',', '.');
  const price = parseFloat(normalized);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Please enter a valid price greater than 0');
  }

  const precisionValue = Math.min(
    Math.max(parseInt(String(decimals), 10) || 8, 0),
    18,
  );
  const prec = new TokenDecimals(precisionValue);
  const encoded = Price.fromNumberDecimals(price, prec, ceil);
  if (!encoded) {
    throw new Error('Price is out of encodable range');
  }

  const hex = encoded.toHex();
  if (hex.length !== 6) {
    throw new Error('Invalid encoded price length');
  }
  return hex;
}
