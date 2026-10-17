import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Switch,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { toast } from '../../utils/toast';
import NumberDisplaySettings from './NumberDisplaySettings';
import SelectDropdown from '../SelectDropdown';
import { exchangeTool } from './exchangeToolOption';
import { validateWarthogAddressInput } from '../../utils/warthogFormat';
import { defiColors, defiStyles } from '../defi/defiStyles';
import { theme } from '../../theme';

type ToolId = 'security' | 'numbers' | 'exchange' | 'validate';

export type ToolsSecurityStatus = {
  walletName: string;
  hasPasskey: boolean;
  hasPassword: boolean;
  require2fa: boolean;
  biometricsSupported: boolean;
  bioLabel: string;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When logged in — passkey/biometrics + 2FA (wartbunker Tools parity). */
  security?: ToolsSecurityStatus | null;
  securityBusy?: boolean;
  onEnableBiometrics?: (opts: {
    require2fa: boolean;
    password?: string | null;
  }) => Promise<void>;
  onRefreshSecurity?: () => void | Promise<void>;
  wartAddress?: string;
  ethAddress?: string;
  node?: string;
  nextNonce?: number;
  walletWartFree?: string;
  walletWartLocked?: string;
  onWartSent?: (nextNonce: number) => void;
}

const ToolsModal: React.FC<Props> = ({
  visible,
  onClose,
  security = null,
  securityBusy = false,
  onEnableBiometrics,
  onRefreshSecurity,
  wartAddress = '',
  ethAddress = '',
  node = '',
  nextNonce = 0,
  walletWartFree = '',
  walletWartLocked = '',
  onWartSent,
}) => {
  const [activeTool, setActiveTool] = useState<ToolId>('security');
  const [address, setAddress] = useState('');
  const [validateResult, setValidateResult] = useState<ReturnType<
    typeof validateWarthogAddressInput
  > | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [want2fa, setWant2fa] = useState(false);
  const [secPassword, setSecPassword] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (security?.require2fa) setWant2fa(true);
    void onRefreshSecurity?.();
  }, [visible, security?.require2fa, onRefreshSecurity]);

  const showSecurity = Boolean(security && onEnableBiometrics);

  const toolOptions = useMemo(() => {
    const opts: { id: ToolId; label: string }[] = [];
    if (showSecurity) {
      // Label matches wartbunker "Passkey" wording so users find it
      opts.push({ id: 'security', label: 'Passkey / 2FA' });
    }
    opts.push({ id: 'numbers', label: 'Number Display' });
    if (exchangeTool) opts.push({ id: exchangeTool.id, label: exchangeTool.label });
    opts.push({ id: 'validate', label: 'Validate Address' });
    return opts;
  }, [showSecurity]);

  const ExchangeScreen = exchangeTool?.Screen;

  useEffect(() => {
    if (!toolOptions.some((t) => t.id === activeTool)) {
      setActiveTool(toolOptions[0]?.id || 'numbers');
    }
  }, [toolOptions, activeTool]);

  const handleValidateAddress = () => {
    setIsValidating(true);
    try {
      setValidateResult(validateWarthogAddressInput(address));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      setValidateResult({ valid: false, error: message });
    }
    setIsValidating(false);
  };

  const copyAddress = (text: string) => {
    if (!text) return;
    Clipboard.setStringAsync(text);
    toast.success('Copied', 'Address copied to clipboard');
  };

  const runEnable = async (force2fa?: boolean) => {
    if (!onEnableBiometrics || !security) return;
    const twoFactor = force2fa ?? want2fa;
    if (twoFactor && !secPassword.trim() && !security.hasPassword) {
      toast.error(
        'Password needed',
        '2FA needs a password — enter the wallet password below.',
      );
      return;
    }
    try {
      await onEnableBiometrics({
        require2fa: twoFactor,
        password: secPassword.trim() || null,
      });
      setSecPassword('');
      void onRefreshSecurity?.();
    } catch {
      // Parent shows Alert
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={defiStyles.modalOverlay}>
        <ScrollView
          style={defiStyles.modalContent}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={defiStyles.modalAccent} />
          <Text style={defiStyles.modalTitle}>Tools</Text>
          <Text style={styles.intro}>
            Pick one tool. Passkey / 2FA matches wartbunker — your phone chooses how to confirm.
          </Text>

          <SelectDropdown
            value={activeTool}
            options={toolOptions}
            onChange={setActiveTool}
            placeholder="Tool"
            accessibilityLabel="Select tool"
            style={styles.toolDropdown}
          />

          {activeTool === 'security' && security && onEnableBiometrics ? (
            <View
              style={[
                styles.toolPanel,
                security.require2fa
                  ? styles.panel2fa
                  : security.hasPasskey
                    ? styles.panelOk
                    : styles.panelWarn,
              ]}
            >
              <Text style={styles.panelTitle}>Passkey &amp; 2FA</Text>
              <Text style={styles.panelDesc}>
                {Platform.OS === 'web'
                  ? 'Passkey unlock is only in the phone app. This browser saves the wallet with a password.'
                  : `Enable passkey unlock for “${security.walletName || 'this wallet'}”. Optional 2FA = password + passkey every login (same as wartbunker Tools).`}
              </Text>

              {Platform.OS === 'web' ? null : security.require2fa ? (
                <Text style={styles.statusOk}>
                  ✓ 2FA active — password then passkey at login
                </Text>
              ) : security.hasPasskey ? (
                <Text style={styles.statusOk}>
                  ✓ Passkey unlock enabled
                </Text>
              ) : (
                <Text style={styles.panelDesc}>
                  Not enabled yet. Tap enable below — your phone will show its own passkey prompt.
                </Text>
              )}

              {Platform.OS !== 'web' && !security.biometricsSupported ? (
                <Text style={[styles.resultErrText, { marginBottom: 12 }]}>
                  No screen lock detected yet. Set one in system settings, then reopen Tools — or try Enable anyway.
                </Text>
              ) : null}

              {Platform.OS === 'web' ? null : (
              <>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.switchLabel}>Require 2FA</Text>
                  <Text style={styles.switchHint}>
                    Password and passkey every login
                  </Text>
                </View>
                <Switch
                  value={want2fa}
                  onValueChange={setWant2fa}
                  disabled={securityBusy}
                  trackColor={{
                    false: defiColors.borderMuted,
                    true: defiColors.goldHover,
                  }}
                />
              </View>

              {(want2fa || !security.hasPassword) && (
                <>
                  <Text style={styles.inputLabel}>
                    Wallet password{want2fa ? ' (required for 2FA)' : ' (optional)'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={secPassword}
                    onChangeText={setSecPassword}
                    placeholder={want2fa ? 'Password for 2FA' : 'Optional password'}
                    placeholderTextColor={defiColors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    editable={!securityBusy}
                  />
                </>
              )}

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnBlock, securityBusy && styles.actionBtnDisabled]}
                onPress={() => void runEnable(want2fa)}
                disabled={securityBusy}
              >
                {securityBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.actionBtnText}>
                    {want2fa
                      ? security.hasPasskey
                        ? 'Update passkey + 2FA'
                        : 'Enable passkey with 2FA'
                      : security.hasPasskey
                        ? 'Re-register passkey'
                        : 'Enable passkey'}
                  </Text>
                )}
              </TouchableOpacity>

              {security.hasPasskey && !security.require2fa ? (
                <TouchableOpacity
                  style={[styles.actionBtnSecondary, securityBusy && styles.actionBtnDisabled]}
                  onPress={() => {
                    setWant2fa(true);
                    void runEnable(true);
                  }}
                  disabled={securityBusy}
                >
                  <Text style={styles.actionBtnSecondaryText}>
                    Enable 2FA (password + passkey)
                  </Text>
                </TouchableOpacity>
              ) : null}
              </>
              )}
            </View>
          ) : null}

          {activeTool === 'numbers' ? (
            <View style={styles.toolPanel}>
              <NumberDisplaySettings />
            </View>
          ) : null}

          {activeTool === 'exchange' && ExchangeScreen ? (
            <View style={styles.toolPanel}>
              <ExchangeScreen
                wartAddress={wartAddress}
                ethAddress={ethAddress}
                node={node}
                nextNonce={nextNonce}
                walletWartFree={walletWartFree}
                walletWartLocked={walletWartLocked}
                onWartSent={onWartSent}
              />
            </View>
          ) : null}

          {activeTool === 'validate' ? (
            <View style={styles.toolPanel}>
              <Text style={styles.panelTitle}>Validate Address</Text>
              <Text style={styles.panelDesc}>
                Check a Warthog address locally — no node connection required.
              </Text>
              <Text style={styles.inputLabel}>Address</Text>
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={(t) => setAddress(t.trim())}
                placeholder="Enter address"
                placeholderTextColor={defiColors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.actionBtn, (!address || isValidating) && styles.actionBtnDisabled]}
                onPress={handleValidateAddress}
                disabled={isValidating || !address}
              >
                {isValidating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.actionBtnText}>Validate Address</Text>
                )}
              </TouchableOpacity>

              {validateResult ? (
                <View
                  style={[
                    styles.resultBox,
                    validateResult.valid ? styles.resultOk : styles.resultErr,
                  ]}
                >
                  {validateResult.valid ? (
                    <>
                      <Text style={styles.resultOkText}>{validateResult.message}</Text>
                      <Text style={styles.resultMeta}>Address</Text>
                      <TouchableOpacity
                        onPress={() => copyAddress(validateResult.fullAddress || '')}
                      >
                        <Text style={styles.resultAddress}>{validateResult.fullAddress}</Text>
                      </TouchableOpacity>
                      <Text style={styles.resultHint}>Tap to copy</Text>
                    </>
                  ) : (
                    <Text style={styles.resultErrText}>{validateResult.error}</Text>
                  )}
                </View>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity onPress={onClose}>
            <Text style={defiStyles.modalClose}>Close</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
  intro: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
  },
  toolDropdown: {
    marginBottom: theme.spacing.md,
  },
  toolPanel: {
    backgroundColor: defiColors.bgInset,
    borderWidth: 1,
    borderColor: defiColors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  panelOk: {
    borderColor: 'rgba(52, 211, 153, 0.35)',
    backgroundColor: 'rgba(6, 78, 59, 0.2)',
  },
  panel2fa: {
    borderColor: 'rgba(56, 189, 248, 0.4)',
    backgroundColor: 'rgba(12, 74, 110, 0.25)',
  },
  panelWarn: {
    borderColor: 'rgba(245, 158, 11, 0.45)',
    backgroundColor: 'rgba(120, 53, 15, 0.2)',
  },
  panelTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.semiBold,
    marginBottom: 4,
  },
  panelDesc: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
  },
  statusOk: {
    color: defiColors.gold,
    fontWeight: theme.typography.semiBold,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  switchLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.bodySm,
    fontWeight: theme.typography.semiBold,
  },
  switchHint: {
    color: defiColors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  inputLabel: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  input: {
    backgroundColor: defiColors.bgCard,
    color: theme.colors.textPrimary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.border,
    marginBottom: theme.spacing.md,
    fontSize: theme.typography.bodySm,
    fontFamily: theme.typography.fontFamily.mono,
  },
  actionBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: defiColors.goldHover,
    borderWidth: 1,
    borderColor: defiColors.goldHover,
  },
  actionBtnBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  actionBtnSecondary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.75)',
    backgroundColor: 'rgba(63, 63, 70, 0.45)',
  },
  actionBtnSecondaryText: {
    color: defiColors.textSecondary,
    fontWeight: theme.typography.semiBold,
    fontSize: theme.typography.caption,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: theme.typography.semiBold,
    fontSize: theme.typography.caption,
  },
  resultBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
  },
  resultOk: {
    borderColor: defiColors.border,
    backgroundColor: 'rgba(24, 24, 27, 0.6)',
  },
  resultErr: {
    borderColor: 'rgba(248, 113, 113, 0.4)',
    backgroundColor: 'rgba(127, 29, 29, 0.2)',
  },
  resultOkText: {
    color: defiColors.gold,
    fontWeight: theme.typography.semiBold,
    marginBottom: theme.spacing.sm,
  },
  resultMeta: {
    color: defiColors.textMuted,
    fontSize: 10,
    marginBottom: 4,
  },
  resultAddress: {
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.mono,
    fontSize: theme.typography.caption,
  },
  resultHint: {
    color: defiColors.textMuted,
    fontSize: 10,
    marginTop: theme.spacing.sm,
  },
  resultErrText: {
    color: '#f87171',
    fontSize: theme.typography.caption,
  },
});

export default ToolsModal;
