import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { defiColors, defiStyles } from '../defi/defiStyles';

/** Rename the open account. Save, download, and delete stay on this screen. */
export default function AccountNamePane({
  name,
  ledger,
  saved,
  deleting,
  onBack,
  onRename,
  onSaveDevice,
  onDownload,
  onDelete,
}: {
  name: string;
  ledger: boolean;
  saved: boolean;
  deleting?: boolean;
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onSaveDevice?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setDraft(name); }, [name]);

  const save = async () => {
    setError('');
    try {
      await onRename(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    }
  };

  return (
    <View>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to settings">
        <Text style={back}>‹ Settings</Text>
      </TouchableOpacity>
      <Text style={title}>Account name</Text>
      <Text style={hint}>
        {ledger
          ? 'This name is how the phone lists the Nano. The key stays on the device.'
          : saved
            ? 'This name is how the phone lists the wallet at the next login.'
            : 'This session is not saved yet. The name is kept until you close it, and saved with the wallet.'}
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Account name"
        placeholderTextColor="#71717a"
        autoCapitalize="none"
        autoCorrect={false}
        style={defiStyles.input}
        accessibilityLabel="Account name"
      />
      <TouchableOpacity
        style={[defiStyles.compactBtn, !draft.trim() && { opacity: 0.45 }]}
        disabled={!draft.trim()}
        onPress={() => { void save(); }}
        accessibilityRole="button"
        accessibilityLabel="Save name"
      >
        <Text style={[defiStyles.compactBtnText, { color: defiColors.gold }]}>Save name</Text>
      </TouchableOpacity>
      {error ? <Text style={errorText}>{error}</Text> : null}

      {onSaveDevice ? (
        <TouchableOpacity style={row} onPress={onSaveDevice} accessibilityRole="button">
          <Text style={rowTitle}>Save to device</Text>
          <Text style={rowDetail}>Keep this wallet for the next login.</Text>
        </TouchableOpacity>
      ) : null}
      {onDownload ? (
        <TouchableOpacity style={row} onPress={onDownload} accessibilityRole="button">
          <Text style={rowTitle}>Download encrypted file</Text>
          <Text style={rowDetail}>A backup encrypted with a password you choose.</Text>
        </TouchableOpacity>
      ) : null}
      {onDelete && (saved || ledger) ? (
        confirming ? (
          <View style={row}>
            <Text style={rowDetail}>
              {ledger
                ? `Remove "${name}" from this phone? The key stays on the Nano.`
                : `Delete "${name}" from this phone? The coins stay on the chain. You need the seed or key to open it again.`}
            </Text>
            <View style={actions}>
              <TouchableOpacity style={defiStyles.compactBtn} onPress={() => setConfirming(false)} disabled={deleting}>
                <Text style={defiStyles.compactBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={defiStyles.compactBtn} onPress={onDelete} disabled={deleting} accessibilityRole="button" accessibilityLabel="Delete forever">
                <Text style={[defiStyles.compactBtnText, { color: '#fb7185' }]}>{deleting ? 'Deleting…' : 'Delete forever'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={row} onPress={() => setConfirming(true)} accessibilityRole="button">
            <Text style={[rowTitle, { color: '#fb7185' }]}>{ledger ? 'Remove Ledger name' : 'Delete from this phone'}</Text>
          </TouchableOpacity>
        )
      ) : null}
    </View>
  );
}

const back = { color: '#FDB913', fontSize: 13, fontWeight: '600' as const, marginBottom: 12 };
const title = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 8 };
const hint = { color: defiColors.textSecondary, fontSize: 12, marginBottom: 12, lineHeight: 18 };
const errorText = { color: '#fb7185', fontSize: 12, marginTop: 8 };
const row = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(255,255,255,0.03)',
  borderRadius: 14,
  padding: 14,
  marginTop: 10,
};
const rowTitle = { color: '#fafafa', fontSize: 14, fontWeight: '600' as const };
const rowDetail = { color: defiColors.textSecondary, fontSize: 11, marginTop: 3, lineHeight: 16 };
const actions = { flexDirection: 'row' as const, gap: 8, marginTop: 10 };
