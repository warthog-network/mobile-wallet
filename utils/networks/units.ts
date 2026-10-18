/** Decimal text to an integer of `decimals` places. Rejects scientific notation. */
export function parseUnits(amount: string, decimals: number, name: string): bigint {
  const text = amount.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(text)) {
    throw new Error(`Enter a ${name} amount with at most ${decimals} decimals.`);
  }
  const [whole, frac = ''] = text.split('.');
  const padded = frac.padEnd(decimals, '0');
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
  if (value <= 0n) throw new Error('Amount must be greater than zero.');
  return value;
}

export function formatUnits(raw: bigint, decimals: number): string {
  if (raw === 0n) return '0';
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
