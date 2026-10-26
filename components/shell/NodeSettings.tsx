import React, { useEffect, useState } from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { defiColors, defiStyles } from '../defi/defiStyles';
import {
  canonicalizeNodeUrl,
  familyLabel,
  isHttpNodeUrl,
  labelForNodeUrl,
  mergeNodes,
  PRESET_NODES,
  type NodeNetwork,
  type NodeSelection,
  type WalletNode,
} from '../../utils/nodeCatalog';
import { normalizeNodeUrl } from '../../utils/nodes';
import { probeNode } from '../../utils/nodeProbe';
import { fetchPublicNodes } from '../../utils/publicNodes';

type Probe = { status: 'pending' | 'online' | 'offline'; latencyMs: number; version: string };

const FAMILIES = [
  ['mainnet', 'Mainnet'],
  ['defi-testnet', 'DeFi Testnet'],
] as const;

/** Mainnet and DeFi Testnet node list, matching the extension's node screen. */
export default function NodeSettings({
  nodes,
  selection,
  activeUrl,
  onBack,
  onSelect,
  onChange,
}: {
  nodes: WalletNode[];
  selection: NodeSelection;
  activeUrl: string;
  onBack: () => void;
  onSelect: (node: WalletNode) => void;
  onChange: (nodes: WalletNode[]) => void;
}) {
  const active = nodes.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(activeUrl));
  const [tab, setTab] = useState<NodeNetwork>(active?.network ?? 'mainnet');
  const [query, setQuery] = useState('');
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [message, setMessage] = useState('');
  const [updating, setUpdating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newNetwork, setNewNetwork] = useState<NodeNetwork>(tab);
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (active) setTab(active.network);
  }, [activeUrl, active]);

  const probeKey = nodes.map((node) => `${node.network}|${normalizeNodeUrl(node.url)}`).join('\n');
  useEffect(() => {
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const run = (node: WalletNode) => {
      void probeNode(node).then((result) => {
        if (cancelled) return;
        const key = normalizeNodeUrl(node.url);
        setProbes((prev) => ({
          ...prev,
          [key]: {
            status: result.online ? 'online' : 'offline',
            latencyMs: result.latencyMs,
            version: result.version,
          },
        }));
        const timer = setTimeout(() => run(node), 30000);
        timers.add(timer);
      });
    };
    nodes.forEach(run);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [probeKey, nodes]);

  const needle = query.trim().toLowerCase();
  const visible = nodes.filter((node) => {
    if (node.network !== tab) return false;
    if (!needle) return true;
    return node.name.toLowerCase().includes(needle) || node.url.toLowerCase().includes(needle);
  });
  const tabHasNodes = nodes.some((node) => node.network === tab);
  const tabSelected = nodes.some((node) => node.network === tab && normalizeNodeUrl(node.url) === normalizeNodeUrl(activeUrl));

  const openFamily = (family: NodeNetwork) => {
    setTab(family);
    const remembered = selection[family];
    const node = nodes.find((item) => item.network === family && normalizeNodeUrl(item.url) === normalizeNodeUrl(remembered));
    if (node) onSelect(node);
  };

  const addPresets = () => {
    const incoming = PRESET_NODES.filter((node) => node.network === tab);
    const result = mergeNodes(nodes, incoming);
    if (result.added.length) onChange([...nodes, ...result.added]);
    setMessage(result.added.length
      ? `Added ${result.added.length} ${familyLabel(tab)} preset${result.added.length === 1 ? '' : 's'}.`
      : `Already up to date. The ${familyLabel(tab)} presets are in the list.`);
  };

  const updatePublic = async () => {
    if (updating) return;
    setUpdating(true);
    setMessage('');
    try {
      const incoming = await fetchPublicNodes(tab);
      const result = mergeNodes(nodes, incoming);
      if (result.added.length) onChange([...nodes, ...result.added]);
      const parts: string[] = [];
      if (result.added.length) parts.push(`Added ${result.added.length} node${result.added.length === 1 ? '' : 's'} from the public list.`);
      if (result.skipped) parts.push(`Skipped ${result.skipped} node${result.skipped === 1 ? '' : 's'} already in the list on the other network.`);
      setMessage(parts.length ? parts.join(' ') : 'Already up to date. The public list has no new nodes.');
    } catch {
      setMessage('Could not reach the public node list. Check the network and try again.');
    } finally {
      setUpdating(false);
    }
  };

  const remove = (node: WalletNode) => {
    if (nodes.length <= 1) {
      setMessage('Keep at least one node.');
      return;
    }
    onChange(nodes.filter((item) => normalizeNodeUrl(item.url) !== normalizeNodeUrl(node.url)));
  };

  const addNode = () => {
    const url = canonicalizeNodeUrl(newUrl);
    const duplicate = nodes.some((node) => normalizeNodeUrl(node.url).toLowerCase() === url.toLowerCase());
    if (!isHttpNodeUrl(url) || duplicate) {
      setWarning(true);
      return;
    }
    onChange([...nodes, { url, name: newName.trim() || labelForNodeUrl(url), network: newNetwork }]);
    setAdding(false);
    setNewName('');
    setNewUrl('');
    setWarning(false);
    setTab(newNetwork);
  };

  return (
    <View>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to settings">
        <Text style={back}>‹ Settings</Text>
      </TouchableOpacity>
      <Text style={title}>Warthog nodes</Text>
      <Text style={hint}>RPC endpoints for Mainnet and DeFi Testnet.</Text>
      <View style={chipRow}>
        {FAMILIES.map(([id, label]) => {
          const on = tab === id;
          return (
            <TouchableOpacity
              key={id}
              style={[defiStyles.compactBtn, on && defiStyles.compactBtnActive]}
              onPress={() => openFamily(id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label} nodes`}
            >
              <Text style={[defiStyles.compactBtnText, on && defiStyles.compactBtnTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor="#71717a"
        autoCapitalize="none"
        autoCorrect={false}
        style={defiStyles.input}
        accessibilityLabel="Search nodes"
      />
      <View style={linkRow}>
        <TouchableOpacity onPress={addPresets} accessibilityRole="button">
          <Text style={link}>+ {familyLabel(tab)} presets</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { void updatePublic(); }} disabled={updating} accessibilityRole="button">
          <Text style={[link, updating && { opacity: 0.45 }]}>{updating ? 'Updating…' : 'Update from public data'}</Text>
        </TouchableOpacity>
      </View>
      {message ? <Text style={note}>{message}</Text> : null}
      {!tabSelected ? (
        <Text style={warn}>
          No {familyLabel(tab)} node selected. {tabHasNodes ? 'Pick one to use this network.' : 'Add one to use this network.'}
        </Text>
      ) : null}
      {visible.length ? visible.map((node) => {
        const on = normalizeNodeUrl(node.url) === normalizeNodeUrl(activeUrl);
        const probe = probes[normalizeNodeUrl(node.url)];
        const status = probe?.status ?? 'pending';
        const dot = status === 'online' ? '#34d399' : status === 'offline' ? '#fb7185' : '#fbbf24';
        return (
          <TouchableOpacity
            key={`${node.network}:${node.url}`}
            style={[card, on && cardOn]}
            onPress={() => onSelect(node)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <View style={[dotStyle, { backgroundColor: dot }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={cardTitle} numberOfLines={1}>
                {node.name}{probe?.version ? `  ${probe.version}` : ''}
              </Text>
              <Text style={cardUrl} numberOfLines={1}>{node.url.replace(/^https?:\/\//, '')}</Text>
            </View>
            {probe && probe.latencyMs > 0 ? <Text style={latency}>{Math.round(probe.latencyMs)}ms</Text> : null}
            <TouchableOpacity onPress={() => remove(node)} accessibilityRole="button" accessibilityLabel={`Remove ${node.name}`}>
              <Text style={removeText}>Remove</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      }) : (
        <Text style={note}>{tabHasNodes ? 'No nodes found' : 'No nodes yet'}</Text>
      )}
      <TouchableOpacity
        style={[defiStyles.compactBtn, { marginTop: 8 }]}
        onPress={() => { setNewNetwork(tab); setWarning(false); setAdding(true); }}
        accessibilityRole="button"
        accessibilityLabel="Add node"
      >
        <Text style={[defiStyles.compactBtnText, { color: defiColors.gold }]}>+ Add more nodes</Text>
      </TouchableOpacity>

      <Modal visible={adding} transparent animationType="none" onRequestClose={() => setAdding(false)}>
        <View style={overlay}>
          <View style={dialog}>
            <Text style={title}>Add new node</Text>
            <Text style={hint}>
              Mainnet example: https://warthognode.duckdns.org{'\n'}
              DeFi testnet: https://warthog-defitestnet.duckdns.org
            </Text>
            <Text style={hint}>Which network is this node on?</Text>
            <View style={chipRow}>
              {FAMILIES.map(([id, label]) => {
                const on = newNetwork === id;
                return (
                  <TouchableOpacity key={id} style={[defiStyles.compactBtn, on && defiStyles.compactBtnActive]} onPress={() => setNewNetwork(id)}>
                    <Text style={[defiStyles.compactBtnText, on && defiStyles.compactBtnTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput value={newName} onChangeText={setNewName} placeholder="Node name" placeholderTextColor="#71717a" style={defiStyles.input} accessibilityLabel="Node name" />
            <TextInput
              value={newUrl}
              onChangeText={(value) => { setNewUrl(value); setWarning(false); }}
              placeholder="Node address"
              placeholderTextColor="#71717a"
              autoCapitalize="none"
              autoCorrect={false}
              style={defiStyles.input}
              accessibilityLabel="Node address"
            />
            {warning ? <Text style={errorText}>Please enter a valid, unique node URL</Text> : null}
            <View style={linkRow}>
              <TouchableOpacity style={[defiStyles.compactBtn, { flex: 1 }]} onPress={() => setAdding(false)}>
                <Text style={defiStyles.compactBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[defiStyles.compactBtn, { flex: 1 }]} onPress={addNode} accessibilityRole="button" accessibilityLabel="Add this node">
                <Text style={[defiStyles.compactBtnText, { color: defiColors.gold }]}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const back = { color: '#FDB913', fontSize: 13, fontWeight: '600' as const, marginBottom: 12 };
const title = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 8 };
const hint = { color: defiColors.textSecondary, fontSize: 12, marginBottom: 12, lineHeight: 18 };
const note = { color: '#71717a', fontSize: 12, marginBottom: 8 };
const warn = { color: '#fbbf24', fontSize: 12, marginBottom: 8, lineHeight: 17 };
const chipRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 10 };
const linkRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 14, marginBottom: 10 };
const link = { color: defiColors.gold, fontSize: 12, textDecorationLine: 'underline' as const };
const card = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 8,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(255,255,255,0.03)',
  borderRadius: 14,
  padding: 12,
  marginBottom: 8,
};
const cardOn = { borderColor: 'rgba(253,185,19,0.7)', backgroundColor: 'rgba(253,185,19,0.08)' };
const cardTitle = { color: '#fafafa', fontSize: 14, fontWeight: '600' as const };
const cardUrl = { color: '#71717a', fontSize: 11, marginTop: 2 };
const latency = { color: '#71717a', fontSize: 11 };
const removeText = { color: '#a1a1aa', fontSize: 11, padding: 4 };
const dotStyle = { width: 8, height: 8, borderRadius: 4 };
const errorText = { color: '#fb7185', fontSize: 12, marginBottom: 8 };
const overlay = {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.55)',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: 20,
};
const dialog = {
  width: '100%' as const,
  maxWidth: 360,
  backgroundColor: '#1A1A1A',
  borderRadius: 16,
  padding: 16,
};
