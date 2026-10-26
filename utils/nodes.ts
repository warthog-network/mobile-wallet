import { DEFI_TESTNET_URL, WARTNODE_MAINNET_URL, WARTNODE_TESTNET_URL, WARTHOG_NODES, type NodeUrl } from '../constants';

export function normalizeNodeUrl(node: string): string {
  return String(node || '').trim().replace(/\/+$/, '');
}

const familyByUrl = new Map<string, 'mainnet' | 'defi-testnet'>();

/** The node list says which family a URL belongs to. That wins over guessing from the host. */
export function rememberNodeFamilies(nodes: { url: string; network: 'mainnet' | 'defi-testnet' }[]): void {
  familyByUrl.clear();
  for (const node of nodes) {
    const key = normalizeNodeUrl(node.url).toLowerCase();
    if (key) familyByUrl.set(key, node.network);
  }
}

/** True for DeFi / testnet nodes (wart_balance, DEX, assets). */
export function isDefiNode(node: string): boolean {
  const n = normalizeNodeUrl(node).toLowerCase();
  if (!n) return false;
  const known = familyByUrl.get(n);
  if (known) return known === 'defi-testnet';
  if (n === normalizeNodeUrl(DEFI_TESTNET_URL).toLowerCase()) return true;
  if (n === normalizeNodeUrl(WARTNODE_TESTNET_URL).toLowerCase()) return true;
  if (n.includes('defitestnet') || n.includes('testnet')) return true;
  if (n.includes('localhost') || n.includes('127.0.0.1')) return true;
  if (n.includes(':3002')) return true;
  return false;
}

export function isMainnetNode(node: string): boolean {
  return !isDefiNode(node);
}

export const NODE_LABELS: Record<NodeUrl, string> = {
  'https://warthognode.duckdns.org': 'Mainnet',
  [WARTNODE_MAINNET_URL]: 'Wartnode Mainnet',
  [DEFI_TESTNET_URL]: 'DeFi Testnet',
  [WARTNODE_TESTNET_URL]: 'Wartnode Testnet',
};

export function getNodeLabel(node: string): string {
  return NODE_LABELS[node as NodeUrl] ?? node;
}

export { WARTHOG_NODES };