import { type NodeNetwork, type WalletNode } from './nodeCatalog';
import { labelForNodeUrl, canonicalizeNodeUrl, isHttpNodeUrl } from './nodeCatalog';

const PUBLIC_DATA_BASE = 'https://data.warthog.network';

const SOURCE_FOR_FAMILY: Record<NodeNetwork, string> = {
  mainnet: '/legacy-nodes.json',
  'defi-testnet': '/defi-nodes.json',
};

/** The public list for one family. The file decides the family, not the URL. */
export async function fetchPublicNodes(family: NodeNetwork): Promise<WalletNode[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${PUBLIC_DATA_BASE}${SOURCE_FOR_FAMILY[family]}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { nodes?: unknown };
    if (!body || !Array.isArray(body.nodes)) throw new Error('unexpected shape');
    const nodes: WalletNode[] = [];
    for (const entry of body.nodes) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as { url?: unknown; name?: unknown };
      if (typeof record.url !== 'string') continue;
      const url = canonicalizeNodeUrl(record.url);
      if (!isHttpNodeUrl(url)) continue;
      const rawName = typeof record.name === 'string' ? record.name.trim() : '';
      nodes.push({ url, name: rawName || labelForNodeUrl(url), network: family });
    }
    return nodes;
  } finally {
    clearTimeout(timer);
  }
}
