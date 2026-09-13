import { DEFI_TESTNET_URL, WARTHOG_NODES, type NodeUrl } from '../constants';

export function normalizeNodeUrl(node: string): string {
  return node.replace(/\/$/, '');
}

/** True for DeFi / testnet nodes (wart_balance, DEX, assets). */
export function isDefiNode(node: string): boolean {
  const n = normalizeNodeUrl(node).toLowerCase();
  if (!n) return false;
  if (n === normalizeNodeUrl(DEFI_TESTNET_URL).toLowerCase()) return true;
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
  [DEFI_TESTNET_URL]: 'DeFi Testnet',
};

export function getNodeLabel(node: NodeUrl): string {
  return NODE_LABELS[node] ?? node;
}

export { WARTHOG_NODES };