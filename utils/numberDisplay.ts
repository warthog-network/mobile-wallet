import { SECURE_STORE_KEYS } from '../constants';
import { storage } from './storage';

export type NumberNotation = 'standard' | 'compact' | 'scientific';
export type NumberDisplayMode = 'simple' | 'standard' | 'precise';
export type NumberColorId =
  | 'white'
  | 'gray'
  | 'gold'
  | 'orange'
  | 'flame'
  | 'rose'
  | 'blue'
  | 'navy'
  | 'black'
  | 'green'
  | 'lime'
  | 'cyan'
  | 'purple'
  | 'pink';

export interface NumberDisplayPrefs {
  maxDecimals: number | null;
  sigFigs: number | null;
  notation: NumberNotation;
  useGrouping: boolean;
  trimTrailingZeros: boolean;
  numberColor: NumberColorId;
  balanceColor: NumberColorId;
  limitOrderBuyColor: NumberColorId;
  limitOrderSellColor: NumberColorId;
  liquidityPoolColor: NumberColorId;
}

export interface BrandColorStyles {
  text: string;
  textMuted: string;
  textFaint: string;
  bgMuted: string;
  bgSolid: string;
  border: string;
}

export const NUMBER_DISPLAY_MODES: Record<
  NumberDisplayMode,
  {
    label: string;
    description: string;
    maxDecimals: number | null;
    sigFigs: number | null;
    notation: NumberNotation;
    useGrouping: boolean;
    trimTrailingZeros: boolean;
  }
> = {
  simple: {
    label: 'Simple',
    description: 'Rounded to 2 decimals. Smaller amounts keep their first digits',
    maxDecimals: 2,
    sigFigs: null,
    notation: 'compact',
    useGrouping: true,
    trimTrailingZeros: true,
  },
  standard: {
    label: 'Standard',
    description: 'Balanced precision for everyday wallet use',
    maxDecimals: 8,
    sigFigs: null,
    notation: 'standard',
    useGrouping: true,
    trimTrailingZeros: true,
  },
  precise: {
    label: 'Precise',
    description: 'Full precision with every digit kept',
    maxDecimals: null,
    sigFigs: null,
    notation: 'standard',
    useGrouping: true,
    trimTrailingZeros: false,
  },
};

export const BRAND_COLOR_OPTIONS = [
  { id: 'white' as const, label: 'White', hex: '#FFFFFF' },
  { id: 'gray' as const, label: 'Gray', hex: '#E9E9E9' },
  { id: 'gold' as const, label: 'Gold', hex: '#FDB913' },
  { id: 'orange' as const, label: 'Orange', hex: '#E79300' },
  { id: 'flame' as const, label: 'Flame', hex: '#F25C05' },
  { id: 'rose' as const, label: 'Rose', hex: '#F20544' },
  { id: 'blue' as const, label: 'Blue', hex: '#035AA6' },
  { id: 'navy' as const, label: 'Navy', hex: '#033298' },
  { id: 'black' as const, label: 'Black', hex: '#000000' },
];

export const FUN_COLOR_OPTIONS = [
  { id: 'green' as const, label: 'Green', hex: '#34D399' },
  { id: 'lime' as const, label: 'Lime', hex: '#A3E635' },
  { id: 'cyan' as const, label: 'Cyan', hex: '#22D3EE' },
  { id: 'purple' as const, label: 'Purple', hex: '#A855F7' },
  { id: 'pink' as const, label: 'Pink', hex: '#F472B6' },
];

export const NUMBER_COLOR_OPTIONS = [...BRAND_COLOR_OPTIONS, ...FUN_COLOR_OPTIONS];

const withAlpha = (hex: string, alpha: number): string => {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
};

export const BRAND_COLOR_STYLES: Record<NumberColorId, BrandColorStyles> = {
  white: {
    text: '#FFFFFF',
    textMuted: withAlpha('#FFFFFF', 0.7),
    textFaint: withAlpha('#FFFFFF', 0.6),
    bgMuted: withAlpha('#FFFFFF', 0.1),
    bgSolid: '#FFFFFF',
    border: '#FFFFFF',
  },
  gray: {
    text: '#E9E9E9',
    textMuted: withAlpha('#E9E9E9', 0.7),
    textFaint: withAlpha('#E9E9E9', 0.6),
    bgMuted: withAlpha('#E9E9E9', 0.1),
    bgSolid: '#E9E9E9',
    border: '#E9E9E9',
  },
  gold: {
    text: '#FDB913',
    textMuted: withAlpha('#FDB913', 0.7),
    textFaint: withAlpha('#FDB913', 0.6),
    bgMuted: withAlpha('#FDB913', 0.1),
    bgSolid: '#FDB913',
    border: '#FDB913',
  },
  orange: {
    text: '#E79300',
    textMuted: withAlpha('#E79300', 0.7),
    textFaint: withAlpha('#E79300', 0.6),
    bgMuted: withAlpha('#E79300', 0.1),
    bgSolid: '#E79300',
    border: '#E79300',
  },
  flame: {
    text: '#F25C05',
    textMuted: withAlpha('#F25C05', 0.7),
    textFaint: withAlpha('#F25C05', 0.6),
    bgMuted: withAlpha('#F25C05', 0.1),
    bgSolid: '#F25C05',
    border: '#F25C05',
  },
  rose: {
    text: '#F20544',
    textMuted: withAlpha('#F20544', 0.7),
    textFaint: withAlpha('#F20544', 0.6),
    bgMuted: withAlpha('#F20544', 0.1),
    bgSolid: '#F20544',
    border: '#F20544',
  },
  blue: {
    text: '#035AA6',
    textMuted: withAlpha('#035AA6', 0.7),
    textFaint: withAlpha('#035AA6', 0.6),
    bgMuted: withAlpha('#035AA6', 0.1),
    bgSolid: '#035AA6',
    border: '#035AA6',
  },
  navy: {
    text: '#033298',
    textMuted: withAlpha('#033298', 0.7),
    textFaint: withAlpha('#033298', 0.6),
    bgMuted: withAlpha('#033298', 0.1),
    bgSolid: '#033298',
    border: '#033298',
  },
  black: {
    text: '#000000',
    textMuted: withAlpha('#000000', 0.7),
    textFaint: withAlpha('#000000', 0.6),
    bgMuted: withAlpha('#000000', 0.1),
    bgSolid: '#000000',
    border: '#000000',
  },
  green: {
    text: '#34D399',
    textMuted: withAlpha('#34D399', 0.7),
    textFaint: withAlpha('#34D399', 0.6),
    bgMuted: withAlpha('#34D399', 0.1),
    bgSolid: '#34D399',
    border: '#34D399',
  },
  lime: {
    text: '#A3E635',
    textMuted: withAlpha('#A3E635', 0.7),
    textFaint: withAlpha('#A3E635', 0.6),
    bgMuted: withAlpha('#A3E635', 0.1),
    bgSolid: '#A3E635',
    border: '#A3E635',
  },
  cyan: {
    text: '#22D3EE',
    textMuted: withAlpha('#22D3EE', 0.7),
    textFaint: withAlpha('#22D3EE', 0.6),
    bgMuted: withAlpha('#22D3EE', 0.1),
    bgSolid: '#22D3EE',
    border: '#22D3EE',
  },
  purple: {
    text: '#A855F7',
    textMuted: withAlpha('#A855F7', 0.7),
    textFaint: withAlpha('#A855F7', 0.6),
    bgMuted: withAlpha('#A855F7', 0.1),
    bgSolid: '#A855F7',
    border: '#A855F7',
  },
  pink: {
    text: '#F472B6',
    textMuted: withAlpha('#F472B6', 0.7),
    textFaint: withAlpha('#F472B6', 0.6),
    bgMuted: withAlpha('#F472B6', 0.1),
    bgSolid: '#F472B6',
    border: '#F472B6',
  },
};

const LEGACY_ACCENT_COLORS: Record<string, NumberColorId> = {
  emerald: 'green',
  cyan: 'cyan',
  violet: 'purple',
  silver: 'gray',
  muted: 'gray',
  cream: 'gold',
  amber: 'gold',
  deep: 'orange',
  red: 'rose',
};

export const DEFAULT_NUMBER_DISPLAY_PREFS: NumberDisplayPrefs = {
  maxDecimals: 8,
  sigFigs: null,
  notation: 'standard',
  useGrouping: true,
  trimTrailingZeros: true,
  numberColor: 'white',
  balanceColor: 'white',
  limitOrderBuyColor: 'blue',
  limitOrderSellColor: 'rose',
  liquidityPoolColor: 'gold',
};

let prefsCache: NumberDisplayPrefs = { ...DEFAULT_NUMBER_DISPLAY_PREFS };

function normalizeColorId(colorId: string | undefined, fallback: NumberColorId): NumberColorId {
  const resolved = LEGACY_ACCENT_COLORS[colorId ?? ''] ?? colorId;
  return NUMBER_COLOR_OPTIONS.some((c) => c.id === resolved)
    ? (resolved as NumberColorId)
    : fallback;
}

export function normalizeNumberDisplayPrefs(
  prefs?: Partial<NumberDisplayPrefs> | null
): NumberDisplayPrefs {
  const notation = ['standard', 'compact', 'scientific'].includes(prefs?.notation ?? '')
    ? (prefs!.notation as NumberNotation)
    : DEFAULT_NUMBER_DISPLAY_PREFS.notation;

  const maxDecimalsRaw = prefs?.maxDecimals;
  const maxDecimals =
    maxDecimalsRaw == null || (maxDecimalsRaw as unknown) === ''
      ? null
      : Math.min(18, Math.max(0, parseInt(String(maxDecimalsRaw), 10) || 0));

  const sigFigsRaw = prefs?.sigFigs;
  const sigFigs =
    sigFigsRaw == null || (sigFigsRaw as unknown) === ''
      ? null
      : Math.min(12, Math.max(1, parseInt(String(sigFigsRaw), 10) || 1));

  const numberColor = normalizeColorId(prefs?.numberColor, DEFAULT_NUMBER_DISPLAY_PREFS.numberColor);
  const balanceColor =
    prefs?.balanceColor != null
      ? normalizeColorId(prefs.balanceColor, DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor)
      : numberColor;

  return {
    maxDecimals,
    sigFigs,
    notation,
    useGrouping: prefs?.useGrouping !== false,
    trimTrailingZeros: prefs?.trimTrailingZeros !== false,
    numberColor,
    balanceColor,
    limitOrderBuyColor: normalizeColorId(
      prefs?.limitOrderBuyColor,
      DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor
    ),
    limitOrderSellColor: normalizeColorId(
      prefs?.limitOrderSellColor,
      DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor
    ),
    liquidityPoolColor: normalizeColorId(
      prefs?.liquidityPoolColor,
      DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor
    ),
  };
}

export function getNumberDisplayPrefs(): NumberDisplayPrefs {
  return prefsCache;
}

export function setNumberDisplayPrefsCache(
  prefs: Partial<NumberDisplayPrefs>
): NumberDisplayPrefs {
  prefsCache = normalizeNumberDisplayPrefs({ ...prefsCache, ...prefs });
  return prefsCache;
}

export async function loadNumberDisplayPrefs(): Promise<NumberDisplayPrefs> {
  try {
    const raw = await storage.getItemAsync(SECURE_STORE_KEYS.numberDisplayPrefs);
    if (!raw) {
      return setNumberDisplayPrefsCache({ ...DEFAULT_NUMBER_DISPLAY_PREFS });
    }
    const parsed = JSON.parse(raw);
    return setNumberDisplayPrefsCache(parsed);
  } catch {
    return setNumberDisplayPrefsCache({ ...DEFAULT_NUMBER_DISPLAY_PREFS });
  }
}

export async function saveNumberDisplayPrefs(
  prefs: Partial<NumberDisplayPrefs>
): Promise<NumberDisplayPrefs> {
  const normalized = setNumberDisplayPrefsCache({ ...getNumberDisplayPrefs(), ...prefs });
  try {
    await storage.setItemAsync(SECURE_STORE_KEYS.numberDisplayPrefs, JSON.stringify(normalized));
  } catch {
    // ignore quota / storage errors
  }
  return normalized;
}

export function getNumberColor(colorId: NumberColorId | string | undefined): string {
  const resolved = normalizeColorId(colorId, DEFAULT_NUMBER_DISPLAY_PREFS.numberColor);
  return NUMBER_COLOR_OPTIONS.find((c) => c.id === resolved)?.hex ?? '#FFFFFF';
}

export function getBrandColorStyles(colorId: NumberColorId | string | undefined): BrandColorStyles {
  const resolved = normalizeColorId(colorId, DEFAULT_NUMBER_DISPLAY_PREFS.numberColor);
  return BRAND_COLOR_STYLES[resolved] ?? BRAND_COLOR_STYLES.white;
}

export function detectNumberDisplayMode(prefs: Partial<NumberDisplayPrefs>): NumberDisplayMode | null {
  const normalized = normalizeNumberDisplayPrefs(prefs);
  for (const [modeId, preset] of Object.entries(NUMBER_DISPLAY_MODES)) {
    const matches = Object.entries(preset).every(([key, value]) => {
      if (key === 'label' || key === 'description') return true;
      return normalized[key as keyof NumberDisplayPrefs] === value;
    });
    if (matches) return modeId as NumberDisplayMode;
  }
  return null;
}

export function prefsForNumberDisplayMode(modeId: NumberDisplayMode): NumberDisplayPrefs {
  const preset = NUMBER_DISPLAY_MODES[modeId];
  if (!preset) return { ...DEFAULT_NUMBER_DISPLAY_PREFS };
  const { label, description, ...values } = preset;
  return normalizeNumberDisplayPrefs({ ...DEFAULT_NUMBER_DISPLAY_PREFS, ...values });
}

export function coerceDisplayNumber(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'string') {
    const trimmed = input.trim().replace(/^\$/, '');
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof input === 'object') {
    const obj = input as {
      str?: string;
      doubleAdjusted?: number;
      E8?: string | number;
      u64?: string | number;
    };
    if (obj.str != null) return coerceDisplayNumber(obj.str);
    if (obj.doubleAdjusted != null) return coerceDisplayNumber(obj.doubleAdjusted);
    if (obj.E8 !== undefined) return Number(obj.E8) / 1e8;
    if (obj.u64 !== undefined) return coerceDisplayNumber(String(obj.u64));
  }
  return null;
}

function formatWithSigFigs(value: number, sigFigs: number): string {
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(sigFigs));
  return Number.isFinite(rounded) ? String(rounded) : String(value);
}

/**
 * A non-zero amount that would display as 0 at the chosen decimals.
 * Keeps four significant digits so 0.001180184 stays visible in Simple mode.
 */
function formatRoundedAway(value: number): string {
  const digits = 4;
  const abs = Math.abs(value);
  if (!(abs > 0) || abs < 1e-8) {
    let exp = value.toExponential(Math.max(0, digits - 1));
    exp = exp.replace(/(\.\d*?[1-9])0+e/, '$1e').replace(/\.0+e/, 'e');
    return exp;
  }
  const rounded = Number(value.toPrecision(digits));
  const magnitude = Math.abs(rounded);
  if (!Number.isFinite(rounded) || magnitude === 0) return String(value);
  const places = Math.min(18, Math.max(0, -Math.floor(Math.log10(magnitude)) + digits - 1));
  const text = rounded.toFixed(places);
  return text.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') || String(value);
}

function trimFractionZeros(s: string, trimTrailingZeros: boolean): string {
  if (!trimTrailingZeros || !s.includes('.')) return s;
  return s.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') || '0';
}

export function formatDisplayNumber(
  input: unknown,
  prefs: Partial<NumberDisplayPrefs> = {},
  overrides: { fallback?: string; maxDecimals?: number | null } = {}
): string {
  const options = normalizeNumberDisplayPrefs({ ...getNumberDisplayPrefs(), ...prefs });
  const fallback = overrides.fallback ?? '—';
  const maxDecimals =
    overrides.maxDecimals !== undefined ? overrides.maxDecimals : options.maxDecimals;

  if (typeof input === 'string' && input.trim() && coerceDisplayNumber(input) == null) {
    return input.trim();
  }

  const value = coerceDisplayNumber(input);
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value === 0) return '0';

  if (options.notation === 'compact' && Math.abs(value) >= 1000) {
    const digits =
      options.sigFigs != null ? Math.max(0, options.sigFigs - 1) : (maxDecimals ?? 2);
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: Math.min(6, digits),
      minimumFractionDigits: 0,
    }).format(value);
  }

  const tinyThreshold = 10 ** -(maxDecimals ?? 8);
  const useScientific =
    options.notation === 'scientific' ||
    (options.notation === 'standard' && Math.abs(value) > 0 && Math.abs(value) < tinyThreshold);

  if (useScientific) {
    const digits = options.sigFigs ?? maxDecimals ?? 4;
    let exp = value.toExponential(Math.min(8, Math.max(0, digits)));
    if (options.trimTrailingZeros) {
      exp = exp.replace(/(\.\d*?[1-9])0+e/, '$1e').replace(/\.0+e/, 'e');
    }
    return exp;
  }

  let formatted: string;
  if (options.sigFigs != null) {
    formatted = formatWithSigFigs(value, options.sigFigs);
    if (options.useGrouping) {
      const [whole, frac = ''] = formatted.split('.');
      const groupedWhole = new Intl.NumberFormat('en-US', {
        useGrouping: true,
        maximumFractionDigits: 0,
      }).format(Number(whole));
      formatted = frac ? `${groupedWhole}.${frac}` : groupedWhole;
    }
  } else if (maxDecimals != null && Number(value.toFixed(maxDecimals)) === 0) {
    formatted = formatRoundedAway(value);
  } else if (maxDecimals != null) {
    formatted = value.toFixed(maxDecimals);
    if (options.useGrouping) {
      const [whole, frac = ''] = formatted.split('.');
      const groupedWhole = new Intl.NumberFormat('en-US', {
        useGrouping: true,
        maximumFractionDigits: 0,
      }).format(Number(whole));
      formatted = frac ? `${groupedWhole}.${frac}` : groupedWhole;
    }
  } else if (options.useGrouping) {
    formatted = new Intl.NumberFormat('en-US', {
      useGrouping: true,
      maximumFractionDigits: 20,
    }).format(value);
  } else {
    formatted = String(value);
  }

  return trimFractionZeros(formatted, options.trimTrailingZeros);
}

export function formatDisplayBalance(
  input: unknown,
  prefs: Partial<NumberDisplayPrefs> = {},
  overrides: { fallback?: string; maxDecimals?: number | null } = {}
): string {
  if (input != null && typeof input === 'object' && (input as { str?: string }).str != null) {
    return formatDisplayNumber((input as { str: string }).str, prefs, { fallback: '0', ...overrides });
  }
  return formatDisplayNumber(input, prefs, { fallback: '0', ...overrides });
}