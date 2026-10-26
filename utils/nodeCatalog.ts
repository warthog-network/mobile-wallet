import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFI_TESTNET_URL, WARTNODE_MAINNET_URL, WARTNODE_TESTNET_URL } from '../constants';
import { normalizeNodeUrl } from './nodes';

export type NodeNetwork = 'mainnet' | 'defi-testnet';

export type WalletNode = {
  url: string;
  name: string;
  network: NodeNetwork;
};

/** One remembered node per family, by URL. */
export type NodeSelection = Record<NodeNetwork, string>;

export type NodeCatalog = {
  nodes: WalletNode[];
  selection: NodeSelection;
  activeUrl: string;
};

const KEY = 'warthogNodeCatalog';

/** The four nodes this app shipped before the list could be edited. */
export const DEFAULT_NODES: WalletNode[] = [
  { url: 'https://warthognode.duckdns.org', name: 'Mainnet', network: 'mainnet' },
  { url: WARTNODE_MAINNET_URL, name: 'Wartnode Mainnet', network: 'mainnet' },
  { url: DEFI_TESTNET_URL, name: 'DeFi Testnet', network: 'defi-testnet' },
  { url: WARTNODE_TESTNET_URL, name: 'Wartnode Testnet', network: 'defi-testnet' },
];

/** Built-in nodes the presets button can add. Same set as the extension. */
export const PRESET_NODES: WalletNode[] = [
  ...DEFAULT_NODES,
  { url: 'http://104.251.219.14:3001', name: 'Testnet', network: 'defi-testnet' },
];

export const DEFAULT_CATALOG: NodeCatalog = {
  nodes: DEFAULT_NODES,
  selection: {
    mainnet: DEFAULT_NODES[0].url,
    'defi-testnet': DEFAULT_NODES[2].url,
  },
  activeUrl: DEFAULT_NODES[0].url,
};

export function familyLabel(network: NodeNetwork): string {
  return network === 'mainnet' ? 'Mainnet' : 'DeFi Testnet';
}

export function labelForNodeUrl(url: string): string {
  const wanted = normalizeNodeUrl(url);
  const preset = PRESET_NODES.find((node) => normalizeNodeUrl(node.url) === wanted);
  if (preset) return preset.name;
  try {
    return new URL(wanted).host || url;
  } catch {
    return url;
  }
}

/** Trim, drop trailing slashes, and add a scheme when the user left it off. */
export function canonicalizeNodeUrl(input: string): string {
  let normalized = String(input || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) normalized = `http://${normalized}`;
  return normalized;
}

export function isHttpNodeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanNode(value: unknown): WalletNode | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { url?: unknown; name?: unknown; network?: unknown };
  if (typeof record.url !== 'string') return null;
  if (record.network !== 'mainnet' && record.network !== 'defi-testnet') return null;
  const url = canonicalizeNodeUrl(record.url);
  if (!isHttpNodeUrl(url)) return null;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  return { url, name: name || labelForNodeUrl(url), network: record.network };
}

function selectionFor(nodes: WalletNode[], remembered: Partial<NodeSelection> | null): NodeSelection {
  const pick = (family: NodeNetwork, url: string | undefined): string => {
    const wanted = normalizeNodeUrl(url || '');
    const found = nodes.find((node) => node.network === family && normalizeNodeUrl(node.url) === wanted);
    return found?.url ?? '';
  };
  return {
    mainnet: pick('mainnet', remembered?.mainnet),
    'defi-testnet': pick('defi-testnet', remembered?.['defi-testnet']),
  };
}

export async function loadNodeCatalog(): Promise<NodeCatalog> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {
      nodes: DEFAULT_CATALOG.nodes.map((node) => ({ ...node })),
      selection: { ...DEFAULT_CATALOG.selection },
      activeUrl: DEFAULT_CATALOG.activeUrl,
    };
    const parsed = JSON.parse(raw) as { nodes?: unknown; selection?: unknown; activeUrl?: unknown };
    const nodes: WalletNode[] = [];
    const seen = new Set<string>();
    if (Array.isArray(parsed.nodes)) {
      for (const entry of parsed.nodes) {
        const node = cleanNode(entry);
        if (!node) continue;
        const key = normalizeNodeUrl(node.url).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push(node);
      }
    }
    if (!nodes.length) {
      return {
        nodes: DEFAULT_CATALOG.nodes.map((node) => ({ ...node })),
        selection: { ...DEFAULT_CATALOG.selection },
        activeUrl: DEFAULT_CATALOG.activeUrl,
      };
    }
    const remembered = parsed.selection && typeof parsed.selection === 'object'
      ? parsed.selection as Partial<NodeSelection>
      : null;
    const selection = selectionFor(nodes, remembered);
    const activeWanted = typeof parsed.activeUrl === 'string' ? normalizeNodeUrl(parsed.activeUrl) : '';
    const active = nodes.find((node) => normalizeNodeUrl(node.url) === activeWanted) ?? nodes[0];
    return { nodes, selection, activeUrl: active.url };
  } catch {
    return {
      nodes: DEFAULT_CATALOG.nodes.map((node) => ({ ...node })),
      selection: { ...DEFAULT_CATALOG.selection },
      activeUrl: DEFAULT_CATALOG.activeUrl,
    };
  }
}

export async function saveNodeCatalog(catalog: NodeCatalog): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(catalog));
}

export type MergeResult = { added: WalletNode[]; kept: number; skipped: number };

/** Add nodes that are not already in either family. Existing names stay. */
export function mergeNodes(existing: WalletNode[], incoming: WalletNode[]): MergeResult {
  const byUrl = new Map<string, WalletNode>();
  for (const node of existing) byUrl.set(normalizeNodeUrl(node.url).toLowerCase(), node);
  const added: WalletNode[] = [];
  let kept = 0;
  let skipped = 0;
  for (const node of incoming) {
    const key = normalizeNodeUrl(node.url).toLowerCase();
    const found = byUrl.get(key);
    if (found) {
      if (found.network === node.network) kept += 1;
      else skipped += 1;
      continue;
    }
    const clean = cleanNode(node);
    if (!clean) continue;
    byUrl.set(key, clean);
    added.push(clean);
  }
  return { added, kept, skipped };
}
