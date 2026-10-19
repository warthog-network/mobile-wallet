import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { defiColors, defiStyles } from './defi/defiStyles';
import { theme } from '../theme';
import { toast } from '../utils/toast';

type Row = { label: string; value: string };

export type SpendOutcome = { ok: boolean; title: string; message: string };

/** Review, in-sheet progress, and the completion state for a send, swap, or tunnel. */
export function useSpendFlow() {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('Submitting…');
  const [outcome, setOutcome] = useState<SpendOutcome | null>(null);
  const succeeded = useRef(false);

  const begin = (nextStep: string) => {
    succeeded.current = false;
    setOutcome(null);
    setStep(nextStep);
    setBusy(true);
  };

  const finish = (ok: boolean, title: string, message?: string) => {
    const text = message?.trim() || (ok ? 'Done.' : 'Something went wrong.');
    succeeded.current = ok;
    setBusy(false);
    setOutcome({ ok, title, message: text });
    toast.settled(ok ? 'success' : 'error', title, text);
  };

  /** Closes the outcome. Runs `onSuccess` only after a successful finish. */
  const close = (onSuccess?: () => void) => {
    if (busy) return false;
    const ok = succeeded.current;
    succeeded.current = false;
    setOutcome(null);
    if (ok) onSuccess?.();
    return ok;
  };

  return { busy, step, setStep, outcome, begin, finish, close };
}

export default function SpendConfirm({
  open,
  title,
  rows,
  confirmLabel = 'Confirm and send',
  busyLabel = 'Working…',
  step,
  busy,
  outcome,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  rows: Row[];
  confirmLabel?: string;
  busyLabel?: string;
  /** Live status while `busy`. Falls back to `busyLabel`. */
  step?: string;
  busy?: boolean;
  outcome?: SpendOutcome | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const working = Boolean(busy) && !outcome;
  const status = step?.trim() || busyLabel;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open || !outcome?.ok) return undefined;
    const timer = setTimeout(() => cancelRef.current(), 1700);
    return () => clearTimeout(timer);
  }, [open, outcome?.ok, outcome?.title, outcome?.message]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!working) onCancel(); }}
    >
      <View style={defiStyles.modalOverlay}>
        <View style={[defiStyles.modalContent, { margin: 16, padding: 16 }]}>
          <Text style={defiStyles.modalTitle}>{outcome ? outcome.title : title}</Text>
          {outcome ? (
            <View style={styles.progress}>
              <View style={[styles.mark, outcome.ok ? styles.markOk : styles.markBad]}>
                <Text style={[styles.markText, { color: outcome.ok ? defiColors.buy : '#ff8a8a' }]}>
                  {outcome.ok ? '✓' : '!'}
                </Text>
              </View>
              <View style={styles.progressCopy}>
                <Text style={styles.progressText}>{outcome.message}</Text>
                <Text style={styles.progressHint}>
                  {outcome.ok ? 'Closing this in a moment.' : 'Nothing else was sent.'}
                </Text>
              </View>
            </View>
          ) : (
            rows.map((row) => (
              <View key={row.label} style={{ marginBottom: 10, opacity: working ? 0.55 : 1 }}>
                <Text style={defiStyles.label}>{row.label}</Text>
                <Text style={styles.value}>{row.value}</Text>
              </View>
            ))
          )}
          {working ? (
            <View style={styles.progress}>
              <ActivityIndicator color={defiColors.gold} />
              <View style={styles.progressCopy}>
                <Text style={styles.progressTitle}>{status}</Text>
                <Text style={styles.progressHint}>Leave this open until it finishes.</Text>
              </View>
            </View>
          ) : null}
          {outcome ? (
            <TouchableOpacity style={[defiStyles.btn, { marginTop: 8 }]} onPress={onCancel}>
              <Text style={defiStyles.btnText}>{outcome.ok ? 'Done' : 'Close'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[defiStyles.compactBtn, styles.action, working && styles.dim]}
                onPress={onCancel}
                disabled={working}
              >
                <Text style={defiStyles.compactBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[defiStyles.btn, styles.action, working && styles.dim]}
                onPress={onConfirm}
                disabled={working}
              >
                {working ? <ActivityIndicator color="#e4e4e7" /> : (
                  <Text style={defiStyles.btnText}>{confirmLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  value: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  action: {
    flex: 1,
    marginVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  dim: { opacity: 0.7 },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(253, 185, 19, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(253, 185, 19, 0.28)',
  },
  progressCopy: { flex: 1, minWidth: 0 },
  progressTitle: {
    color: defiColors.gold,
    fontSize: 14,
    fontWeight: '700',
  },
  progressText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
  },
  progressHint: {
    marginTop: 3,
    color: defiColors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOk: { borderColor: defiColors.buy },
  markBad: { borderColor: '#ff8a8a' },
  markText: { fontSize: 14, fontWeight: '700' },
});
