import { NodeVersion, WarthogDeFiApi, WarthogLegacyApi } from 'warthog-ts';
import type { WalletNode } from './nodeCatalog';

function formatVersion(version: NodeVersion): string {
  const dotted = version.version;
  if (!dotted) return '';
  const hash = String(version.commit ?? '').trim();
  if (!hash || hash === dotted || hash === 'unknown') return `v${dotted}`;
  const short = hash.length > 8 ? hash.slice(0, 7) : hash;
  return `v${dotted} ${short}`;
}

/** Ask a node for its version. The family's client is chosen from the record, not the host name. */
export async function probeNode(node: WalletNode): Promise<{ online: boolean; latencyMs: number; version: string }> {
  const start = Date.now();
  try {
    const api = node.network === 'defi-testnet'
      ? new WarthogDeFiApi(node.url)
      : new WarthogLegacyApi(node.url);
    const result = await api.getNodeVersion();
    const latencyMs = Date.now() - start;
    if (!result.success || !result.data) return { online: false, latencyMs, version: '' };
    return { online: true, latencyMs, version: formatVersion(result.data) };
  } catch {
    return { online: false, latencyMs: Date.now() - start, version: '' };
  }
}
