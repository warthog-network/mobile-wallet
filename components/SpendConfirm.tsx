import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { defiStyles } from './defi/defiStyles';
import { theme } from '../theme';

type Row = { label: string; value: string };

export default function SpendConfirm({
  open,
  title,
  rows,
  confirmLabel = 'Confirm and send',
  busyLabel = 'Sending…',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  rows: Row[];
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={defiStyles.modalOverlay}>
        <View style={[defiStyles.modalContent, { margin: 16, padding: 16 }]}>
          <Text style={defiStyles.modalTitle}>{title}</Text>
          {rows.map((row) => (
            <View key={row.label} style={{ marginBottom: 10 }}>
              <Text style={defiStyles.label}>{row.label}</Text>
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.fontFamily.mono,
                  fontSize: 13,
                }}
              >
                {row.value}
              </Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={[defiStyles.compactBtn, { flex: 1 }]}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={defiStyles.compactBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[defiStyles.btn, { flex: 1, marginVertical: 0 }]}
              onPress={onConfirm}
              disabled={busy}
            >
              <Text style={defiStyles.btnText}>
                {busy ? busyLabel : confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
