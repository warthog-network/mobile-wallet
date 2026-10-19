/** Home-screen chains. Tokens for a chain render only while it is selected. */
export type WalletChain = 'wart' | 'ethereum' | 'bitcoin' | 'hemi' | 'solana';

export function chainsForWallet(
  wallet: { ethAddress?: string; btcAddress?: string; solAddress?: string },
  ledger: boolean,
): WalletChain[] {
  const phrase = Boolean(wallet.btcAddress || wallet.solAddress);
  const chains: WalletChain[] = ['wart'];
  if (wallet.ethAddress || ledger) chains.push('ethereum');
  if (phrase || ledger) chains.push('bitcoin');
  if (wallet.ethAddress || phrase || ledger) chains.push('hemi');
  if (phrase || ledger) chains.push('solana');
  return chains;
}

/** A chain whose home card can swap or tunnel. */
export function chainHasSwap(
  chain: WalletChain,
  input: { ethAddress?: string; btcAddress?: string; solAddress?: string; defi: boolean },
): boolean {
  if (chain === 'ethereum' || chain === 'hemi') return Boolean(input.ethAddress);
  if (chain === 'bitcoin') return Boolean(input.btcAddress && input.ethAddress);
  if (chain === 'solana') return Boolean(input.solAddress);
  if (chain === 'wart') return input.defi;
  return false;
}
