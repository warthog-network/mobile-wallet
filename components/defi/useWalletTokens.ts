import { useCallback, useEffect, useState } from 'react';
import {
  defaultsFor,
  readCustomTokens,
  subscribeTokens,
  type TokenNetwork,
  type WalletToken,
} from '../../utils/walletTokens';

/** Default tokens plus any the user added on this device. */
export function useWalletTokens(network: TokenNetwork): { tokens: WalletToken[]; reload: () => Promise<void> } {
  const [tokens, setTokens] = useState<WalletToken[]>(() => defaultsFor(network));

  const reload = useCallback(async () => {
    const custom = await readCustomTokens(network);
    const defaults = defaultsFor(network);
    const seen = new Set(defaults.map((token) => token.id));
    setTokens([...defaults, ...custom.filter((token) => !seen.has(token.id))]);
  }, [network]);

  useEffect(() => {
    void reload();
    return subscribeTokens(() => { void reload(); });
  }, [reload]);

  return { tokens, reload };
}
