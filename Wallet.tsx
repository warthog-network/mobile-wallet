// Wallet.tsx — login, send, history, and DeFi surfaces.

// ────────────────────────────────────────────────────────────────
// Imports
// ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import axios from 'axios';
import TransactionHistory from './TransactionHistory';
import AddressBookModal from './components/AddressBook/AddressBookModal';
import QrScannerModal from './components/QrScannerModal';
import { Contact } from './types';
import { storage } from './utils/storage';
import { forgetSavedWallet, renameSavedWallet } from './utils/savedWallets';

// Extracted imports
import { WalletData } from './types';
import { SECURE_STORE_KEYS, DERIVATION_PATHS, ADDRESS_LENGTH, PRIVATE_KEY_LENGTH, DEFAULT_FEE } from './constants';
import { isDefiNode, normalizeNodeUrl, rememberNodeFamilies } from './utils/nodes';
import {
  DEFAULT_CATALOG,
  loadNodeCatalog,
  saveNodeCatalog,
  type NodeNetwork,
  type NodeSelection,
  type WalletNode,
} from './utils/nodeCatalog';
import { useDefiWallet } from './hooks/useDefiWallet';
import DefiOverviewSection from './components/defi/DefiOverviewSection';
import DefiBalanceHero from './components/defi/DefiBalanceHero';
import SendAssetModal from './components/defi/SendAssetModal';
import AssetsModal from './components/defi/AssetsModal';
import DexModal from './components/defi/DexModal';
import WartHomeActions, { type WartHomeAction } from './components/defi/WartHomeActions';
import ToolsModal from './components/tools/ToolsModal';
import EthSwapModal from './components/defi/EthSwapModal';
import HemiSwapModal from './components/defi/HemiSwapModal';
import HemiTunnelModal from './components/defi/HemiTunnelModal';
import SolSwapModal from './components/defi/SolSwapModal';
import NetworkActivityModal from './components/defi/NetworkActivityModal';
import { addressForChain, chainHasSwap, chainsForWallet, type WalletChain } from './components/defi/walletChains';
import WalletChrome, { type AccountChoice, type WalletSection } from './components/shell/WalletChrome';
import TradePane from './components/shell/TradePane';
import ActivityPane from './components/shell/ActivityPane';
import SettingsPane, { type SettingsScreen } from './components/shell/SettingsPane';
import ReceiveSheet from './components/shell/ReceiveSheet';
import AaveModal from './components/defi/AaveModal';
import { exchangeTool } from './components/tools/exchangeToolOption';
import type { ToolId } from './components/tools/ToolsModal';
import { loadAutoLockMinutes, type AutoLockMinutes } from './utils/autoLock';
import { defiStyles, defiColors } from './components/defi/defiStyles';
import { Address, Wart, NonceId, RoundedFee } from 'warthog-ts';
import { generateWallet as generateWalletUtil, deriveWallet as deriveWalletUtil, importWallet as importWalletUtil, decryptWallet, encryptWallet, isValidAddress, PBKDF2_ITERATIONS } from './utils/crypto';
import {
  authBadgeForBlob,
  biometricsLabel,
  buildEnvelopeWithBiometrics,
  decryptWithBiometrics,
  envelopeWithPassword,
  inspectWalletBlob,
  isBiometricsAvailable,
  serializeEnvelope,
  tryParseEnvelope,
  unlockEnvelopeWith2fa,
} from './utils/passkeyWallet';
import { createTxContext, fetchChainHead, fetchAccountBalance, fetchUsdPrice, fetchFeeE8, submitWarthogTransaction } from './utils/api';
import {
  amountExceedsAvailable,
  insufficientFreeBalanceMessage,
} from './utils/warthogFormat';
import SpendableBalanceDisplay from './components/SpendableBalanceDisplay';
import TokenIcon from './components/TokenIcon';
import SpendConfirm, { useSpendFlow } from './components/SpendConfirm';
import { toast } from './utils/toast';
import {
  clearLedgerSession,
  clearSessionKeys,
  getLedgerSession,
  publicWallet,
  requireSessionWallet,
  signPreparedWarthog,
  setLedgerSession,
  setSessionKeys,
} from './utils/sessionVault';
import { recoveryPhraseFromDecrypt } from './utils/recoveryPhrase';
import {
  deleteLedgerBookmark,
  listLedgerBookmarks,
  renameLedgerBookmark,
  saveLedgerBookmark,
  setLedgerBookmarkBtc,
  setLedgerBookmarkEth,
  setLedgerBookmarkSol,
  type LedgerBookmark,
} from './utils/ledger/bookmarks';
import { connectLedgerBtcAddress } from './utils/ledger/bitcoin';
import { connectLedgerEthAddress } from './utils/ledger/ethereum';
import { connectLedgerSolAddress } from './utils/ledger/solana';
import { connectLedgerAccount, ledgerWartSubmitJson, signWartTransferOnLedger } from './utils/ledger/warthogApp';
import { ledgerConnectHint, ledgerTransportAvailable } from './utils/ledger/transport';
import { LEDGER_DEFI_HOLD } from './utils/ledger/protocol';
import { theme } from './theme';

const shellTitle = { color: '#fafafa', fontSize: 19, fontWeight: '600' as const, marginBottom: 12 };
const shellHint = { color: '#a1a1aa', fontSize: 12, textAlign: 'center' as const, marginBottom: 12 };
const shellBack = { color: '#FDB913', fontSize: 13, fontWeight: '600' as const, marginBottom: 8 };

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: {
    fontSize: theme.typography.bodySm,
    color: defiColors.gold,
    fontWeight: theme.typography.semiBold,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
    letterSpacing: 0.3,
  },
  loginSection: { marginTop: theme.spacing.lg },
  label: { color: defiColors.textSecondary, fontSize: theme.typography.caption, marginBottom: theme.spacing.sm },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  nodeColumn: { gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  nodeButton: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: defiColors.bgCardMuted,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
    alignSelf: 'stretch',
  },
  nodeButtonText: {
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.semiBold,
    textAlign: 'center',
    fontSize: theme.typography.caption,
  },
  bottomRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xxxl },
  bottomButton: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
    alignSelf: 'stretch',
  },
  bottomButtonText: {
    color: defiColors.textSecondary,
    fontWeight: theme.typography.semiBold,
    textAlign: 'center',
    fontSize: theme.typography.caption,
  },
  walletOptionsModal: {
    maxHeight: '90%',
    padding: 0,
    overflow: 'hidden',
  },
  walletOptionsScroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  walletOptionsSection: {
    marginBottom: theme.spacing.lg,
  },
  walletOptionsSectionTitle: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.semiBold,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  walletOptionsActions: {
    gap: theme.spacing.xs,
  },
  actionButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
    minWidth: 70,
  },
  actionButtonText: { color: defiColors.textSecondary, fontWeight: theme.typography.semiBold, textAlign: 'center', fontSize: theme.typography.tiny },
  activeButton: {
    backgroundColor: defiColors.goldHover,
    borderColor: defiColors.goldHover,
  },
  activeButtonText: { color: '#ffffff' },

  nonceDisplay: { color: defiColors.textMuted, fontSize: theme.typography.caption, marginBottom: theme.spacing.sm, textAlign: 'center' },
  logSection: {
    marginTop: theme.spacing.md,
    backgroundColor: defiColors.bgCard,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.border,
    padding: theme.spacing.md,
  },
  logList: { maxHeight: 200 },
  logItem: {
    backgroundColor: defiColors.bgInset,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
    marginBottom: theme.spacing.sm,
  },
  logText: { color: theme.colors.textPrimary, fontSize: theme.typography.caption, fontFamily: theme.typography.fontFamily.mono },
  input: {
    backgroundColor: defiColors.bgCard,
    color: theme.colors.textPrimary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.border,
    marginBottom: theme.spacing.md,
    fontSize: theme.typography.bodySm,
  },
  inputNoMargin: {
    backgroundColor: defiColors.bgCard,
    color: theme.colors.textPrimary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.border,
    fontSize: theme.typography.bodySm,
    marginBottom: 0,
  },
  bigButton: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
    alignItems: 'center',
    marginVertical: theme.spacing.xs,
  },
  bigButtonText: { color: defiColors.textSecondary, fontWeight: theme.typography.semiBold, fontSize: theme.typography.tiny },
  bigButtonPrimary: {
    backgroundColor: defiColors.goldHover,
    borderColor: defiColors.goldHover,
  },
  bigButtonPrimaryText: { color: '#ffffff', fontWeight: theme.typography.semiBold, fontSize: theme.typography.tiny },
  seed: {
    backgroundColor: defiColors.bgInset,
    padding: theme.spacing.md,
    color: theme.colors.textPrimary,
    fontSize: theme.typography.bodySm,
    lineHeight: 22,
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.goldHover,
  },
  key: {
    backgroundColor: defiColors.bgInset,
    padding: theme.spacing.md,
    color: theme.colors.textPrimary,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
    fontFamily: theme.typography.fontFamily.mono,
  },
  error: { color: theme.colors.error, textAlign: 'center', marginTop: theme.spacing.md, fontSize: theme.typography.bodySm },

  addressContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  addressInput: { flex: 1 },
  addressButtons: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'stretch' },
  addressButton: {
    width: 50,
    borderRadius: theme.borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
  },
  contactButtonText: { color: defiColors.textSecondary, fontSize: 20 },
  saveButtonText: { color: defiColors.textSecondary, fontSize: 16 },
  selectedContact: {
    backgroundColor: 'rgba(231, 147, 0, 0.12)',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(231, 147, 0, 0.4)',
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  selectedContactText: {
    color: defiColors.goldHover,
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.semiBold,
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: defiColors.textMuted,
    fontSize: theme.typography.bodySm,
  },
});

const StyledTextInput = (props: React.ComponentProps<typeof TextInput>) => (
  <TextInput
    {...props}
    placeholderTextColor={defiColors.textMuted}
    style={[styles.input, props.style]}
  />
);

const getPasswordStrength = (password: string) => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z\d]/.test(password)) score++;
  if (score <= 2) return { level: 1, label: 'Weak' };
  if (score <= 3) return { level: 2, label: 'Fair' };
  if (score <= 4) return { level: 3, label: 'Good' };
  return { level: 4, label: 'Strong' };
};

type PasswordCriterion = { label: string; met: boolean };

const getPasswordCriteria = (password: string): PasswordCriterion[] => [
  { label: 'At least 8 characters', met: password.length >= 8 },
  { label: 'One lowercase letter', met: /[a-z]/.test(password) },
  { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
  { label: 'One number', met: /\d/.test(password) },
  { label: 'One special character', met: /[^a-zA-Z\d]/.test(password) },
];

const PasswordCriteria: React.FC<{ password: string; confirmPassword?: string }> = ({ password, confirmPassword }) => {
  const renderRow = (label: string, met: boolean) => (
    <Text
      key={label}
      style={{
        color: met ? theme.colors.success : theme.colors.error,
        fontSize: theme.typography.caption,
      }}
    >
      {met ? '✓ ' : '✗ '}{label}
    </Text>
  );
  const matchMet =
    confirmPassword !== undefined &&
    confirmPassword !== '' &&
    password === confirmPassword;
  return (
    <View style={{ marginTop: 6 }}>
      {getPasswordCriteria(password).map((c) => renderRow(c.label, c.met))}
      {confirmPassword !== undefined && renderRow('Passwords match', matchMet)}
    </View>
  );
};

/**
 * Explain the wait rather than just spinning through it — the pause during
 * 'Encrypting wallet…' is the password KDF doing the work that makes a stolen
 * phone useless, and users read an unexplained freeze as the app hanging.
 */
// Grouped by hand rather than via toLocaleString: Intl is not guaranteed in
// every Hermes build, and a throw here would take down the overlay.
const PBKDF2_ROUNDS_LABEL = String(PBKDF2_ITERATIONS).replace(
  /\B(?=(\d{3})+(?!\d))/g,
  ',',
);

function savingHint(status: string): string {
  if (status.startsWith('Encrypting')) {
    return `Deriving your key with ${PBKDF2_ROUNDS_LABEL} rounds — this is what stops your seed being brute-forced if your phone is lost or stolen.`;
  }
  if (status.startsWith('Checking')) {
    return 'Verifying against this wallet’s existing password.';
  }
  return 'Keep the app open until this finishes.';
}

function SavingOverlay({ visible, status }: { visible: boolean; status: string }) {
  if (!visible) return null;
  return (
    <View
      pointerEvents="auto"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(9, 9, 11, 0.82)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        zIndex: 50,
      }}
    >
      <ActivityIndicator size="large" color={defiColors.goldHover} />
      <Text
        style={{
          color: theme.colors.textPrimary,
          marginTop: 16,
          textAlign: 'center',
          fontSize: 16,
          fontWeight: '600',
        }}
      >
        {status}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          marginTop: 8,
          textAlign: 'center',
          fontSize: 13,
          lineHeight: 18,
        }}
      >
        {savingHint(status)}
      </Text>
    </View>
  );
}

const Wallet: React.FC<{ brand?: React.ReactNode }> = ({ brand }) => {
  const insets = useSafeAreaInsets();

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [currentWalletName, setCurrentWalletName] = useState<string>('');
  const [savedWalletNames, setSavedWalletNames] = useState<string[]>([]);
  const [balance, setBalance] = useState<string>('0.00000000');
  const [balanceAvailable, setBalanceAvailable] = useState<string>('0.00000000');
  const [balanceLocked, setBalanceLocked] = useState<string>('0.00000000');
  const [usdBalance, setUsdBalance] = useState<string>('$0.00');
  const [nextNonce, setNextNonce] = useState<number>(0);
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number>(0);
  const [nodeList, setNodeList] = useState<WalletNode[]>(DEFAULT_CATALOG.nodes);
  const [nodeSelection, setNodeSelection] = useState<NodeSelection>({ ...DEFAULT_CATALOG.selection });
  const [selectedNode, setSelectedNode] = useState(DEFAULT_CATALOG.activeUrl);
  const nodeListRef = useRef(nodeList);
  const selectionRef = useRef(nodeSelection);
  const selectedRef = useRef(selectedNode);
  nodeListRef.current = nodeList;
  selectionRef.current = nodeSelection;
  selectedRef.current = selectedNode;
  const persistCatalog = (nodes: WalletNode[], selection: NodeSelection, activeUrl: string) => {
    rememberNodeFamilies(nodes);
    nodeListRef.current = nodes;
    selectionRef.current = selection;
    selectedRef.current = activeUrl;
    setNodeList(nodes);
    setNodeSelection(selection);
    setSelectedNode(activeUrl);
    void saveNodeCatalog({ nodes, selection, activeUrl });
  };
  const selectNetwork = (url: string, network?: NodeNetwork) => {
    const list = nodeListRef.current;
    const currentUrl = selectedRef.current;
    const current = list.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(currentUrl));
    const currentFamily: NodeNetwork = current?.network ?? (isDefiNode(currentUrl) ? 'defi-testnet' : 'mainnet');
    const known = list.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(url));
    const nextFamily: NodeNetwork = network ?? known?.network ?? (isDefiNode(url) ? 'defi-testnet' : 'mainnet');
    if (normalizeNodeUrl(url) === normalizeNodeUrl(currentUrl) && nextFamily === currentFamily) return;
    const apply = () => persistCatalog(list, { ...selectionRef.current, [nextFamily]: url }, url);
    if (nextFamily === 'defi-testnet' && currentFamily !== 'defi-testnet') {
      const message = 'Testnet coins have no mainnet value. DEX and assets on this network are for testing only.';
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`Switch to DeFi Testnet?\n\n${message}`)) apply();
        return;
      }
      Alert.alert(
        'Switch to DeFi Testnet?',
        message,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Use Testnet', onPress: apply },
        ],
      );
      return;
    }
    apply();
  };
  const replaceNodeList = (nodes: WalletNode[]) => {
    if (!nodes.length) return;
    const pick = (family: NodeNetwork, url: string) => {
      const found = nodes.find((node) => node.network === family && normalizeNodeUrl(node.url) === normalizeNodeUrl(url));
      return found?.url ?? '';
    };
    const selection: NodeSelection = {
      mainnet: pick('mainnet', selectionRef.current.mainnet),
      'defi-testnet': pick('defi-testnet', selectionRef.current['defi-testnet']),
    };
    const currentUrl = selectedRef.current;
    let active = nodes.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(currentUrl));
    if (!active) {
      const previous = nodeListRef.current.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(currentUrl));
      const wanted: NodeNetwork = previous?.network ?? (isDefiNode(currentUrl) ? 'defi-testnet' : 'mainnet');
      active = nodes.find((node) => node.network === wanted && selection[wanted] && normalizeNodeUrl(node.url) === normalizeNodeUrl(selection[wanted]))
        || nodes.find((node) => node.network === wanted)
        || nodes[0];
    }
    persistCatalog(nodes, selection, active.url);
  };
  /** Guided access paths (wartbunker BalanceCardAccess parity) */
  type AccessPath = 'hub' | 'login' | 'create' | 'have' | 'derive' | 'import' | 'load' | 'ledger';
  const [accessPath, setAccessPath] = useState<AccessPath>('hub');
  const [walletAction, setWalletAction] = useState<'create' | 'derive' | 'import' | 'login'>('create');
  const [mnemonic, setMnemonic] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [wordCount, setWordCount] = useState('12');
  const [pathType, setPathType] = useState<'hardened' | 'normal'>('hardened');
  const [ledgerBookmarks, setLedgerBookmarks] = useState<LedgerBookmark[]>([]);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [ledgerEthBusy, setLedgerEthBusy] = useState(false);
  const [ledgerBtcBusy, setLedgerBtcBusy] = useState(false);
  const [ledgerSolBusy, setLedgerSolBusy] = useState(false);
  const [activeLedger, setActiveLedger] = useState(false);
  const [ledgerOrigin, setLedgerOrigin] = useState<'have' | 'create'>('have');
  const [selectedLedgerName, setSelectedLedgerName] = useState<string | null>(null);
  const [draftLedgerName, setDraftLedgerName] = useState('');
  const [secureStep, setSecureStep] = useState<'save' | 'backup'>('save');
  const [consentToClose, setConsentToClose] = useState(false);
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0.01');
  const [manualNonce, setManualNonce] = useState('');
  const sendFlow = useSpendFlow();

  const [showSendModal, setShowSendModal] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [deletingWallet, setDeletingWallet] = useState(false);
  const [showSendAssetModal, setShowSendAssetModal] = useState(false);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [assetStartTab, setAssetStartTab] = useState<'create' | 'search'>('search');
  const [dexFocus, setDexFocus] = useState<'market' | 'pool' | null>(null);
  const clearDexFocus = useCallback(() => setDexFocus(null), []);
  const [showToolsModal, setShowToolsModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [chain, setChain] = useState<WalletChain>('wart');
  const [section, setSection] = useState<WalletSection>('wallet');
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('menu');
  const [tradeView, setTradeView] = useState<'menu' | 'swap' | 'liquidity'>('menu');
  const [showReceive, setShowReceive] = useState(false);
  const [showAave, setShowAave] = useState(false);
  const [showSafeTrade, setShowSafeTrade] = useState(false);
  const [toolsInitial, setToolsInitial] = useState<ToolId | undefined>(undefined);
  const [lockMinutes, setLockMinutes] = useState<AutoLockMinutes>(5);
  const [chainSwapOpen, setChainSwapOpen] = useState(false);
  const [chainSendTick, setChainSendTick] = useState(0);
  const [solTick, setSolTick] = useState(0);
  const [ethTick, setEthTick] = useState(0);
  const [hemiTick, setHemiTick] = useState(0);
  const [ethBlock, setEthBlock] = useState<number | undefined>(undefined);
  const refreshEthereum = useCallback((blockNumber?: number) => {
    setEthBlock(blockNumber);
    setEthTick((n) => n + 1);
  }, []);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [showWalletQrScanner, setShowWalletQrScanner] = useState(false);
  const [scannedWalletPayload, setScannedWalletPayload] = useState<string | null>(null);

  const isDefi = useMemo(() => {
    const found = nodeList.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(selectedNode));
    return found ? found.network === 'defi-testnet' : isDefiNode(selectedNode);
  }, [nodeList, selectedNode]);

  const modalOverlayStyle = defiStyles.modalOverlay;
  const modalContentStyle = { ...defiStyles.modalContent, marginBottom: insets.bottom };
  const modalTitleStyle = defiStyles.modalTitle;
  const modalCloseStyle = defiStyles.modalClose;
  const modalBlockCounterStyle = defiStyles.modalBlockCounter;
  const modalBlockTextStyle = defiStyles.modalBlockText;

  const chains = useMemo(
    () => (wallet ? chainsForWallet(wallet, activeLedger) : ['wart' as WalletChain]),
    [wallet, activeLedger],
  );

  const accountChoices = useMemo((): AccountChoice[] => {
    const currentId = activeLedger
      ? `ledger:${currentWalletName}`
      : currentWalletName && savedWalletNames.includes(currentWalletName)
        ? `saved:${currentWalletName}`
        : 'session';
    const rows: AccountChoice[] = [{
      id: currentId,
      name: (currentWalletName || 'Wallet').trim() || 'Wallet',
      detail: activeLedger ? 'Ledger · open now' : currentId === 'session' ? 'This session' : 'Open now',
    }];
    savedWalletNames.forEach((saved) => {
      if (`saved:${saved}` !== currentId) rows.push({ id: `saved:${saved}`, name: saved });
    });
    ledgerBookmarks.forEach((row) => {
      if (`ledger:${row.name}` !== currentId) rows.push({ id: `ledger:${row.name}`, name: row.name, detail: 'Ledger' });
    });
    return rows;
  }, [activeLedger, currentWalletName, savedWalletNames, ledgerBookmarks]);

  useEffect(() => {
    if (!chains.includes(chain)) setChain('wart');
  }, [chains, chain]);

  useEffect(() => {
    setChainSwapOpen(false);
    setTradeView('menu');
    setSection('wallet');
    setSettingsScreen('menu');
  }, [chain]);

  useEffect(() => {
    void loadAutoLockMinutes().then(setLockMinutes);
    let gone = false;
    void loadNodeCatalog().then((catalog) => {
      if (!gone) persistCatalog(catalog.nodes, catalog.selection, catalog.activeUrl);
    });
    return () => { gone = true; };
  }, []);

  const openTrade = (view: 'swap' | 'liquidity') => {
    setTradeView(view);
    setSection('trade');
    setDexFocus(view === 'liquidity' ? 'pool' : 'market');
    setChainSwapOpen(view === 'swap');
  };

  const onWartAction = (action: WartHomeAction) => {
    if (action === 'send') {
      setShowSendModal(true);
      return;
    }
    if (action === 'receive') {
      setShowReceive(true);
      return;
    }
    if (!isDefi) {
      toast.info('DeFi testnet', 'Switch to a DeFi testnet node to use swaps, pools, and assets.');
      return;
    }
    if (action === 'mint') {
      setAssetStartTab('create');
      setShowAssetsModal(true);
      return;
    }
    openTrade(action === 'liquidity' ? 'liquidity' : 'swap');
  };

  const onChainAction = (action: WartHomeAction) => {
    if (action === 'receive') {
      setShowReceive(true);
      return;
    }
    if (action === 'send') {
      setChainSendTick((tick) => tick + 1);
      return;
    }
    if (action !== 'swap' || !wallet) return;
    if (chain === 'ethereum' && !wallet.ethAddress) {
      toast.info('Ethereum', 'Add the Ethereum account before swapping.');
      return;
    }
    if (chain === 'bitcoin' && (!wallet.btcAddress || !wallet.ethAddress)) {
      toast.info('Bitcoin tunnel', 'This tunnel needs a Bitcoin address and a Hemi address.');
      return;
    }
    if (chain === 'hemi' && !wallet.ethAddress) {
      toast.info('Hemi', 'This account needs the recovery phrase before it can swap on Hemi.');
      return;
    }
    if (chain === 'solana' && !wallet.solAddress) {
      toast.info('Solana', 'Add the Solana account before swapping.');
      return;
    }
    openTrade('swap');
  };

  const [showModal, setShowModal] = useState(false);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [walletName, setWalletName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [saveWalletConsent, setSaveWalletConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadedFileContent, setUploadedFileContent] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [sentTxLog, setSentTxLog] = useState<string[]>([]);
  const [showRecentTxLog, setShowRecentTxLog] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [selectedWalletToLogin, setSelectedWalletToLogin] = useState<string>('');
  const [showWalletSelection, setShowWalletSelection] = useState(false);
  const [selectedLoginBadge, setSelectedLoginBadge] = useState('');
  const [selectedLoginHasPasskey, setSelectedLoginHasPasskey] = useState(false);
  const [selectedLoginHasPassword, setSelectedLoginHasPassword] = useState(true);
  const [selectedLoginRequire2fa, setSelectedLoginRequire2fa] = useState(false);
  const [biometricsSupported, setBiometricsSupported] = useState(false);
  const [bioLabel, setBioLabel] = useState('passkey');
  const [enableBioOnSave, setEnableBioOnSave] = useState(Platform.OS !== 'web');
  const [require2faOnSave, setRequire2faOnSave] = useState(false);
  const [enableBioOnCreate, setEnableBioOnCreate] = useState(Platform.OS !== 'web');
  const [require2faOnCreate, setRequire2faOnCreate] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Saving…');

  // Address Book state
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [addressBookMode, setAddressBookMode] = useState<'select' | 'manage'>('select');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [prefilledAddress, setPrefilledAddress] = useState<string>('');

  // Save current wallet state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveWalletName, setSaveWalletName] = useState('');
  const [savePassword, setSavePassword] = useState('');
  const [saveConfirmPassword, setSaveConfirmPassword] = useState('');
  const [logoutAfterSave, setLogoutAfterSave] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadPassword, setDownloadPassword] = useState('');

  const refreshBiometricsCapability = useCallback(async () => {
    try {
      const ok = await isBiometricsAvailable();
      setBiometricsSupported(ok);
      setBioLabel(await biometricsLabel());
      return ok;
    } catch {
      // Web has no SecureStore passkey module. A failed phone probe still
      // shows the option; enable reports a clear error if auth cannot run.
      if (Platform.OS === 'web') {
        setBiometricsSupported(false);
        setBioLabel('passkey');
        return false;
      }
      setBiometricsSupported(true);
      setBioLabel('passkey');
      return true;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await refreshBiometricsCapability();
      // First load only: default create/save toggles on when the device can
      // authenticate. Turn them off when it cannot, including the browser,
      // where the passkey store is an empty stub.
      if (ok && Platform.OS !== 'web') {
        setEnableBioOnSave(true);
        setEnableBioOnCreate(true);
      } else {
        setEnableBioOnSave(false);
        setEnableBioOnCreate(false);
        setRequire2faOnSave(false);
        setRequire2faOnCreate(false);
      }
    })();
  }, [refreshBiometricsCapability]);

  useEffect(() => {
    const loadSavedWallets = async () => {
      const namesStr = await storage.getItemAsync(SECURE_STORE_KEYS.walletNames);
      if (namesStr) {
        const names = JSON.parse(namesStr);
        setSavedWalletNames(names);
        if (names.length > 0) {
          setWalletAction('login');
          setAccessPath('hub');
        }
      }
    };
    loadSavedWallets();
    listLedgerBookmarks().then(setLedgerBookmarks).catch(() => setLedgerBookmarks([]));
  }, []);



  const handleLogout = async () => {
    if (activeLedger || getLedgerSession()) {
      performLogout();
      return;
    }
    // Check if the current wallet is saved; if not, prompt to save
    if (!currentWalletName || !savedWalletNames.includes(currentWalletName)) {
      setLogoutAfterSave(true);
      setShowSaveModal(true);
      return;
    }
    // Already saved, logout
    performLogout();
  };

  const commitUnlockedWallet = (data: WalletData, name?: string) => {
    setSessionKeys(data);
    setActiveLedger(false);
    setWallet(publicWallet(data));
    setWalletData(null);
    if (name) setCurrentWalletName(name);
    setIsLoggedIn(true);
    fetchBalanceAndNonce(data.address);
  };

  const openLedgerAccount = (session: LedgerBookmark) => {
    setLedgerSession(session);
    setActiveLedger(true);
    setWallet({
      privateKey: '',
      publicKey: session.publicKey,
      address: session.address,
      pathType: session.pathType,
      ethAddress: session.ethAddress,
      btcAddress: session.btcAddress,
      solAddress: session.solAddress,
    });
    setWalletData(null);
    setCurrentWalletName(session.name);
    setIsLoggedIn(true);
    setPassword('');
    setSelectedWalletToLogin('');
    setSelectedLedgerName(null);
    setShowWalletSelection(false);
    setError(null);
    fetchBalanceAndNonce(session.address);
  };

  const connectNamedLedger = async (opts: {
    name: string;
    pathType: 'hardened' | 'normal';
    index?: number;
    expectedAddress?: string;
  }) => {
    const name = opts.name.trim() || 'Ledger';
    const softwareClash = savedWalletNames.includes(name)
      && !ledgerBookmarks.some((row) => row.name === name);
    if (softwareClash) {
      setError('That name is already saved for a software wallet.');
      return;
    }
    setLedgerBusy(true);
    setError(null);
    try {
      const session = await connectLedgerAccount(opts.pathType, opts.index ?? 0);
      if (
        opts.expectedAddress
        && session.address.toLowerCase() !== opts.expectedAddress.toLowerCase()
      ) {
        throw new Error('This Nano account does not match the saved wallet.');
      }
      const stored = await saveLedgerBookmark({ ...session, name });
      setLedgerBookmarks(await listLedgerBookmarks());
      openLedgerAccount(stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ledger login failed');
    } finally {
      setLedgerBusy(false);
    }
  };

  const addLedgerEthereum = async () => {
    const session = getLedgerSession();
    if (!session || !currentWalletName) return;
    setLedgerEthBusy(true);
    const id = toast.loading(
      'Ethereum app',
      'Open the Ethereum app on the Nano and approve the address.',
    );
    try {
      const ethAddress = await connectLedgerEthAddress();
      await setLedgerBookmarkEth(currentWalletName, ethAddress);
      setLedgerSession({ ...session, ethAddress });
      setWallet((current) => (current ? { ...current, ethAddress } : current));
      setLedgerBookmarks(await listLedgerBookmarks());
      toast.update(id, 'success', 'Ethereum account added', ethAddress);
    } catch (e) {
      toast.update(
        id,
        'error',
        'Ethereum account',
        e instanceof Error ? e.message : 'Could not read the Ethereum address',
      );
    } finally {
      setLedgerEthBusy(false);
    }
  };

  const addLedgerBitcoin = async () => {
    const session = getLedgerSession();
    if (!session || !currentWalletName) return;
    setLedgerBtcBusy(true);
    const id = toast.loading(
      'Bitcoin app',
      'Open the Bitcoin app on the Nano and approve the address.',
    );
    try {
      const account = await connectLedgerBtcAddress();
      await setLedgerBookmarkBtc(currentWalletName, account);
      setLedgerSession({
        ...session,
        btcAddress: account.address,
        btcPublicKey: account.publicKey,
        btcFingerprint: account.fingerprint,
        btcAccountXpub: account.accountXpub,
      });
      setWallet((current) => (current ? { ...current, btcAddress: account.address } : current));
      setLedgerBookmarks(await listLedgerBookmarks());
      toast.update(id, 'success', 'Bitcoin account added', account.address);
    } catch (e) {
      toast.update(
        id,
        'error',
        'Bitcoin account',
        e instanceof Error ? e.message : 'Could not read the Bitcoin address',
      );
    } finally {
      setLedgerBtcBusy(false);
    }
  };

  const addLedgerSolana = async () => {
    const session = getLedgerSession();
    if (!session || !currentWalletName) return;
    setLedgerSolBusy(true);
    const id = toast.loading(
      'Solana app',
      'Open the Solana app on the Nano and approve the address.',
    );
    try {
      const account = await connectLedgerSolAddress();
      await setLedgerBookmarkSol(currentWalletName, account);
      setLedgerSession({
        ...session,
        solAddress: account.address,
        solPublicKey: account.publicKey,
      });
      setWallet((current) => (current ? { ...current, solAddress: account.address } : current));
      setLedgerBookmarks(await listLedgerBookmarks());
      toast.update(id, 'success', 'Solana account added', account.address);
    } catch (e) {
      toast.update(
        id,
        'error',
        'Solana account',
        e instanceof Error ? e.message : 'Could not read the Solana address',
      );
    } finally {
      setLedgerSolBusy(false);
    }
  };

  const renameSelectedLedger = async () => {
    if (!selectedLedgerName) return;
    const next = draftLedgerName.trim();
    if (!next || next === selectedLedgerName) return;
    if (savedWalletNames.includes(next)) {
      setError('That name is already saved for a software wallet.');
      return;
    }
    setLedgerBusy(true);
    setError(null);
    try {
      await renameLedgerBookmark(selectedLedgerName, next);
      setLedgerBookmarks(await listLedgerBookmarks());
      setSelectedLedgerName(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename');
    } finally {
      setLedgerBusy(false);
    }
  };

  const performLogout = () => {
    const wasLedger = activeLedger || Boolean(getLedgerSession());
    clearSessionKeys();
    clearLedgerSession();
    setActiveLedger(false);
    setWallet(null);
    setWalletData(null);
    setMnemonic('');
    setPrivateKeyInput('');
    setCurrentWalletName('');
    setIsLoggedIn(false);
    setSentTxLog([]);
    setSettingsScreen('menu');
    toast.info(
      'Logged out',
      wasLedger
        ? 'Reconnect the Nano to open this Ledger account again.'
        : 'Your wallet is saved securely on this device.',
    );
  };

  const loggedInRef = useRef(isLoggedIn);
  loggedInRef.current = isLoggedIn;
  const activeLedgerRef = useRef(activeLedger);
  activeLedgerRef.current = activeLedger;

  useEffect(() => {
    if (!isLoggedIn) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let awayAt = 0;
    let didLock = false;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const lock = () => {
      clearTimer();
      awayAt = 0;
      if (didLock || !loggedInRef.current) return;
      didLock = true;
      const wasLedger = activeLedgerRef.current || Boolean(getLedgerSession());
      clearSessionKeys();
      clearLedgerSession();
      setActiveLedger(false);
      setWallet(null);
      setWalletData(null);
      setCurrentWalletName('');
      setIsLoggedIn(false);
      setSentTxLog([]);
      setSettingsScreen('menu');
      toast.info(
        'Locked',
        wasLedger
          ? `Locked after ${lockMinutes} minutes away. Reconnect the Nano to open this Ledger account again.`
          : `Locked after ${lockMinutes} minutes away. Your wallet is saved on this device.`,
      );
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (!loggedInRef.current) return;
      if (state === 'background') {
        awayAt = Date.now();
        clearTimer();
        timer = setTimeout(lock, lockMinutes * 60 * 1000);
        return;
      }
      if (state === 'active') {
        if (awayAt && Date.now() - awayAt >= lockMinutes * 60 * 1000) {
          lock();
          return;
        }
        awayAt = 0;
        clearTimer();
      }
    });

    return () => {
      clearTimer();
      sub.remove();
    };
  }, [isLoggedIn, lockMinutes]);

  const performClearWallet = async () => {
    const name = currentWalletName.trim();
    if (!name || deletingWallet) {
      if (!name) toast.error('No wallet selected', 'No wallet is currently selected to delete.');
      return;
    }
    const removingLedger = activeLedger || Boolean(getLedgerSession());
    setDeletingWallet(true);
    try {
      if (removingLedger) {
        await deleteLedgerBookmark(name);
        setLedgerBookmarks(await listLedgerBookmarks());
      } else {
        const updatedNames = await forgetSavedWallet(name);
        setSavedWalletNames(updatedNames);
      }
      clearSessionKeys();
      clearLedgerSession();
      setActiveLedger(false);
      setWallet(null);
      setCurrentWalletName('');
      setIsLoggedIn(false);
      setSentTxLog([]);
      setNextNonce(0);
      setAccessPath('hub');
      setSettingsScreen('menu');
      toast.success(
        removingLedger ? 'Ledger name removed' : 'Wallet deleted',
        removingLedger
          ? `"${name}" was removed from this phone.`
          : `"${name}" was removed from this phone.`,
      );
    } catch {
      toast.error('Error', 'Failed to delete wallet data');
    } finally {
      setDeletingWallet(false);
    }
  };

  const renameCurrentAccount = async (nextRaw: string) => {
    const next = nextRaw.trim();
    if (!next) throw new Error('Enter a name');
    const current = currentWalletName.trim();
    if (next === current) return;
    if (savedWalletNames.includes(next) || ledgerBookmarks.some((row) => row.name === next)) {
      throw new Error('That name is already used');
    }
    if (activeLedger) {
      if (!current) throw new Error('This Ledger account has no name');
      await renameLedgerBookmark(current, next);
      setLedgerBookmarks(await listLedgerBookmarks());
      setCurrentWalletName(next);
      if (selectedLedgerName === current) setSelectedLedgerName(next);
      toast.success('Account renamed', next);
      return;
    }
    if (current && savedWalletNames.includes(current)) {
      const updated = await renameSavedWallet(current, next);
      setSavedWalletNames(updated);
      setCurrentWalletName(next);
      toast.success('Account renamed', next);
      return;
    }
    setCurrentWalletName(next);
    toast.success('Name updated', 'Save the wallet to keep this name for the next login');
  };



  const getPersistentNonce = async (address: string): Promise<number> => {
    if (!address) return 0;
    try {
      const stored = await storage.getItemAsync(SECURE_STORE_KEYS.nonce(address));
      return stored ? Number(stored) : 0;
    } catch {
      return 0;
    }
  };

  const savePersistentNonce = async (address: string, nonce: number): Promise<void> => {
    if (!address) return;
    try {
      await storage.setItemAsync(SECURE_STORE_KEYS.nonce(address), nonce.toString());
    } catch (e) {
      console.error('Failed to persist nonce:', e);
    }
  };

  const bumpNonce = useCallback(async (newNonce: number) => {
    if (!wallet?.address) return;
    setNextNonce(newNonce);
    await savePersistentNonce(wallet.address, newNonce);
  }, [wallet?.address]);

  const defi = useDefiWallet(wallet, selectedNode, isDefi, bumpNonce);

  const fetchBalanceAndNonce = useCallback(async (address: string) => {
    try {
      const [headData, balData] = await Promise.all([
        fetchChainHead(selectedNode),
        fetchAccountBalance(selectedNode, address),
      ]);

      setCurrentBlockHeight(headData.pinHeight);

      setBalance(balData.balanceStr);
      setBalanceAvailable(balData.availableStr);
      setBalanceLocked(balData.lockedStr);

      const usdPrice = await fetchUsdPrice();
      // USD priced on total holdings (available + locked)
      const usd = (balData.balance * usdPrice).toFixed(2);
      setUsdBalance(`$${usd}`);

      const fetchedNonce = balData.nonceId;
      const persistentNonce = await getPersistentNonce(address);
      setNextNonce((prev) => {
        const newNextNonce = Math.max(persistentNonce, fetchedNonce, prev);
        savePersistentNonce(address, newNextNonce);
        return newNextNonce;
      });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [selectedNode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (wallet?.address) {
        await fetchBalanceAndNonce(wallet.address);
        if (isDefi) await defi.refreshDefiData();
      }
    } catch (e) {
      // Balance/defi helpers already surface errors; never leave the spinner stuck.
      console.error('Refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  }, [wallet, isDefi, fetchBalanceAndNonce, defi.refreshDefiData]);

  // Re-fetch WART balance whenever the selected node changes (mainnet ↔ testnet).
  // Node-switch UI only updates selectedNode; defi data is handled inside useDefiWallet.
  useEffect(() => {
    if (!wallet?.address) return;
    fetchBalanceAndNonce(wallet.address);
  }, [selectedNode, wallet?.address, fetchBalanceAndNonce]);

  /** After a spend/lock tx: bump nonce and re-fetch free/locked for WART + assets. */
  const afterSpendSuccess = useCallback(async (newNonce: number) => {
    await bumpNonce(newNonce);
    if (wallet?.address) {
      await fetchBalanceAndNonce(wallet.address);
      if (isDefi) await defi.refreshDefiData();
    }
  }, [bumpNonce, wallet?.address, fetchBalanceAndNonce, isDefi, defi.refreshDefiData]);

  const goAccessPath = (next: AccessPath) => {
    setAccessPath(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setMnemonic('');
    setPrivateKeyInput('');
    setUploadedFileContent(null);
    setUploadedFileName(null);
    setShowWalletSelection(false);
    setSelectedWalletToLogin('');
    if (next === 'login' || next === 'hub') {
      listLedgerBookmarks().then(setLedgerBookmarks).catch(() => setLedgerBookmarks([]));
    }
    if (next === 'login') setWalletAction('login');
    if (next === 'create') setWalletAction('create');
    if (next === 'derive') setWalletAction('derive');
    if (next === 'import') setWalletAction('import');
  };

  const handleWalletAction = async () => {
    setError(null);
    if (walletAction === 'create' && !walletName.trim()) {
      setError('Enter a wallet name first (e.g. main)');
      return;
    }
    if (walletAction === 'derive' && !mnemonic.trim()) {
      setError('Enter your seed phrase');
      return;
    }
    if (walletAction === 'import' && privateKeyInput.length !== PRIVATE_KEY_LENGTH) {
      setError('Private key must be exactly 64 hex characters');
      return;
    }
    setCreatingWallet(true);

    // Small delay to ensure spinner renders before heavy crypto operations
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      let data: WalletData;
      if (walletAction === 'create') {
        data = await generateWalletUtil(Number(wordCount), pathType);
      } else if (walletAction === 'derive') {
        data = deriveWalletUtil(mnemonic, Number(wordCount), pathType);
        setMnemonic('');
      } else if (walletAction === 'import') {
        data = importWalletUtil(privateKeyInput);
        setPrivateKeyInput('');
        if (!walletName.trim()) setWalletName('Imported');
      } else {
        throw new Error('Fill all fields');
      }
      setWalletData(data);
      setSaveWalletConsent(false);
      setConsentToClose(false);
      setSecureStep('save'); // unlock options first (wartbunker), then seed backup
      setShowModal(true);
    } catch (e: any) {
      toast.error('Wallet creation failed', e.message);
    } finally {
      setCreatingWallet(false);
    }
  };

  /**
   * Turn a typed password into the cipher we store.
   *
   * When the typed password already opens the wallet's existing cipher we keep
   * that cipher instead of deriving a new one: the result is equivalent, and
   * the check proves the password is really this wallet's.
   *
   * Callers that are *confirming* an existing password rather than setting a
   * new one (enabling 2FA) pass requireExisting, so a typo is rejected instead
   * of silently becoming the new password — which, once 2FA needs both factors,
   * would lock the wallet away for good.
   */
  const resolvePasswordCipher = async (
    data: WalletData,
    pwd: string,
    prevCipher: string | null,
    requireExisting: boolean,
  ): Promise<string> => {
    if (prevCipher) {
      setSaveStatus('Checking password…');
      let opened: WalletData | null = null;
      try {
        opened = await decryptWallet(prevCipher, pwd);
      } catch {
        opened = null;
      }
      if (opened) {
        const a = String(opened.address || '').replace(/^0x/i, '').toLowerCase();
        const b = String(data?.address || '').replace(/^0x/i, '').toLowerCase();
        // Same password, same key — the stored cipher is already the right one.
        // A mismatch means this name now holds a different wallet, so fall
        // through and re-encrypt rather than keeping a cipher for the old key.
        if (a && a === b) return prevCipher;
      } else if (requireExisting) {
        throw new Error(
          'Wrong password for this wallet — enter its current password to enable 2FA',
        );
      }
    }
    setSaveStatus('Encrypting wallet…');
    return encryptWallet(data, pwd);
  };

  const persistNamedWallet = async (
    data: WalletData,
    name: string,
    pwd: string | null,
    opts: { withBiometrics?: boolean; require2fa?: boolean; requireExistingPassword?: boolean },
  ): Promise<string> => {
    const withBio = Platform.OS !== 'web' && Boolean(opts.withBiometrics);
    const require2fa = Boolean(opts.require2fa);
    if (opts.withBiometrics && Platform.OS === 'web') {
      throw new Error(
        'Passkey unlock is only available in the phone app. Set a password to save this wallet in the browser.',
      );
    }
    if (!pwd && !withBio) throw new Error('Password or biometrics required to save');
    if (require2fa && (!pwd || !withBio)) {
      throw new Error('2FA needs both a password and biometrics');
    }
    if (pwd && getPasswordStrength(pwd).level < 3) {
      throw new Error('Password is too weak. Must be at least Good strength.');
    }

    const existing = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(name));
    const prevEnv = existing ? tryParseEnvelope(existing) : null;
    const prevCipher = prevEnv?.password || (!prevEnv && existing ? existing : null);

    // Adding a passkey must not replace the stored password if the user typos.
    // Password-only re-save can still change the password (opts.requireExistingPassword
    // defaults false). Callers that are confirming an existing password pass true.
    const requireExisting =
      Boolean(opts.requireExistingPassword) ||
      (Boolean(prevCipher) && withBio && Boolean(pwd));

    // Settle the password before touching biometrics, so a bad password fails
    // immediately instead of after the OS prompt has already interrupted the
    // user. (This used to run last, to keep the prompt from queueing behind a
    // multi-second PBKDF2; the native KDF makes that ordering unnecessary.)
    const passwordCipher = pwd
      ? await resolvePasswordCipher(data, pwd, prevCipher, requireExisting)
      : null;

    if (withBio) {
      setSaveStatus('Confirm passkey on your device');
      const { envelope } = await buildEnvelopeWithBiometrics(data, {
        displayName: name,
        existingPasswordCipher: passwordCipher ?? prevCipher,
        previousEnvelope: prevEnv,
        require2fa: false,
      });
      if (passwordCipher) {
        envelope.password = passwordCipher;
        envelope.require2fa = require2fa;
      }
      return serializeEnvelope(envelope);
    }

    if (passwordCipher) {
      if (prevEnv?.passkey) {
        return serializeEnvelope(
          envelopeWithPassword(data, passwordCipher, prevEnv, { require2fa }),
        );
      }
      return passwordCipher;
    }
    throw new Error('Nothing to save');
  };

  const continueToSeedBackup = () => {
    setModalError(null);
    if (!walletName.trim()) return setModalError('Enter a wallet name first');
    const wantBio = Platform.OS !== 'web' && enableBioOnCreate;
    const wantPassword = Boolean(password);
    if (!wantBio && !wantPassword) {
      return setModalError(
        Platform.OS === 'web'
          ? 'Set a password to save this wallet in the browser'
          : 'Enable biometrics and/or set a password for next login',
      );
    }
    if (wantPassword) {
      if (getPasswordStrength(password).level < 3) {
        return setModalError('Password is too weak. Must be at least Good strength.');
      }
      if (password !== confirmPassword) return setModalError('Passwords do not match');
    }
    if (require2faOnCreate && (!wantPassword || !wantBio)) {
      return setModalError('2FA needs both a password and biometrics');
    }
    if (
      (savedWalletNames.includes(walletName) && walletAction === 'create')
      || ledgerBookmarks.some((row) => row.name === walletName.trim())
    ) {
      return setModalError('Wallet name already exists. Choose a different name.');
    }
    setSecureStep('backup');
  };

  const saveWallet = async () => {
    setModalError(null);
    if (!consentToClose && !saveWalletConsent) {
      return setModalError('Confirm you have written down your seed phrase before closing');
    }
    if (!walletName) return setModalError('Enter a wallet name');
    if (
      (savedWalletNames.includes(walletName) && walletAction === 'create')
      || ledgerBookmarks.some((row) => row.name === walletName.trim())
    ) {
      return setModalError('Wallet name already exists. Choose a different name.');
    }
    const wantBio = Platform.OS !== 'web' && enableBioOnCreate;
    if (!password && !wantBio) {
      return setModalError(
        Platform.OS === 'web'
          ? 'Set a password to save this wallet in the browser'
          : 'Enable biometrics and/or set a password',
      );
    }
    if (password) {
      if (getPasswordStrength(password).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
      if (password !== confirmPassword) return setModalError('Passwords do not match');
    }
    if (require2faOnCreate && (!password || !wantBio)) {
      return setModalError('2FA needs both a password and biometrics');
    }
    if (!walletData) return setModalError('No wallet data available');
    try {
      setSaveStatus(wantBio ? 'Confirm passkey on your device' : 'Encrypting wallet…');
      setPasskeyBusy(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const enc = await persistNamedWallet(walletData, walletName, password || null, {
        withBiometrics: wantBio,
        require2fa: require2faOnCreate,
      });
      await storage.setItemAsync(SECURE_STORE_KEYS.wallet(walletName), enc);
      const updatedNames = savedWalletNames.includes(walletName)
        ? savedWalletNames
        : [...savedWalletNames, walletName];
      setSavedWalletNames(updatedNames);
      await storage.setItemAsync(SECURE_STORE_KEYS.walletNames, JSON.stringify(updatedNames));
      commitUnlockedWallet(walletData, walletName);
      setShowModal(false);
      setAccessPath('hub');
      setPassword('');
      setConfirmPassword('');
      setWalletName('');
      setConsentToClose(false);
      setSaveWalletConsent(false);
      setSecureStep('save');
      const badge = authBadgeForBlob(enc);
      toast.success('Wallet saved', badge);
    } catch (e: any) {
      setModalError('Failed to save wallet: ' + e.message);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const openWithoutSaving = () => {
    if (!consentToClose && !saveWalletConsent) {
      return setModalError('Confirm you have written down your seed phrase before closing');
    }
    if (!walletData) return setModalError('No wallet data available');
    commitUnlockedWallet(walletData);
    setShowModal(false);
    setAccessPath('hub');
    setPassword('');
    setConfirmPassword('');
    setConsentToClose(false);
    setSaveWalletConsent(false);
    setSecureStep('save');
    toast.info('Wallet open', 'Session only — not saved for next login');
  };

  const saveCurrentWallet = async () => {
    setModalError(null);
    if (!saveWalletName) return setModalError('Enter a wallet name');
    if (
      (savedWalletNames.includes(saveWalletName) && saveWalletName !== currentWalletName)
      || ledgerBookmarks.some((row) => row.name === saveWalletName.trim())
    ) {
      return setModalError('Wallet name already exists. Choose a different name.');
    }
    const wantBio = Platform.OS !== 'web' && enableBioOnSave;
    if (!savePassword && !wantBio) {
      return setModalError(
        Platform.OS === 'web'
          ? 'Set a password to save this wallet in the browser'
          : 'Enable biometrics and/or set a password',
      );
    }
    if (savePassword) {
      if (getPasswordStrength(savePassword).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
      if (savePassword !== saveConfirmPassword) return setModalError('Passwords do not match');
    }
    if (require2faOnSave && (!savePassword || !wantBio)) {
      return setModalError('2FA needs both a password and biometrics');
    }
    if (!wallet) return setModalError('No wallet available');
    try {
      setSaveStatus(wantBio ? 'Confirm passkey on your device' : 'Encrypting wallet…');
      setPasskeyBusy(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const enc = await persistNamedWallet(requireSessionWallet(), saveWalletName, savePassword || null, {
        withBiometrics: wantBio,
        require2fa: require2faOnSave,
      });
      await storage.setItemAsync(SECURE_STORE_KEYS.wallet(saveWalletName), enc);
      if (!savedWalletNames.includes(saveWalletName)) {
        const updatedNames = [...savedWalletNames, saveWalletName];
        setSavedWalletNames(updatedNames);
        await storage.setItemAsync(SECURE_STORE_KEYS.walletNames, JSON.stringify(updatedNames));
      }
      setCurrentWalletName(saveWalletName);
      setShowSaveModal(false);
      setSaveWalletName('');
      setSavePassword('');
      setSaveConfirmPassword('');
      toast.success('Wallet saved', authBadgeForBlob(enc));
      if (logoutAfterSave) {
        const next = pendingSwitch;
        setLogoutAfterSave(false);
        setPendingSwitch(null);
        performLogout();
        if (next) openLoginForAccount(next);
      }
    } catch (e: any) {
      setModalError('Failed to save wallet: ' + e.message);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const enableBiometricsOnCurrent = async (opts?: {
    require2fa?: boolean;
    password?: string | null;
  }) => {
    if (Platform.OS === 'web') {
      toast.error('Phone only', 'Passkey unlock is in the phone app. This browser uses a password.');
      throw new Error('Passkey unlock is only available in the phone app');
    }
    if (!wallet) {
      toast.error('Unlock first', 'Open your wallet, then enable biometrics.');
      throw new Error('Wallet locked');
    }
    const tag = (currentWalletName || saveWalletName || 'Main').trim() || 'Main';
    const want2fa = Boolean(opts?.require2fa);
    const pwd = opts?.password?.trim() || null;
    try {
      setPasskeyBusy(true);
      const enc = await persistNamedWallet(requireSessionWallet(), tag, pwd, {
        withBiometrics: true,
        require2fa: want2fa,
        requireExistingPassword: Boolean(pwd),
      });
      await storage.setItemAsync(SECURE_STORE_KEYS.wallet(tag), enc);
      if (!savedWalletNames.includes(tag)) {
        const updatedNames = [...savedWalletNames, tag];
        setSavedWalletNames(updatedNames);
        await storage.setItemAsync(SECURE_STORE_KEYS.walletNames, JSON.stringify(updatedNames));
      }
      setCurrentWalletName(tag);
      toast.success(
        want2fa ? '2FA enabled' : 'Passkey enabled',
        want2fa
          ? `Next login: password + passkey for “${tag}”`
          : `Next login: Unlock with passkey for “${tag}”`,
      );
    } catch (e: any) {
      toast.error('Failed', e.message || 'Could not enable biometrics');
      throw e;
    } finally {
      setPasskeyBusy(false);
    }
  };

  const [toolsSecurity, setToolsSecurity] = useState<{
    walletName: string;
    hasPasskey: boolean;
    hasPassword: boolean;
    require2fa: boolean;
    biometricsSupported: boolean;
    bioLabel: string;
  } | null>(null);

  const refreshToolsSecurity = useCallback(async () => {
    if (!isLoggedIn || !wallet) {
      setToolsSecurity(null);
      return;
    }
    // Re-probe every time Tools opens — capability can change after system settings
    const bioOk = await refreshBiometricsCapability();
    const label = await biometricsLabel();
    const tag = (currentWalletName || 'Main').trim() || 'Main';
    let hasPasskey = false;
    let hasPassword = false;
    let require2fa = false;
    try {
      const raw = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(tag));
      const info = inspectWalletBlob(raw);
      hasPasskey = info.hasPasskey;
      hasPassword = info.hasPassword;
      require2fa = info.require2fa;
    } catch {
      /* ignore */
    }
    setToolsSecurity({
      walletName: tag,
      hasPasskey,
      hasPassword,
      require2fa,
      // Always expose the panel when logged in; capability flag still drives enable path
      biometricsSupported: bioOk,
      bioLabel: label,
    });
  }, [isLoggedIn, wallet, currentWalletName, refreshBiometricsCapability]);

  useEffect(() => {
    if (showToolsModal) void refreshToolsSecurity();
  }, [showToolsModal, refreshToolsSecurity]);

  const revealRecoveryPhrase = async (opts: {
    method: 'password' | 'passkey' | '2fa';
    password?: string;
  }): Promise<string> => {
    if (activeLedger || getLedgerSession()) {
      throw new Error('A hardware wallet keeps the seed on the device. This app cannot show it.');
    }
    const tag = (currentWalletName || '').trim();
    if (!tag) {
      throw new Error(
        'Save this wallet with a password or passkey first. Then you can show the phrase by entering it again.',
      );
    }
    const raw = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(tag));
    if (!raw) {
      throw new Error(
        'Save this wallet with a password or passkey first. Then you can show the phrase by entering it again.',
      );
    }
    const info = inspectWalletBlob(raw);
    const pwd = String(opts.password || '');
    setPasskeyBusy(true);
    try {
      let data: WalletData;
      if (info.require2fa || opts.method === '2fa') {
        if (!pwd) throw new Error('Enter the password, then confirm the passkey.');
        if (!info.envelope?.passkey || !info.envelope.password) {
          throw new Error('2FA needs both a password and a passkey on the saved wallet.');
        }
        data = await unlockEnvelopeWith2fa(info.envelope, pwd, decryptWallet);
      } else if (opts.method === 'passkey') {
        if (!info.hasPasskey || !info.envelope?.passkey) {
          throw new Error('This wallet has no passkey. Enter the password instead.');
        }
        data = await decryptWithBiometrics(info.envelope.passkey);
      } else {
        if (!pwd) throw new Error('Enter the wallet password.');
        if (!info.hasPassword) {
          throw new Error('This wallet has no password. Confirm the passkey instead.');
        }
        data = await decryptWallet(raw, pwd);
      }
      return recoveryPhraseFromDecrypt(wallet?.address, data);
    } finally {
      setPasskeyBusy(false);
    }
  };

  // Re-check biometrics when opening unlock / create flows
  useEffect(() => {
    if (!isLoggedIn && (accessPath === 'login' || accessPath === 'create' || accessPath === 'hub')) {
      void refreshBiometricsCapability();
    }
  }, [isLoggedIn, accessPath, refreshBiometricsCapability]);

  const downloadCurrentWallet = async () => {
    setModalError(null);
    if (!currentWalletName) return setModalError('No wallet name available');
    if (!downloadPassword) return setModalError('Enter a password');
    if (getPasswordStrength(downloadPassword).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
    if (!wallet) return setModalError('No wallet available');
    try {
      const enc = await encryptWallet(requireSessionWallet(), downloadPassword);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([enc], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `warthog_wallet_${currentWalletName}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, `warthog_wallet_${currentWalletName}.txt`);
        await file.write(enc);
        await Sharing.shareAsync(file.uri);
      }
      
      setShowDownloadModal(false);
      setDownloadPassword('');
      toast.success('Downloaded');
    } catch (e: any) {
      setModalError('Failed to download: ' + e.message);
    }
  };

  const downloadWallet = async () => {
    setModalError(null);
    if (!walletName) return setModalError('Enter a wallet name');
    if (!password) return setModalError('Enter a password');
    if (getPasswordStrength(password).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
    if (password !== confirmPassword) return setModalError('Passwords do not match');
    if (!walletData) return setModalError('No wallet data available');
    try {
      const enc = await encryptWallet(walletData, password);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([enc], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `warthog_wallet_${walletName}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, `warthog_wallet_${walletName}.txt`);
        await file.write(enc);
        await Sharing.shareAsync(file.uri);
      }
      
      setShowModal(false);
      setWalletData(null);
      setMnemonic('');
      setPrivateKeyInput('');
      setWalletName('');
      setPassword('');
      setConfirmPassword('');
      toast.success('Downloaded');
    } catch (e: any) {
      setModalError('Failed to download: ' + e.message);
    }
  };

  const activateLoggedInWallet = (data: WalletData, name: string) => {
    commitUnlockedWallet(data, name);
    setPassword('');
    setSelectedWalletToLogin('');
    setShowWalletSelection(false);
    setError(null);
  };

  const openLoginForAccount = (id: string) => {
    const ledger = id.startsWith('ledger:');
    const accountName = id.slice(id.indexOf(':') + 1);
    setWalletAction('login');
    setAccessPath('login');
    if (ledger) {
      setSelectedWalletToLogin('');
      setSelectedLedgerName(accountName);
      setDraftLedgerName(accountName);
      setShowWalletSelection(true);
      return;
    }
    setSelectedLedgerName(null);
    void selectWalletForLogin(accountName);
  };

  const switchLoggedInAccount = (id: string) => {
    const savedHere = Boolean(currentWalletName) && savedWalletNames.includes(currentWalletName);
    if (activeLedger || savedHere) {
      performLogout();
      openLoginForAccount(id);
      return;
    }
    setPendingSwitch(id);
    setLogoutAfterSave(true);
    setShowSaveModal(true);
  };

  const selectWalletForLogin = async (name: string) => {
    setSelectedWalletToLogin(name);
    setShowWalletSelection(true);
    setError(null);
    setPassword('');
    try {
      const enc = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(name));
      const info = inspectWalletBlob(enc);
      setSelectedLoginBadge(authBadgeForBlob(enc));
      setSelectedLoginHasPasskey(info.hasPasskey);
      setSelectedLoginHasPassword(info.hasPassword);
      setSelectedLoginRequire2fa(info.require2fa);
    } catch {
      setSelectedLoginBadge('Saved');
      setSelectedLoginHasPasskey(false);
      setSelectedLoginHasPassword(true);
      setSelectedLoginRequire2fa(false);
    }
  };

  const loadWallet = async (name: string) => {
    const enc = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(name));
    if (!enc) return setError('Wallet not found');
    const info = inspectWalletBlob(enc);
    if (info.require2fa) {
      return setError('2FA wallet: enter password, then tap Unlock with password + biometrics');
    }
    if (!password) return setError('Enter password');
    try {
      setSaveStatus('Unlocking…');
      setPasskeyBusy(true);
      setError(null);
      const data = await decryptWallet(enc, password);
      activateLoggedInWallet(data, name);
    } catch (e: any) {
      setError('Wrong password: ' + e.message);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const loadWalletWithBiometrics = async (name: string, withPassword: boolean) => {
    const enc = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(name));
    if (!enc) return setError('Wallet not found');
    const info = inspectWalletBlob(enc);
    if (!info.hasPasskey || !info.envelope?.passkey) {
      return setError('This wallet has no biometric unlock — use password, or re-enable biometrics after unlock');
    }
    if (withPassword && !password) {
      return setError('Enter password, then confirm with biometrics');
    }
    if (!withPassword && info.require2fa) {
      return setError('This wallet requires password + biometrics. Enter password, then unlock with 2FA.');
    }
    try {
      setSaveStatus('Confirm passkey on your device');
      setPasskeyBusy(true);
      setError(null);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      let data: WalletData;
      if (info.require2fa || withPassword) {
        data = await unlockEnvelopeWith2fa(info.envelope!, password, decryptWallet);
      } else {
        data = await decryptWithBiometrics(info.envelope!.passkey!);
      }
      setSaveStatus('Unlocking…');
      activateLoggedInWallet(data, name);
    } catch (e: any) {
      setError(e.message || 'Biometric unlock failed');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const pickAndLoginFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      
      const content = await (Platform.OS === 'web'
        ? fetch(result.assets[0].uri).then(r => r.text())
        : new File(result.assets[0].uri).text()
      );
      
      setUploadedFileContent(content);
      setUploadedFileName(result.assets[0].name || 'wallet.txt');
      toast.info('File loaded', 'Enter password below to decrypt');
    } catch (e: any) {
      setError('Failed to read file: ' + e.message);
    }
  };

  const nameFromWalletFile = (filename: string | null | undefined): string => {
    const leaf = String(filename || '').split(/[/\\]/).pop() || '';
    return leaf
      .replace(/\.[^.]+$/, '')
      .replace(/^warthog_wallet[_-]*/i, '')
      .trim();
  };

  const beginNamedRestore = (data: WalletData, suggestedName: string) => {
    setWalletData({
      ...data,
      mnemonic: String(data.mnemonic || '').trim() || undefined,
      privateKey: String(data.privateKey || '').replace(/^0x/i, ''),
    });
    setWalletName(suggestedName);
    setWalletAction('import');
    setPassword('');
    setConfirmPassword('');
    setConsentToClose(false);
    setSaveWalletConsent(false);
    setSecureStep('save');
    setModalError(null);
    setShowModal(true);
    setError(null);
  };

  const loginFromFile = async () => {
    if (!uploadedFileContent || !password) return setError('No file or password');
    try {
      const data = await decryptWallet(uploadedFileContent, password);
      const suggested = nameFromWalletFile(uploadedFileName) || 'Imported';
      setUploadedFileContent(null);
      setPassword('');
      beginNamedRestore(data, suggested);
    } catch (e: any) {
      setError('Wrong password or invalid file: ' + e.message);
    }
  };

  const loginFromWalletQr = async () => {
    if (!scannedWalletPayload || !password) return setError('Scan a wallet QR and enter the export password');
    try {
      const data = await decryptWallet(scannedWalletPayload, password);
      setScannedWalletPayload(null);
      setPassword('');
      beginNamedRestore(data, 'Imported QR');
    } catch (e: any) {
      setError('Wrong password or invalid wallet QR: ' + e.message);
    }
  };

  const submitUnlockWith2fa = () => {
    if (!password || passkeyBusy || !selectedWalletToLogin) return;
    void loadWalletWithBiometrics(selectedWalletToLogin, true);
  };

  const submitUnlockWithPassword = () => {
    if (!password || passkeyBusy || !selectedWalletToLogin) return;
    void loadWallet(selectedWalletToLogin);
  };

  const spendableWart = balanceAvailable || balance;

  const handleMaxWart = () => {
    if (spendableWart && spendableWart !== '0.00000000') {
      setAmount(spendableWart);
    }
  };

  const handleSend = async (confirmed = false) => {
    if (!wallet || !toAddr || !amount) return setError('Fill all fields');
    if (!isValidAddress(toAddr)) {
      return setError('Invalid toAddr: must be exactly 48 hex characters');
    }
    if (!confirmed) {
      setSendConfirmOpen(true);
      return;
    }
    const ledger = getLedgerSession();
    sendFlow.begin(ledger
      ? 'Approve the amount, fee, and recipient on the Nano. Leave the Warthog app open.'
      : 'Checking your free WART…');
    setError(null);
    let submitted = false;
    try {
      // Live free-balance check — locked WART cannot be sent
      const liveBal = await fetchAccountBalance(selectedNode, wallet.address);
      setBalance(liveBal.balanceStr);
      setBalanceAvailable(liveBal.availableStr);
      setBalanceLocked(liveBal.lockedStr);
      if (amountExceedsAvailable(amount.trim(), liveBal.availableStr)) {
        const msg = insufficientFreeBalanceMessage({
          available: liveBal.availableStr,
          locked: liveBal.lockedStr,
          unit: 'WART',
        });
        setAmount(liveBal.availableStr);
        setError(msg);
        sendFlow.finish(false, 'Insufficient free balance', msg);
        return;
      }
      if (!ledger) sendFlow.setStep('Signing and submitting the transfer…');

      const headData = await fetchChainHead(selectedNode);
      setCurrentBlockHeight(headData.pinHeight);
      const nonceId = manualNonce ? parseInt(manualNonce) : nextNonce;

      const trimmed = toAddr.trim().replace(/^0x/i, '');
      const recipient = Address.fromHex(trimmed) ?? Address.fromRaw(trimmed);
      if (!recipient) throw new Error('Invalid recipient address');

      const wartAmount = Wart.parse(amount.trim());
      if (!wartAmount) throw new Error('Invalid amount');

      const feeWart = fee || DEFAULT_FEE;
      const feeE8 = await fetchFeeE8(selectedNode, feeWart);
      // feeE8 already node-rounded; do not ceil-re-round (0.01 → 1000448 bug)
      const roundedFee = RoundedFee.fromE8(BigInt(feeE8), false);
      if (!roundedFee) throw new Error('Invalid fee');

      const nonce = NonceId.fromNumber(nonceId);
      if (!nonce) throw new Error('Invalid nonce');

      const tx = ledger
        ? await (async () => {
            const signed = await signWartTransferOnLedger(ledger, {
              pinHash: headData.pinHash,
              pinHeight: headData.pinHeight,
              nonceId,
              feeE8: BigInt(feeE8),
              toAddress: recipient.hex,
              amountE8: wartAmount.E8,
            });
            return ledgerWartSubmitJson(signed, selectedNode);
          })()
        : await (async () => {
            // Use normalized pin (mainnet flat + DeFi nested) — do not rely on nested-only chainHead
            const ctx = await createTxContext(selectedNode, roundedFee, nonce);
            return signPreparedWarthog(ctx, {
              op: 'wartTransfer',
              toAddr: recipient.hex,
              amountE8: wartAmount.E8.toString(),
            }, wallet.address);
          })();
      const res = await submitWarthogTransaction(selectedNode, tx);
      const sentTxHash = res.txHash;
      submitted = true;
      sendFlow.finish(true, 'Sent', `${amount.trim()} WART submitted. ${sentTxHash.slice(0, 18)}…`);
      setSentTxLog((prev) => [sentTxHash, ...prev]);
      setShowRecentTxLog(true);
      setTimeout(() => setShowRecentTxLog(false), 35000); // Hide after 35 seconds
      const updatedNextNonce = Math.max(nextNonce || 0, nonceId + 1);
      setNextNonce(updatedNextNonce);
      await savePersistentNonce(wallet.address, updatedNextNonce);
      setManualNonce('');
      onRefresh();
    } catch (e: any) {
      console.error(e);
      let msg = e.response?.data?.error || e.message || 'Send failed';
      if (/insufficient\s+(token\s+)?balance/i.test(msg)) {
        msg = insufficientFreeBalanceMessage({
          available: balanceAvailable,
          locked: balanceLocked,
          unit: 'WART',
        });
      }
      setError(msg);
      if (!submitted) sendFlow.finish(false, 'Send failed', msg);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setStringAsync(text);
    toast.success('Copied', `${label} copied`);
  };

  // Address Book handlers
  const handleContactSelect = (contact: Contact) => {
    setToAddr(contact.address);
    setSelectedContact(contact);
    setShowAddressBook(false);
  };

  const savedCount = savedWalletNames.length + ledgerBookmarks.length;
  const hasSavedWallets = savedCount > 0;
  const selectedLedger = ledgerBookmarks.find((row) => row.name === selectedLedgerName) ?? null;
  const loginChoices = [
    ...savedWalletNames.map((name) => ({ kind: 'saved' as const, name, address: '' })),
    ...ledgerBookmarks.map((row) => ({ kind: 'ledger' as const, name: row.name, address: row.address })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const accessTitle =
    accessPath === 'hub'
      ? hasSavedWallets
        ? 'Welcome back'
        : 'Get started'
      : accessPath === 'login'
        ? 'Unlock wallet'
        : accessPath === 'create'
          ? 'Create wallet'
          : accessPath === 'have'
            ? 'Restore wallet'
            : accessPath === 'derive'
              ? 'Seed phrase'
              : accessPath === 'import'
                ? 'Private key'
                : accessPath === 'load'
                  ? 'Wallet file'
                  : accessPath === 'ledger'
                    ? 'Ledger'
                    : 'Wallet';
  const passkeyOnThisDevice = Platform.OS !== 'web';
  const accessHint =
    accessPath === 'hub'
      ? hasSavedWallets
        ? ledgerBookmarks.length
          ? 'Unlock a saved name. A Ledger name connects the Nano.'
          : passkeyOnThisDevice
            ? 'Unlock with biometrics or password, or start another path.'
            : 'Unlock with password, or start another path.'
        : passkeyOnThisDevice
          ? 'Create with biometrics (optional password / 2FA).'
          : 'Create a wallet and set a password. Passkey unlock is in the phone app.'
      : accessPath === 'login'
        ? selectedLedger
          ? 'Connect the Nano. It approves this address. This phone keeps no seed.'
          : selectedLoginRequire2fa
            ? '2FA: enter password, then confirm with passkey.'
            : selectedLoginHasPasskey
              ? 'Tap Unlock with passkey, or use password if you set one.'
              : 'Choose a saved wallet and enter its password.'
        : accessPath === 'create'
          ? 'Name the wallet. Then create a seed, or connect the Nano.'
          : accessPath === 'have'
            ? 'How do you want to restore access?'
            : accessPath === 'ledger'
              ? 'Open the Warthog app on the Nano S+. The address is confirmed on the device.'
            : accessPath === 'derive'
              ? 'Enter the 12 or 24 word phrase for this wallet.'
              : accessPath === 'import'
                ? 'Paste the 64-character private key.'
                : accessPath === 'load'
                  ? 'Open an encrypted warthog_wallet.txt file, then name it to save on this device.'
                  : '';
  const showAccessBack = accessPath !== 'hub';
  const accessBackTarget: AccessPath =
    accessPath === 'ledger' && ledgerOrigin === 'create'
      ? 'create'
      : accessPath === 'derive' || accessPath === 'import' || accessPath === 'load' || accessPath === 'ledger'
        ? 'have'
        : 'hub';

  return (
    <View style={styles.container}>
      {!isLoggedIn ? (
        <View style={{ flex: 1 }}>
        <ScrollView style={styles.loginSection} contentContainerStyle={{ paddingBottom: 40 }}>
          {brand}
          {showAccessBack ? (
            <TouchableOpacity onPress={() => goAccessPath(accessBackTarget)} disabled={creatingWallet || passkeyBusy || ledgerBusy}>
              <Text style={[styles.label, { color: defiColors.goldHover }]}>← Back</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.label, { opacity: 0.5, fontSize: 11, textTransform: 'uppercase' }]}>
              No wallet open
            </Text>
          )}
          <Text style={[styles.label, { fontSize: 22, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 4 }]}>
            {accessTitle}
          </Text>
          <Text style={[styles.label, { marginBottom: 16 }]}>{accessHint}</Text>

          {/* ── Hub ── */}
          {accessPath === 'hub' && (
            <>
              {hasSavedWallets && (
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={() => goAccessPath('login')}
                >
                  <Text style={styles.bigButtonPrimaryText}>Unlock saved wallet</Text>
                  <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                    {savedCount} on this device
                    {biometricsSupported ? ' · passkey ready' : ''}
                    {ledgerBookmarks.length ? ' · Ledger' : ''}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.bigButton, !hasSavedWallets && styles.bigButtonPrimary]}
                onPress={() => goAccessPath('create')}
              >
                <Text style={!hasSavedWallets ? styles.bigButtonPrimaryText : styles.bigButtonText}>
                  Create new wallet
                </Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  Name → unlock options → seed
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bigButton} onPress={() => goAccessPath('have')}>
                <Text style={styles.bigButtonText}>
                  {hasSavedWallets ? 'Other restore options' : 'I already have a wallet'}
                </Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  Seed, key, file, QR, or Ledger
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Have ── */}
          {accessPath === 'have' && (
            <>
              {hasSavedWallets && (
                <TouchableOpacity style={styles.bigButton} onPress={() => goAccessPath('login')}>
                  <Text style={styles.bigButtonText}>Saved on this device</Text>
                  <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                    {savedCount} wallet{savedCount === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.bigButton} onPress={() => goAccessPath('derive')}>
                <Text style={styles.bigButtonText}>Seed phrase</Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  12 or 24 words
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bigButton} onPress={() => goAccessPath('import')}>
                <Text style={styles.bigButtonText}>Private key</Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  64-character hex
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bigButton} onPress={() => goAccessPath('load')}>
                <Text style={styles.bigButtonText}>Encrypted file</Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  warthog_wallet.txt
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bigButton}
                onPress={() => {
                  setLedgerOrigin('have');
                  goAccessPath('ledger');
                }}
              >
                <Text style={styles.bigButtonText}>Ledger</Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  Nano S+ with the Warthog app open
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bigButton}
                onPress={() => {
                  setScannedWalletPayload(null);
                  setShowWalletQrScanner(true);
                }}
              >
                <Text style={styles.bigButtonText}>Scan wallet QR (from wartbunker)</Text>
              </TouchableOpacity>
              {scannedWalletPayload && (
                <>
                  <Text style={styles.label}>Wallet QR loaded — enter the export password</Text>
                  <StyledTextInput
                    placeholder="Export password"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={loginFromWalletQr}
                    returnKeyType="go"
                  />
                  <TouchableOpacity style={styles.bigButton} onPress={loginFromWalletQr}>
                    <Text style={styles.bigButtonText}>Decrypt & Import Wallet</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {/* ── Login ── */}
          {accessPath === 'login' && (
            <>
              {!showWalletSelection && (
                <>
                  <Text style={styles.label}>Wallet</Text>
                  {loginChoices.map((choice) => {
                    const selected = choice.kind === 'ledger'
                      ? selectedLedgerName === choice.name
                      : selectedWalletToLogin === choice.name;
                    return (
                      <TouchableOpacity
                        key={`${choice.kind}:${choice.name}`}
                        style={[styles.bigButton, selected && styles.bigButtonPrimary]}
                        onPress={() => {
                          setError(null);
                          setPassword('');
                          if (choice.kind === 'ledger') {
                            setSelectedWalletToLogin('');
                            setSelectedLedgerName(choice.name);
                            setDraftLedgerName(choice.name);
                            setShowWalletSelection(true);
                            return;
                          }
                          setSelectedLedgerName(null);
                          void selectWalletForLogin(choice.name);
                        }}
                      >
                        <Text style={selected ? styles.bigButtonPrimaryText : styles.bigButtonText}>
                          {choice.name}
                        </Text>
                        {choice.kind === 'ledger' ? (
                          <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                            Ledger · {choice.address.slice(0, 8)}…{choice.address.slice(-4)}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                  {loginChoices.length === 0 && (
                    <Text style={styles.label}>No saved wallets on this device.</Text>
                  )}
                </>
              )}
              {showWalletSelection && selectedLedger && (
                <>
                  <Text style={styles.label}>Ledger: {selectedLedger.name}</Text>
                  <Text style={styles.key} selectable>{selectedLedger.address}</Text>
                  <Text style={styles.label}>
                    {selectedLedger.pathType === 'hardened' ? 'BIP44' : 'Legacy'}
                    {selectedLedger.index ? ` · index ${selectedLedger.index}` : ''}
                  </Text>
                  <Text style={styles.label}>{ledgerConnectHint()}</Text>
                  <StyledTextInput
                    placeholder="Wallet name"
                    value={draftLedgerName}
                    onChangeText={setDraftLedgerName}
                  />
                  {draftLedgerName.trim() !== selectedLedger.name ? (
                    <TouchableOpacity
                      style={styles.bigButton}
                      disabled={ledgerBusy || !draftLedgerName.trim()}
                      onPress={() => void renameSelectedLedger()}
                    >
                      <Text style={styles.bigButtonText}>{ledgerBusy ? 'Saving…' : 'Save name'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.bigButton, styles.bigButtonPrimary]}
                    disabled={ledgerBusy || !ledgerTransportAvailable()}
                    onPress={() => void connectNamedLedger({
                      name: selectedLedger.name,
                      pathType: selectedLedger.pathType,
                      index: selectedLedger.index,
                      expectedAddress: selectedLedger.address,
                    })}
                  >
                    <Text style={styles.bigButtonPrimaryText}>
                      {ledgerBusy ? 'Waiting for the Ledger…' : 'Connect Ledger'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.bigButton}
                    disabled={ledgerBusy}
                    onPress={() => {
                      setShowWalletSelection(false);
                      setSelectedLedgerName(null);
                      setError(null);
                    }}
                  >
                    <Text style={styles.bigButtonText}>← Back to wallet list</Text>
                  </TouchableOpacity>
                </>
              )}
              {showWalletSelection && selectedWalletToLogin && (
                <>
                  <Text style={styles.label}>Unlock: {selectedWalletToLogin}</Text>
                  {!!selectedLoginBadge && (
                    <Text style={[styles.label, { color: defiColors.goldHover }]}>
                      {selectedLoginBadge}
                    </Text>
                  )}
                  {selectedLoginRequire2fa ? (
                    <>
                      <Text style={styles.label}>
                        2FA is on: password and passkey.
                      </Text>
                      <StyledTextInput
                        placeholder="Wallet password"
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        onSubmitEditing={submitUnlockWith2fa}
                        returnKeyType="go"
                      />
                      <TouchableOpacity
                        style={[styles.bigButton, styles.bigButtonPrimary]}
                        disabled={passkeyBusy || !password}
                        onPress={submitUnlockWith2fa}
                      >
                        <Text style={styles.bigButtonPrimaryText}>
                          {passkeyBusy
                            ? saveStatus
                            : 'Unlock with password + passkey'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      {selectedLoginHasPasskey && (
                        <TouchableOpacity
                          style={[styles.bigButton, styles.bigButtonPrimary]}
                          disabled={passkeyBusy}
                          onPress={() =>
                            void loadWalletWithBiometrics(selectedWalletToLogin, false)
                          }
                        >
                          <Text style={styles.bigButtonPrimaryText}>
                            {passkeyBusy
                              ? saveStatus
                              : 'Unlock with passkey'}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {selectedLoginHasPassword && (
                        <>
                          {selectedLoginHasPasskey && (
                            <Text style={styles.label}>Or use password</Text>
                          )}
                          <StyledTextInput
                            placeholder="Wallet password"
                            secureTextEntry={!showPassword}
                            value={password}
                            onChangeText={setPassword}
                            onSubmitEditing={submitUnlockWithPassword}
                            returnKeyType="go"
                          />
                          <TouchableOpacity
                            style={styles.bigButton}
                            disabled={passkeyBusy || !password}
                            onPress={submitUnlockWithPassword}
                          >
                            <Text style={styles.bigButtonText}>
                              {passkeyBusy ? saveStatus : 'Unlock with password'}
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.bigButton}
                    onPress={() => {
                      setShowWalletSelection(false);
                      setSelectedWalletToLogin('');
                      setPassword('');
                      setError(null);
                    }}
                  >
                    <Text style={styles.bigButtonText}>← Back to wallet list</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {/* ── Create: name first ── */}
          {accessPath === 'create' && (
            <>
              <Text style={styles.label}>
                Step 1 of 3 — pick a name. Next: unlock options, then write down your seed.
              </Text>
              <StyledTextInput
                placeholder="Wallet name (e.g. main)"
                value={walletName}
                onChangeText={setWalletName}
                onSubmitEditing={() => void handleWalletAction()}
                returnKeyType="go"
              />
              <Text style={styles.label}>Word count: {wordCount}</Text>
              <View style={styles.buttonRow}>
                {(['12', '24'] as const).map((w) => (
                  <TouchableOpacity
                    key={w}
                    style={[styles.actionButton, wordCount === w && styles.activeButton]}
                    onPress={() => setWordCount(w)}
                  >
                    <Text
                      style={[
                        styles.actionButtonText,
                        wordCount === w && styles.activeButtonText,
                      ]}
                    >
                      {w}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Path: {pathType}</Text>
              <View style={styles.buttonRow}>
                {(['hardened', 'normal'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.actionButton, pathType === p && styles.activeButton]}
                    onPress={() => setPathType(p)}
                  >
                    <Text
                      style={[
                        styles.actionButtonText,
                        pathType === p && styles.activeButtonText,
                      ]}
                    >
                      {p === 'hardened' ? 'BIP44' : 'Legacy'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {creatingWallet ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={defiColors.goldHover} />
                  <Text style={styles.loadingText}>Generating…</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={() => void handleWalletAction()}
                  disabled={!walletName.trim()}
                >
                  <Text style={styles.bigButtonPrimaryText}>Continue — unlock options</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.bigButton}
                disabled={!walletName.trim() || ledgerBusy}
                onPress={() => {
                  setLedgerOrigin('create');
                  goAccessPath('ledger');
                }}
              >
                <Text style={styles.bigButtonText}>Connect Ledger</Text>
                <Text style={[styles.label, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>
                  The Nano keeps the key
                </Text>
              </TouchableOpacity>
            </>
          )}

          {accessPath === 'ledger' && (
            <>
              <Text style={styles.label}>{ledgerConnectHint()}</Text>
              <Text style={styles.label}>
                This session can send WART. Swaps, liquidity, and Ethereum stay on a software wallet.
              </Text>
              <StyledTextInput
                placeholder="Wallet name (e.g. Ledger)"
                value={walletName}
                onChangeText={setWalletName}
              />
              <Text style={styles.label}>Path: {pathType}</Text>
              <View style={styles.buttonRow}>
                {(['hardened', 'normal'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.actionButton, pathType === p && styles.activeButton]}
                    onPress={() => setPathType(p)}
                    disabled={ledgerBusy}
                  >
                    <Text style={[styles.actionButtonText, pathType === p && styles.activeButtonText]}>
                      {p === 'hardened' ? 'BIP44' : 'Legacy'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.bigButton, styles.bigButtonPrimary]}
                disabled={ledgerBusy || !ledgerTransportAvailable()}
                onPress={() => void connectNamedLedger({
                  name: walletName.trim() || 'Ledger',
                  pathType,
                  index: 0,
                })}
              >
                <Text style={styles.bigButtonPrimaryText}>
                  {ledgerBusy ? 'Waiting for the Ledger…' : 'Connect Ledger'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Derive ── */}
          {accessPath === 'derive' && (
            <>
              <StyledTextInput
                placeholder="12 or 24 word seed phrase"
                value={mnemonic}
                onChangeText={setMnemonic}
                multiline
                numberOfLines={4}
              />
              <StyledTextInput
                placeholder="Wallet name (optional)"
                value={walletName}
                onChangeText={setWalletName}
                onSubmitEditing={() => void handleWalletAction()}
                returnKeyType="go"
              />
              <View style={styles.buttonRow}>
                {(['12', '24'] as const).map((w) => (
                  <TouchableOpacity
                    key={w}
                    style={[styles.actionButton, wordCount === w && styles.activeButton]}
                    onPress={() => setWordCount(w)}
                  >
                    <Text
                      style={[
                        styles.actionButtonText,
                        wordCount === w && styles.activeButtonText,
                      ]}
                    >
                      {w}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {creatingWallet ? (
                <ActivityIndicator size="large" color={defiColors.goldHover} />
              ) : (
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={() => void handleWalletAction()}
                >
                  <Text style={styles.bigButtonPrimaryText}>Recover wallet</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ── Import ── */}
          {accessPath === 'import' && (
            <>
              <StyledTextInput
                placeholder="64-character hex private key"
                value={privateKeyInput}
                onChangeText={setPrivateKeyInput}
              />
              <StyledTextInput
                placeholder="Wallet name (optional)"
                value={walletName}
                onChangeText={setWalletName}
                onSubmitEditing={() => void handleWalletAction()}
                returnKeyType="go"
              />
              {creatingWallet ? (
                <ActivityIndicator size="large" color={defiColors.goldHover} />
              ) : (
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={() => void handleWalletAction()}
                >
                  <Text style={styles.bigButtonPrimaryText}>Import wallet</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ── Load file ── */}
          {accessPath === 'load' && (
            <>
              <TouchableOpacity
                style={[styles.bigButton, styles.bigButtonPrimary]}
                onPress={() => void pickAndLoginFromFile()}
              >
                <Text style={styles.bigButtonPrimaryText}>Browse for wallet file</Text>
              </TouchableOpacity>
              {uploadedFileName && (
                <Text style={[styles.label, { color: defiColors.goldHover }]}>
                  Selected: {uploadedFileName}
                </Text>
              )}
              {uploadedFileContent && (
                <>
                  <StyledTextInput
                    placeholder="File password"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={() => void loginFromFile()}
                    returnKeyType="go"
                  />
                  <TouchableOpacity style={styles.bigButton} onPress={() => void loginFromFile()}>
                    <Text style={styles.bigButtonText}>Open file</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <SavingOverlay visible={passkeyBusy} status={saveStatus} />
        </View>
      ) : wallet ? (
        <WalletChrome
          name={(currentWalletName || 'Wallet').trim() || 'Wallet'}
          accountId={accountChoices[0]?.id ?? 'session'}
          accounts={accountChoices}
          onAccount={switchLoggedInAccount}
          onManageAccounts={() => {
            setSettingsScreen('accounts');
            setSection('settings');
          }}
          section={section}
          settingsOpen={section === 'settings'}
          chains={chains}
          chain={chain}
          address={addressForChain(chain, wallet)}
          onSection={(next) => {
            setSection(next);
            setTradeView('menu');
            setChainSwapOpen(false);
            if (next !== 'settings') setSettingsScreen('menu');
          }}
          onChain={(next) => { if (next !== chain) setChain(next); }}
          onLock={() => {
            handleLogout();
            setWalletAction('login');
            setAccessPath('hub');
          }}
          onSettings={() => {
            setSettingsScreen('menu');
            setSection((current) => current === 'settings' ? 'wallet' : 'settings');
          }}
          onCopy={() => {
            const address = addressForChain(chain, wallet);
            if (address) copyToClipboard(address, 'Address');
          }}
          onReceive={() => setShowReceive(true)}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 28 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={['#E79300']}
                tintColor="#E79300"
              />
            )}
          >
          {section === 'wallet' ? (
            <>
          <Text style={shellTitle}>Wallet</Text>
          <DefiBalanceHero
            wallet={wallet}
            currentWalletName={currentWalletName}
            accountKind={activeLedger ? 'ledger' : 'software'}
            balance={balance}
            balanceAvailable={balanceAvailable}
            balanceLocked={balanceLocked}
            usdBalance={usdBalance}
            nodeLabel={nodeList.find((node) => normalizeNodeUrl(node.url) === normalizeNodeUrl(selectedNode))?.name || selectedNode}
            networkLabel={isDefi ? 'DeFi Testnet' : 'Mainnet'}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onCopyAddress={(address) => copyToClipboard(address, 'Address')}
            onEthActivity={() => setSection('activity')}
            chain={chain}
            chains={chains}
            onChainChange={setChain}
            showChainPicker={false}
            showWalletName={false}
            onSwitchNetwork={() => {
              const nextFamily: NodeNetwork = isDefi ? 'mainnet' : 'defi-testnet';
              const remembered = nodeSelection[nextFamily];
              const next = nodeList.find((node) => node.network === nextFamily && normalizeNodeUrl(node.url) === normalizeNodeUrl(remembered))
                || nodeList.find((node) => node.network === nextFamily);
              if (next) selectNetwork(next.url, next.network);
              else toast.error('No node', `Add a ${nextFamily === 'mainnet' ? 'Mainnet' : 'DeFi Testnet'} node in Settings.`);
            }}
            solGeneration={solTick}
            hemiGeneration={hemiTick}
            onAddEthereum={() => { void addLedgerEthereum(); }}
            addingEthereum={ledgerEthBusy}
            onAddBitcoin={() => { void addLedgerBitcoin(); }}
            addingBitcoin={ledgerBtcBusy}
            onAddSolana={() => { void addLedgerSolana(); }}
            addingSolana={ledgerSolBusy}
            ethGeneration={ethTick}
            ethGenerationBlock={ethBlock}
            openSendTick={chainSendTick}
          />
          <WartHomeActions
            actions={
              chain === 'wart'
                ? (isDefi ? ['send', 'swap', 'liquidity', 'mint'] : ['send', 'receive'])
                : (chainHasSwap(chain, {
                    ethAddress: wallet.ethAddress,
                    btcAddress: wallet.btcAddress,
                    solAddress: wallet.solAddress,
                    defi: isDefi,
                  }) ? ['send', 'receive', 'swap'] : ['send', 'receive'])
            }
            onPress={chain === 'wart' ? onWartAction : onChainAction}
          />
          {chains.length < 2 ? (
            <Text style={shellHint}>
              {activeLedger
                ? 'This Ledger session is the Warthog account. Bitcoin and Solana still need the phone apps named on this card.'
                : 'Bitcoin, Ethereum, Hemi, and Solana come from the recovery phrase. A private-key import only has the Warthog account.'}
            </Text>
          ) : null}

          {isDefi && chain === 'wart' && (
            <DefiOverviewSection
              part="assets"
              wallet={wallet}
              selectedNode={selectedNode}
              nextNonce={nextNonce}
              orderedAssets={defi.orderedAssets}
              reorderableAssetCount={defi.watchedAssets.length}
              openOrders={defi.openOrders}
              liquidityPositions={defi.liquidityPositions}
              loadingAssets={defi.loadingAssets}
              loadingOrders={defi.loadingOrders}
              loadingLiquidity={defi.loadingLiquidity}
              onAddAsset={(hash) => defi.addWatchedAsset(hash)}
              onRemoveAsset={(hash) => defi.removeWatchedAsset(hash)}
              onReorderAssets={defi.reorderWatchedAssets}
              onSendAsset={(asset) => {
                defi.setSendAssetPrefill({
                  hash: asset.hash,
                  name: asset.name,
                  decimals: asset.decimals,
                  balance: asset.available ?? asset.balance,
                  available: asset.available ?? asset.balance,
                  locked: asset.locked ?? '0',
                  total: asset.balance,
                });
                setShowSendAssetModal(true);
              }}
              onOpenDex={(prefill) => {
                if (prefill) defi.setDexPoolPrefill(prefill);
                openTrade(prefill?.mode === 'pool' ? 'liquidity' : 'swap');
                if (prefill?.mode === 'limit') setDexFocus('market');
              }}
              onRefreshOrders={defi.refreshOpenOrders}
              onRefreshLiquidity={defi.refreshLiquidity}
              onNonceBump={afterSpendSuccess}
            />
          )}

          {showRecentTxLog && sentTxLog.length > 0 && (
            <View style={styles.logSection}>
              <Text style={styles.sectionTitle}>Recent Transaction</Text>
              <TouchableOpacity onPress={() => copyToClipboard(sentTxLog[0], 'Tx Hash')} style={styles.logItem}>
                <Text style={styles.logText}>{sentTxLog[0]}</Text>
              </TouchableOpacity>
            </View>
          )}
            </>
          ) : null}

          {section === 'trade' ? (
            tradeView === 'menu' ? (
              <TradePane
                chain={chain}
                defi={isDefi}
                canSwap={chainHasSwap(chain, {
                  ethAddress: wallet.ethAddress,
                  btcAddress: wallet.btcAddress,
                  solAddress: wallet.solAddress,
                  defi: isDefi,
                })}
                canSafeTrade={Boolean(exchangeTool)}
                canAave={chain === 'ethereum' && Boolean(wallet.ethAddress)}
                onSwap={() => openTrade('swap')}
                onSafeTrade={() => setShowSafeTrade(true)}
                onAave={() => setShowAave(true)}
              />
            ) : (
              <View>
                <TouchableOpacity onPress={() => { setTradeView('menu'); setChainSwapOpen(false); }}>
                  <Text style={shellBack}>← Trade</Text>
                </TouchableOpacity>
                <Text style={shellTitle}>{tradeView === 'liquidity' ? 'Liquidity' : 'Swap'}</Text>
                {isDefi && chain === 'wart' ? (
                  <DexModal
                    embedded
                    visible
                    onClose={() => setTradeView('menu')}
                    wallet={wallet}
                    selectedNode={selectedNode}
                    nextNonce={nextNonce}
                    poolPrefill={defi.dexPoolPrefill}
                    onPrefillConsumed={() => defi.setDexPoolPrefill(null)}
                    onSuccess={afterSpendSuccess}
                    assetBalances={defi.orderedAssets}
                    wartAvailable={balanceAvailable}
                    wartLocked={balanceLocked}
                    wartTotal={balance}
                    allowedModes={tradeView === 'liquidity' ? ['pool'] : ['market', 'limit']}
                    requestedMode={dexFocus}
                    onRequestedMode={clearDexFocus}
                  />
                ) : null}
                {isDefi && chain === 'wart' && tradeView === 'liquidity' ? (
                  <DefiOverviewSection
                    part="liquidity"
                    wallet={wallet}
                    selectedNode={selectedNode}
                    nextNonce={nextNonce}
                    orderedAssets={defi.orderedAssets}
                    reorderableAssetCount={defi.watchedAssets.length}
                    openOrders={defi.openOrders}
                    liquidityPositions={defi.liquidityPositions}
                    loadingAssets={defi.loadingAssets}
                    loadingOrders={defi.loadingOrders}
                    loadingLiquidity={defi.loadingLiquidity}
                    onAddAsset={(hash) => defi.addWatchedAsset(hash)}
                    onRemoveAsset={(hash) => defi.removeWatchedAsset(hash)}
                    onReorderAssets={defi.reorderWatchedAssets}
                    onSendAsset={() => {}}
                    onOpenDex={(prefill) => {
                      if (prefill) defi.setDexPoolPrefill(prefill);
                      setDexFocus('pool');
                    }}
                    onRefreshOrders={defi.refreshOpenOrders}
                    onRefreshLiquidity={defi.refreshLiquidity}
                    onNonceBump={afterSpendSuccess}
                  />
                ) : null}
                {wallet.ethAddress ? (
                  <EthSwapModal
                    visible={tradeView === 'swap' && chain === 'ethereum'}
                    onClose={() => setTradeView('menu')}
                    address={wallet.ethAddress}
                    solAddress={wallet.solAddress}
                    onBalances={refreshEthereum}
                    onSolana={() => setSolTick((n) => n + 1)}
                  />
                ) : null}
                {wallet.btcAddress && wallet.ethAddress ? (
                  <HemiTunnelModal
                    lockAsset="btc"
                    visible={tradeView === 'swap' && chain === 'bitcoin'}
                    btcAddress={wallet.btcAddress}
                    hemiAddress={wallet.ethAddress}
                    ledger={activeLedger}
                    onClose={() => setTradeView('menu')}
                  />
                ) : null}
                {wallet.ethAddress ? (
                  <HemiSwapModal
                    visible={tradeView === 'swap' && chain === 'hemi'}
                    onClose={() => setTradeView('menu')}
                    address={wallet.ethAddress}
                    btcAddress={wallet.btcAddress}
                    ledger={activeLedger}
                    onBalances={() => {
                      refreshEthereum();
                      setHemiTick((n) => n + 1);
                    }}
                  />
                ) : null}
                {wallet.solAddress ? (
                  <SolSwapModal
                    visible={tradeView === 'swap' && chain === 'solana'}
                    onClose={() => setTradeView('menu')}
                    address={wallet.solAddress}
                    btcAddress={wallet.btcAddress}
                    ethAddress={wallet.ethAddress}
                    onEthereum={refreshEthereum}
                    onSent={() => setSolTick((n) => n + 1)}
                  />
                ) : null}
              </View>
            )
          ) : null}

          {section === 'activity' ? (
            <ActivityPane
              chain={chain}
              defi={isDefi && chain === 'wart'}
              address={wallet.address}
              node={selectedNode}
              wallet={wallet}
              nextNonce={nextNonce}
              canCancelOrders={isDefi && !activeLedger}
              onNonceBump={afterSpendSuccess}
              history={(
                <TransactionHistory
                  address={wallet.address}
                  node={selectedNode}
                  onRefresh={onRefresh}
                  onAddContact={(address) => {
                    setPrefilledAddress(address);
                    setAddressBookMode('select');
                    setShowAddressBook(true);
                  }}
                />
              )}
              orders={isDefi ? (
                <DefiOverviewSection
                  part="orders"
                  wallet={wallet}
                  selectedNode={selectedNode}
                  nextNonce={nextNonce}
                  orderedAssets={defi.orderedAssets}
                  reorderableAssetCount={defi.watchedAssets.length}
                  openOrders={defi.openOrders}
                  liquidityPositions={defi.liquidityPositions}
                  loadingAssets={defi.loadingAssets}
                  loadingOrders={defi.loadingOrders}
                  loadingLiquidity={defi.loadingLiquidity}
                  onAddAsset={(hash) => defi.addWatchedAsset(hash)}
                  onRemoveAsset={(hash) => defi.removeWatchedAsset(hash)}
                  onReorderAssets={defi.reorderWatchedAssets}
                  onSendAsset={() => {}}
                  onOpenDex={(prefill) => {
                    if (prefill) defi.setDexPoolPrefill(prefill);
                    openTrade('swap');
                  }}
                  onRefreshOrders={defi.refreshOpenOrders}
                  onRefreshLiquidity={defi.refreshLiquidity}
                  onNonceBump={afterSpendSuccess}
                />
              ) : null}
              other={(
                <NetworkActivityModal
                  embedded
                  visible
                  chain={chain}
                  ethAddress={wallet.ethAddress}
                  btcAddress={wallet.btcAddress}
                  solAddress={wallet.solAddress}
                  onClose={() => setSection('wallet')}
                />
              )}
            />
          ) : null}

          {section === 'settings' ? (
            <SettingsPane
              screen={settingsScreen}
              onScreen={(next) => { setSettingsScreen(next); setSection('settings'); }}
              walletName={(currentWalletName || 'Wallet').trim() || 'Wallet'}
              ledger={activeLedger}
              saved={Boolean(currentWalletName) && savedWalletNames.includes(currentWalletName)}
              deleting={deletingWallet}
              accounts={accountChoices}
              accountId={accountChoices[0]?.id ?? 'session'}
              onRename={renameCurrentAccount}
              onSwitchAccount={switchLoggedInAccount}
              onNewWallet={() => {
                setWalletAction('login');
                setAccessPath('hub');
                void handleLogout();
              }}
              onSaveDevice={activeLedger ? undefined : () => setShowSaveModal(true)}
              onDownload={activeLedger ? undefined : () => setShowDownloadModal(true)}
              onDelete={() => { void performClearWallet(); }}
              nodes={nodeList}
              selection={nodeSelection}
              activeUrl={selectedNode}
              onSelectNode={(node) => selectNetwork(node.url, node.network)}
              onChangeNodes={replaceNodeList}
              lockMinutes={lockMinutes}
              onLockMinutes={setLockMinutes}
              onPasskey={activeLedger ? undefined : () => { setToolsInitial('security'); setShowToolsModal(true); }}
              onPhrase={activeLedger ? undefined : () => { setToolsInitial('phrase'); setShowToolsModal(true); }}
              onContacts={() => setShowContactsModal(true)}
              onValidate={() => { setToolsInitial('validate'); setShowToolsModal(true); }}
            />
          ) : null}
          </ScrollView>
        </WalletChrome>
      ) : (
        <ActivityIndicator size="large" color={defiColors.goldHover} />
      )}

      {/* ==================== MODALS ==================== */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => {
        setShowModal(false);
        setWalletData(null);
        setMnemonic('');
        setPrivateKeyInput('');
        setModalError(null);
        setSecureStep('save');
      }}>
        <View style={modalOverlayStyle}>
          <ScrollView style={modalContentStyle} contentContainerStyle={{ paddingBottom: 50 }}>
            <View style={defiStyles.modalAccent} />
            <Text style={modalTitleStyle}>
              {secureStep === 'save' ? 'Name & unlock options' : 'Write down your seed phrase'}
            </Text>
            <Text style={styles.label}>
              {secureStep === 'save'
                ? passkeyOnThisDevice
                  ? 'Step 2 of 3 · set name, biometrics, and optional password first'
                  : 'Step 2 of 3 · set a name and a password to save in this browser'
                : 'Step 3 of 3 · write the seed offline, then confirm before closing'}
            </Text>

            {secureStep === 'save' && (
              <>
                <Text style={styles.label}>
                  {passkeyOnThisDevice
                    ? 'Choose how you\'ll unlock next time. Passkey is registered once after you write down your seed.'
                    : 'This browser has no passkey store. The file password is not kept. Set a new password to save the wallet here.'}
                </Text>
                <Text style={styles.label}>Wallet Name</Text>
                <StyledTextInput placeholder="e.g. main" value={walletName} onChangeText={setWalletName} />
                {passkeyOnThisDevice ? (
                  <>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}
                      onPress={() => {
                        setEnableBioOnCreate(!enableBioOnCreate);
                        if (enableBioOnCreate) setRequire2faOnCreate(false);
                      }}
                    >
                      <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: defiColors.goldHover, marginRight: 10, backgroundColor: enableBioOnCreate ? defiColors.goldHover : 'transparent' }} />
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                        Enable passkey unlock
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                      onPress={() => {
                        setRequire2faOnCreate(!require2faOnCreate);
                        if (!require2faOnCreate) setEnableBioOnCreate(true);
                      }}
                    >
                      <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: defiColors.goldHover, marginRight: 10, backgroundColor: require2faOnCreate ? defiColors.goldHover : 'transparent' }} />
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                        Optional 2FA: require password + passkey
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                <Text style={styles.label}>
                  {require2faOnCreate
                    ? 'Password (required for 2FA)'
                    : passkeyOnThisDevice && enableBioOnCreate
                      ? 'Password (optional if passkey is on)'
                      : 'Password'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <StyledTextInput placeholder="Password" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} />
                    <StyledTextInput
                      placeholder="Confirm password"
                      secureTextEntry={!showConfirmPassword}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onSubmitEditing={continueToSeedBackup}
                      returnKeyType="go"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PasswordCriteria password={password} confirmPassword={confirmPassword} />
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={continueToSeedBackup}
                >
                  <Text style={styles.bigButtonPrimaryText}>Continue — write down seed phrase</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShowModal(false);
                    setWalletData(null);
                    setMnemonic('');
                    setPrivateKeyInput('');
                    setModalError(null);
                    setSecureStep('save');
                  }}
                >
                  <Text style={modalCloseStyle}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}

            {secureStep === 'backup' && (
              <>
                <Text style={[styles.label, { color: '#fbbf24' }]}>
                  Critical: Write your seed phrase offline and store it safely. Anyone with these words can take your funds.
                </Text>
                {walletName ? (
                  <Text style={styles.label}>
                    Wallet name: <Text style={{ color: defiColors.goldHover }}>{walletName}</Text>
                  </Text>
                ) : null}
                {walletData?.mnemonic ? (
                  <>
                    <Text style={styles.label}>SEED PHRASE</Text>
                    <Text style={styles.seed} selectable>
                      {walletData.mnemonic}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.label, { color: '#fbbf24' }]}>
                    This file did not include a seed phrase. Write down the private key — it is the backup for this wallet.
                  </Text>
                )}
                <Text style={styles.label}>PRIVATE KEY</Text>
                <TouchableOpacity onPress={() => copyToClipboard(walletData!.privateKey, 'Private Key')}>
                  <Text style={styles.key} selectable>
                    {walletData?.privateKey}
                  </Text>
                </TouchableOpacity>
                {walletData?.address ? (
                  <>
                    <Text style={styles.label}>ADDRESS</Text>
                    <Text style={styles.key}>{walletData.address}</Text>
                  </>
                ) : null}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}
                  onPress={() => {
                    const next = !(consentToClose || saveWalletConsent);
                    setConsentToClose(next);
                    setSaveWalletConsent(next);
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderWidth: 1,
                      borderColor: defiColors.goldHover,
                      marginRight: 10,
                      backgroundColor: consentToClose || saveWalletConsent ? defiColors.goldHover : 'transparent',
                    }}
                  />
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                    {walletData?.mnemonic
                      ? 'I confirm I have written down my seed phrase before closing'
                      : 'I confirm I have written down my private key before closing'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={() => void saveWallet()}
                  disabled={passkeyBusy || !(consentToClose || saveWalletConsent)}
                >
                  <Text style={styles.bigButtonPrimaryText}>
                    {passkeyBusy
                      ? passkeyOnThisDevice && enableBioOnCreate
                        ? 'Waiting for passkey…'
                        : 'Saving…'
                      : passkeyOnThisDevice && enableBioOnCreate
                        ? 'Save & open (register passkey once)'
                        : 'Save & open wallet'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bigButton}
                  onPress={openWithoutSaving}
                  disabled={!(consentToClose || saveWalletConsent) || passkeyBusy}
                >
                  <Text style={styles.bigButtonText}>Open without saving</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bigButton}
                  onPress={downloadWallet}
                  disabled={passkeyBusy}
                >
                  <Text style={styles.bigButtonText}>Download encrypted file</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setSecureStep('save');
                    setModalError(null);
                  }}
                >
                  <Text style={modalCloseStyle}>← Back to unlock options</Text>
                </TouchableOpacity>
              </>
            )}

            {modalError && <Text style={styles.error}>{modalError}</Text>}
          </ScrollView>
          <SavingOverlay visible={passkeyBusy} status={saveStatus} />
        </View>
      </Modal>

      <Modal visible={showSaveModal} transparent animationType="slide" onRequestClose={() => { setShowSaveModal(false); setLogoutAfterSave(false); setPendingSwitch(null); }}>
        <View style={modalOverlayStyle}>
          <View style={[modalContentStyle, { paddingBottom: 10 }]}>
            <View style={defiStyles.modalAccent} />
            <Text style={modalTitleStyle}>Save Current Wallet</Text>
            <Text style={styles.label}>Wallet Name</Text>
            <StyledTextInput placeholder="Enter a name for this wallet" value={saveWalletName} onChangeText={setSaveWalletName} />
            {passkeyOnThisDevice && enableBioOnSave ? (
              <Text style={styles.label}>Password optional if biometrics is on (required for 2FA).</Text>
            ) : null}
            {!passkeyOnThisDevice ? (
              <Text style={styles.label}>
                Passkey unlock is in the phone app. Set a password to save this wallet in the browser.
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <StyledTextInput placeholder="Password" secureTextEntry value={savePassword} onChangeText={setSavePassword} />
                <StyledTextInput
                  placeholder="Confirm Password"
                  secureTextEntry
                  value={saveConfirmPassword}
                  onChangeText={setSaveConfirmPassword}
                  onSubmitEditing={() => void saveCurrentWallet()}
                  returnKeyType="go"
                />
              </View>
              <View style={{ flex: 1 }}>
                <PasswordCriteria password={savePassword} confirmPassword={saveConfirmPassword} />
              </View>
            </View>
            {passkeyOnThisDevice ? (
              <>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}
                  onPress={() => {
                    setEnableBioOnSave(!enableBioOnSave);
                    if (enableBioOnSave) setRequire2faOnSave(false);
                  }}
                >
                  <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: defiColors.goldHover, marginRight: 10, backgroundColor: enableBioOnSave ? defiColors.goldHover : 'transparent' }} />
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                    Enable passkey unlock
                  </Text>
                </TouchableOpacity>
                {enableBioOnSave ? (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                    onPress={() => setRequire2faOnSave(!require2faOnSave)}
                  >
                    <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: defiColors.goldHover, marginRight: 10, backgroundColor: require2faOnSave ? defiColors.goldHover : 'transparent' }} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                      2FA: require password + passkey
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}
            <TouchableOpacity style={styles.bigButton} onPress={() => void saveCurrentWallet()} disabled={passkeyBusy}>
              <Text style={styles.bigButtonText}>
                {passkeyBusy
                  ? 'Waiting for passkey…'
                  : passkeyOnThisDevice && enableBioOnSave
                    ? 'Save & register passkey'
                    : passkeyOnThisDevice
                      ? 'Save Securely (Device)'
                      : 'Save in this browser'}
              </Text>
            </TouchableOpacity>
            {passkeyOnThisDevice ? (
              <TouchableOpacity
                style={styles.bigButton}
                disabled={passkeyBusy}
                onPress={() => void enableBiometricsOnCurrent()}
              >
                <Text style={styles.bigButtonText}>
                  {passkeyBusy
                    ? 'Waiting…'
                    : 'Enable passkey only'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {modalError && <Text style={styles.error}>{modalError}</Text>}
            <TouchableOpacity onPress={() => { setShowSaveModal(false); setModalError(null); setSaveWalletName(''); setSavePassword(''); setSaveConfirmPassword(''); setLogoutAfterSave(false); setPendingSwitch(null); }} disabled={passkeyBusy}>
              <Text style={modalCloseStyle}>Close</Text>
            </TouchableOpacity>
            <SavingOverlay visible={passkeyBusy} status={saveStatus} />
          </View>
        </View>
      </Modal>

      <Modal visible={showDownloadModal} transparent animationType="slide" onRequestClose={() => setShowDownloadModal(false)}>
        <View style={modalOverlayStyle}>
          <View style={[modalContentStyle, { paddingBottom: 10 }]}>
            <View style={defiStyles.modalAccent} />
            <Text style={modalTitleStyle}>Download Wallet File</Text>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <StyledTextInput
                  placeholder="Password"
                  secureTextEntry
                  value={downloadPassword}
                  onChangeText={setDownloadPassword}
                  onSubmitEditing={downloadCurrentWallet}
                  returnKeyType="go"
                />
              </View>
              <View style={{ flex: 1 }}>
                <PasswordCriteria password={downloadPassword} />
              </View>
            </View>
            <TouchableOpacity style={styles.bigButton} onPress={downloadCurrentWallet}>
              <Text style={styles.bigButtonText}>Download Encrypted File</Text>
            </TouchableOpacity>
            {modalError && <Text style={styles.error}>{modalError}</Text>}
            <TouchableOpacity onPress={() => { setShowDownloadModal(false); setModalError(null); setDownloadPassword(''); }}>
              <Text style={modalCloseStyle}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SpendConfirm
        open={sendConfirmOpen}
        title="Confirm send WART"
        rows={[
          { label: 'To', value: toAddr || '—' },
          { label: 'Amount', value: `${amount || '—'} WART` },
          { label: 'Fee', value: `${fee} WART` },
        ]}
        busy={sendFlow.busy}
        step={sendFlow.step}
        outcome={sendFlow.outcome}
        confirmLabel="Send WART"
        onCancel={() => {
          sendFlow.close(() => setAmount(''));
          setSendConfirmOpen(false);
        }}
        onConfirm={() => void handleSend(true)}
      />
      <Modal visible={showSendModal} transparent animationType="slide" onRequestClose={() => setShowSendModal(false)}>
        <View style={modalOverlayStyle}>
          <ScrollView style={modalContentStyle} contentContainerStyle={{ paddingBottom: 50 }}>
            {wallet ? (
              <>
                <View style={defiStyles.modalAccent} />
                <Text style={modalTitleStyle}>Send WART</Text>
                <SpendableBalanceDisplay
                  available={spendableWart}
                  locked={balanceLocked}
                  total={balance}
                  unit="WART"
                  mark={<TokenIcon symbol="WART" size={18} />}
                  label="Available"
                  layout="stack"
                />
                <Text style={styles.label}>To</Text>
                <View style={styles.addressContainer}>
                  <View style={styles.addressInput}>
                    <StyledTextInput
                      placeholder="Enter public address"
                      value={toAddr}
                      style={styles.inputNoMargin}
                      onChangeText={(value) => {
                        setToAddr(value);
                        if (selectedContact && value !== selectedContact.address) {
                          setSelectedContact(null);
                        }
                      }}
                    />
                  </View>
                  <View style={styles.addressButtons}>
                    <TouchableOpacity
                      style={styles.addressButton}
                      onPress={() => setShowQrScanner(true)}
                    >
                      <Text style={styles.contactButtonText}>📷</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.addressButton}
                      onPress={() => setShowAddressBook(true)}
                    >
                      <Text style={styles.contactButtonText}>📇</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.label}>Amount</Text>
                <View style={styles.addressContainer}>
                  <View style={styles.addressInput}>
                    <StyledTextInput
                      placeholder="0"
                      value={amount}
                      style={styles.inputNoMargin}
                      onChangeText={setAmount}
                      keyboardType="numeric"
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.addressButton}
                    onPress={handleMaxWart}
                    disabled={!spendableWart || spendableWart === '0.00000000'}
                  >
                    <Text style={styles.contactButtonText}>Max</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.label}>Fee (WART)</Text>
                <StyledTextInput
                  placeholder={DEFAULT_FEE}
                  value={fee}
                  onChangeText={setFee}
                  keyboardType="numeric"
                  onSubmitEditing={() => void handleSend(false)}
                  returnKeyType="send"
                />
                {activeLedger ? (
                  <Text style={styles.label}>
                    The Nano must approve this transfer. Leave the Warthog app open on the device.
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.bigButton, styles.bigButtonPrimary]}
                  onPress={() => void handleSend(false)}
                  disabled={sendFlow.busy}
                >
                  <Text style={styles.bigButtonPrimaryText}>
                    {sendFlow.busy && activeLedger ? 'Approve on Ledger…' : sendFlow.busy ? 'Sending…' : 'Send'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowSendModal(false)}>
                  <Text style={modalCloseStyle}>Close</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showHistoryModal} transparent animationType="slide" onRequestClose={() => setShowHistoryModal(false)}>
        <View style={modalOverlayStyle}>
          <ScrollView style={modalContentStyle} contentContainerStyle={{ paddingBottom: 50 }}>
            {wallet ? (
              <>
                <View style={defiStyles.modalAccent} />
                <Text style={modalTitleStyle}>Transaction History</Text>
                <View style={modalBlockCounterStyle}>
                  <Text style={modalBlockTextStyle}>Current Block Height: {currentBlockHeight}</Text>
                </View>
                {sentTxLog.length > 0 && (
                  <View style={styles.logSection}>
                    <Text style={styles.sectionTitle}>Sent Transaction Log</Text>
                    <ScrollView style={styles.logList} contentContainerStyle={{ paddingBottom: 20 }}>
                      {sentTxLog.map((hash, index) => (
                        <TouchableOpacity key={index} onPress={() => copyToClipboard(hash, 'Tx Hash')} style={styles.logItem}>
                          <Text style={styles.logText}>{hash}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
                <TransactionHistory
                  address={wallet.address}
                  node={selectedNode}
                  onRefresh={onRefresh}
                  onAddContact={(address) => {
                    setPrefilledAddress(address);
                    setAddressBookMode('select');
                    setShowAddressBook(true);
                  }}
                />
                <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                  <Text style={modalCloseStyle}>Close</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showContactsModal} transparent animationType="slide" onRequestClose={() => setShowContactsModal(false)}>
        <View style={modalOverlayStyle}>
          <View style={[modalContentStyle, { paddingBottom: 10 }]}>
            <View style={defiStyles.modalAccent} />
            <Text style={modalTitleStyle}>Contacts</Text>
            <TouchableOpacity
              style={styles.bigButton}
              onPress={() => {
                setAddressBookMode('manage');
                setShowAddressBook(true);
              }}
            >
              <Text style={styles.bigButtonText}>📇 Manage Contacts</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bigButton}
              onPress={() => {
                setAddressBookMode('select');
                setShowAddressBook(true);
              }}
            >
              <Text style={styles.bigButtonText}>👆 Select Contact for Sending</Text>
            </TouchableOpacity>
            <Text style={[styles.label, { textAlign: 'center', marginTop: theme.spacing.md }]}>
              💡 Tip: You can also add contacts directly from transactions using the 💾 button when entering addresses!
            </Text>
            <TouchableOpacity onPress={() => setShowContactsModal(false)}>
              <Text style={modalCloseStyle}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {wallet && isDefi && (
        <>
          <SendAssetModal
            visible={showSendAssetModal}
            onClose={() => setShowSendAssetModal(false)}
            wallet={wallet}
            selectedNode={selectedNode}
            nextNonce={nextNonce}
            assets={defi.orderedAssets}
            prefill={defi.sendAssetPrefill}
            onPrefillConsumed={() => defi.setSendAssetPrefill(null)}
            onSuccess={afterSpendSuccess}
          />
          <AssetsModal
            visible={showAssetsModal}
            startTab={assetStartTab}
            onClose={() => setShowAssetsModal(false)}
            wallet={wallet}
            selectedNode={selectedNode}
            nextNonce={nextNonce}
            onSuccess={afterSpendSuccess}
            onTrackAsset={(hash, name) => defi.addWatchedAsset(hash, name || '')}
          />
        </>
      )}

      <AddressBookModal
        visible={showAddressBook}
        mode={addressBookMode}
        onClose={() => setShowAddressBook(false)}
        onSelectContact={handleContactSelect}
        preselectedAddress={toAddr}
        title={addressBookMode === 'manage' ? 'Manage Contacts' : 'Select Recipient'}
      />

      <QrScannerModal
        visible={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onScan={(address) => {
          setToAddr(address);
          setSelectedContact(null);
        }}
      />

      <QrScannerModal
        visible={showWalletQrScanner}
        mode="wallet"
        onClose={() => setShowWalletQrScanner(false)}
        onScanWallet={(encrypted) => {
          setScannedWalletPayload(encrypted);
          setUploadedFileContent(null);
          setUploadedFileName(null);
          setPassword('');
          setError(null);
        }}
      />

      {wallet ? (
        <NetworkActivityModal
          visible={showActivityModal}
          chain={chain}
          ethAddress={wallet.ethAddress}
          btcAddress={wallet.btcAddress}
          solAddress={wallet.solAddress}
          onClose={() => setShowActivityModal(false)}
        />
      ) : null}

      <ToolsModal
        visible={showToolsModal}
        initialTool={toolsInitial}
        onClose={() => setShowToolsModal(false)}
        security={
          isLoggedIn && wallet
            ? toolsSecurity || {
                walletName: (currentWalletName || 'Main').trim() || 'Main',
                hasPasskey: false,
                hasPassword: false,
                require2fa: false,
                biometricsSupported: Platform.OS !== 'web',
                bioLabel,
              }
            : null
        }
        securityBusy={passkeyBusy}
        onEnableBiometrics={
          isLoggedIn && wallet
            ? (opts) => enableBiometricsOnCurrent(opts)
            : undefined
        }
        onRefreshSecurity={refreshToolsSecurity}
        hardwareWallet={activeLedger}
        onRevealRecoveryPhrase={
          isLoggedIn && wallet ? revealRecoveryPhrase : undefined
        }
        wartAddress={wallet?.address ?? ''}
        ethAddress={wallet?.ethAddress ?? ''}
        btcAddress={wallet?.btcAddress ?? ''}
        solAddress={wallet?.solAddress ?? ''}
        node={selectedNode}
        nextNonce={nextNonce}
        walletWartFree={balanceAvailable}
        walletWartLocked={balanceLocked}
        onWartSent={(nonce) => {
          void bumpNonce(nonce);
          void onRefresh();
        }}
      />

      {exchangeTool && wallet ? (
        <exchangeTool.Screen
          visible={showSafeTrade}
          onClose={() => setShowSafeTrade(false)}
          wartAddress={wallet.address}
          ethAddress={wallet.ethAddress ?? ''}
          btcAddress={wallet.btcAddress ?? ''}
          solAddress={wallet.solAddress ?? ''}
          node={selectedNode}
          nextNonce={nextNonce}
          walletWartFree={balanceAvailable}
          walletWartLocked={balanceLocked}
          onWartSent={(nonce) => {
            void bumpNonce(nonce);
            void onRefresh();
          }}
        />
      ) : null}

      {showAave && wallet?.ethAddress ? (
        <AaveModal
          visible
          address={wallet.ethAddress}
          onClose={() => setShowAave(false)}
          onChanged={refreshEthereum}
        />
      ) : null}

      <ReceiveSheet
        visible={showReceive && Boolean(wallet)}
        chain={chain}
        address={wallet ? addressForChain(chain, wallet) : ''}
        onClose={() => setShowReceive(false)}
        onCopy={() => {
          const address = wallet ? addressForChain(chain, wallet) : '';
          if (address) copyToClipboard(address, 'Address');
        }}
      />

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

export default Wallet;
