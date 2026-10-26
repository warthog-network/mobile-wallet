import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import FormattedNumber from '../FormattedNumber';
import {
  BRAND_COLOR_OPTIONS,
  DEFAULT_NUMBER_DISPLAY_PREFS,
  FUN_COLOR_OPTIONS,
  NUMBER_COLOR_OPTIONS,
  NUMBER_DISPLAY_MODES,
  NumberColorId,
  NumberDisplayMode,
  NumberNotation,
} from '../../utils/numberDisplay';
import { defiColors } from '../defi/defiStyles';
import { theme } from '../../theme';

const PREVIEW_SAMPLES = [
  { label: 'Large supply', value: 1000000000, variant: 'number' as const },
  { label: 'Pool reserve', value: 2456789.12345678, variant: 'balance' as const },
  { label: 'Tiny price', value: 0.0000000342, variant: 'number' as const },
  { label: 'Limit price', value: 0.0001523, variant: 'number' as const },
];

const DECIMAL_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Full precision', value: null },
  { label: '0 decimals', value: 0 },
  { label: '2 decimals', value: 2 },
  { label: '4 decimals', value: 4 },
  { label: '6 decimals', value: 6 },
  { label: '8 decimals', value: 8 },
  { label: '10 decimals', value: 10 },
  { label: '12 decimals', value: 12 },
];

const SIG_FIG_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Off (use decimals)', value: null },
  { label: '2 sig figs', value: 2 },
  { label: '3 sig figs', value: 3 },
  { label: '4 sig figs', value: 4 },
  { label: '5 sig figs', value: 5 },
  { label: '6 sig figs', value: 6 },
  { label: '8 sig figs', value: 8 },
];

const NOTATION_OPTIONS: Array<{ label: string; value: NumberNotation }> = [
  { label: 'Standard (1,234.56)', value: 'standard' },
  { label: 'Compact (1.23M, 456K)', value: 'compact' },
  { label: 'Scientific (1.23e+6)', value: 'scientific' },
];

const colorMeta = (colorId: NumberColorId) =>
  NUMBER_COLOR_OPTIONS.find((c) => c.id === colorId) ?? NUMBER_COLOR_OPTIONS[0];

interface ColorSwatchProps {
  hex: string;
  size?: 'sm' | 'lg';
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ hex, size = 'sm' }) => (
  <View
    style={[
      styles.swatch,
      size === 'lg' ? styles.swatchLg : styles.swatchSm,
      { backgroundColor: hex },
    ]}
  />
);

interface ColorOptionButtonProps {
  color: { id: NumberColorId; label: string; hex: string };
  value: NumberColorId;
  defaultValue: NumberColorId;
  onChange: (id: NumberColorId) => void;
}

const ColorOptionButton: React.FC<ColorOptionButtonProps> = ({
  color,
  value,
  defaultValue,
  onChange,
}) => {
  const isActive = value === color.id;
  const isDefault = color.id === defaultValue;
  return (
    <TouchableOpacity
      style={[styles.compactBtn, isActive && styles.compactBtnActive]}
      onPress={() => onChange(color.id)}
    >
      <ColorSwatch hex={color.hex} />
      <Text style={[styles.compactBtnText, isActive && styles.compactBtnTextActive]}>
        {isDefault ? 'Default' : color.label}
      </Text>
    </TouchableOpacity>
  );
};

interface ColorPickerRowProps {
  label?: string;
  description?: string;
  value: NumberColorId;
  defaultValue: NumberColorId;
  onChange: (id: NumberColorId) => void;
}

const ColorPickerRow: React.FC<ColorPickerRowProps> = ({
  label,
  description,
  value,
  defaultValue,
  onChange,
}) => (
  <View style={styles.colorRow}>
    {label ? <Text style={styles.colorRowLabel}>{label}</Text> : null}
    {description ? <Text style={styles.colorRowDesc}>{description}</Text> : null}
    <View style={styles.colorBtnWrap}>
      {BRAND_COLOR_OPTIONS.map((color) => (
        <ColorOptionButton
          key={color.id}
          color={color}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
        />
      ))}
    </View>
    <Text style={styles.funLabel}>Fun colors</Text>
    <View style={styles.colorBtnWrap}>
      {FUN_COLOR_OPTIONS.map((color) => (
        <ColorOptionButton
          key={color.id}
          color={color}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
        />
      ))}
    </View>
  </View>
);

interface ColorPickerSectionProps {
  title: string;
  description?: string;
  values?: Array<{ id: NumberColorId; label?: string }>;
  children: React.ReactNode;
}

const ColorPickerSection: React.FC<ColorPickerSectionProps> = ({
  title,
  description,
  values = [],
  children,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.collapsible}>
      <TouchableOpacity style={styles.collapsibleHeader} onPress={() => setOpen(!open)}>
        <Text style={styles.collapsibleChevron}>{open ? '▾' : '▸'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.collapsibleTitle}>{title}</Text>
          {description ? <Text style={styles.collapsibleDesc}>{description}</Text> : null}
        </View>
        {values.length > 0 ? (
          <View style={styles.collapsibleValues}>
            {values.map(({ id, label }) => (
              <View key={id} style={styles.collapsibleValue}>
                <ColorSwatch hex={colorMeta(id).hex} size="lg" />
                {label ? <Text style={styles.collapsibleValueLabel}>{label}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </TouchableOpacity>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
};

interface OptionPickerProps<T> {
  label: string;
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
}

function OptionPicker<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
}: OptionPickerProps<T>) {
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionBtnWrap}>
        {options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[styles.optionBtn, isActive && styles.optionBtnActive]}
              onPress={() => onChange(opt.value)}
            >
              <Text style={[styles.optionBtnText, isActive && styles.optionBtnTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const NumberDisplaySettings: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [open, setOpen] = useState(false);
  const {
    prefs,
    setPrefs,
    resetPrefs,
    applyMode,
    activeMode,
    limitOrderBuyStyles,
    limitOrderSellStyles,
    liquidityPoolStyles,
  } = useNumberDisplay();

  const resetColorPrefs = () =>
    setPrefs({
      numberColor: DEFAULT_NUMBER_DISPLAY_PREFS.numberColor,
      balanceColor: DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor,
      limitOrderBuyColor: DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor,
      limitOrderSellColor: DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor,
      liquidityPoolColor: DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor,
    });

  const summary = activeMode == null ? 'Custom' : NUMBER_DISPLAY_MODES[activeMode].label;

  const panel = (
    <View>
      <View style={styles.headerRow}>
        {collapsible ? (
          <Text style={[styles.subtitle, { flex: 1 }]}>
            Choose a quick preset or fine-tune how numbers, balances, limit orders, and pool UI appear
            across the wallet.
          </Text>
        ) : (
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Number Display</Text>
            <Text style={styles.subtitle}>
              Choose a quick preset or fine-tune how numbers, balances, limit orders, and pool UI appear
              across the wallet.
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.compactBtn} onPress={resetPrefs}>
          <Text style={styles.compactBtnText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Quick presets</Text>
      <View style={styles.btnRow}>
        {(Object.entries(NUMBER_DISPLAY_MODES) as [NumberDisplayMode, (typeof NUMBER_DISPLAY_MODES)[NumberDisplayMode]][]).map(
          ([modeId, mode]) => (
            <TouchableOpacity
              key={modeId}
              style={[styles.compactBtn, activeMode === modeId && styles.compactBtnActive]}
              onPress={() => applyMode(modeId)}
            >
              <Text
                style={[
                  styles.compactBtnText,
                  activeMode === modeId && styles.compactBtnTextActive,
                ]}
              >
                {mode.label}
              </Text>
            </TouchableOpacity>
          )
        )}
      </View>
      <Text style={styles.hint}>
        {activeMode == null
          ? 'Custom — manual tweaks differ from all presets.'
          : NUMBER_DISPLAY_MODES[activeMode].description}
      </Text>

      <View style={styles.accentPanel}>
        <View style={styles.headerRow}>
          <Text style={styles.accentLabel}>Accent colors</Text>
          <TouchableOpacity style={styles.compactBtn} onPress={resetColorPrefs}>
            <Text style={styles.compactBtnText}>Color defaults</Text>
          </TouchableOpacity>
        </View>

        <ColorPickerSection
          title="Number color"
          description="Prices, limits, and general numeric values"
          values={[{ id: prefs.numberColor, label: colorMeta(prefs.numberColor).label }]}
        >
          <ColorPickerRow
            value={prefs.numberColor}
            defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.numberColor}
            onChange={(numberColor) => setPrefs({ numberColor })}
          />
        </ColorPickerSection>

        <ColorPickerSection
          title="Balance color"
          description="Wallet balances, pool reserves, and LP share amounts"
          values={[{ id: prefs.balanceColor, label: colorMeta(prefs.balanceColor).label }]}
        >
          <ColorPickerRow
            value={prefs.balanceColor}
            defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor}
            onChange={(balanceColor) => setPrefs({ balanceColor })}
          />
        </ColorPickerSection>

        <ColorPickerSection
          title="Limit orders"
          description="Buy and sell order badges, headers, and fill bars"
          values={[
            { id: prefs.limitOrderBuyColor, label: 'Buy' },
            { id: prefs.limitOrderSellColor, label: 'Sell' },
          ]}
        >
          <ColorPickerRow
            label="Buy orders"
            value={prefs.limitOrderBuyColor}
            defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor}
            onChange={(limitOrderBuyColor) => setPrefs({ limitOrderBuyColor })}
          />
          <ColorPickerRow
            label="Sell orders"
            value={prefs.limitOrderSellColor}
            defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor}
            onChange={(limitOrderSellColor) => setPrefs({ limitOrderSellColor })}
          />
        </ColorPickerSection>

        <ColorPickerSection
          title="Liquidity pool"
          description="Pool cards, LP positions, and reserve labels"
          values={[{ id: prefs.liquidityPoolColor, label: colorMeta(prefs.liquidityPoolColor).label }]}
        >
          <ColorPickerRow
            value={prefs.liquidityPoolColor}
            defaultValue={DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor}
            onChange={(liquidityPoolColor) => setPrefs({ liquidityPoolColor })}
          />
        </ColorPickerSection>

        <View style={styles.badgePreview}>
          <View style={[styles.badge, { backgroundColor: limitOrderBuyStyles.bgMuted }]}>
            <Text style={{ color: limitOrderBuyStyles.text, fontSize: 11, fontWeight: '600' }}>
              BUY
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: limitOrderSellStyles.bgMuted }]}>
            <Text style={{ color: limitOrderSellStyles.text, fontSize: 11, fontWeight: '600' }}>
              SELL
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: liquidityPoolStyles.bgMuted }]}>
            <Text style={{ color: liquidityPoolStyles.text, fontSize: 11, fontWeight: '600' }}>
              LP POOL
            </Text>
          </View>
        </View>
      </View>

      <OptionPicker
        label="Decimal places (max)"
        value={prefs.maxDecimals}
        options={DECIMAL_OPTIONS}
        onChange={(maxDecimals) => setPrefs({ maxDecimals })}
      />

      <OptionPicker
        label="Significant figures"
        value={prefs.sigFigs}
        options={SIG_FIG_OPTIONS}
        onChange={(sigFigs) => setPrefs({ sigFigs })}
      />

      <OptionPicker
        label="Notation"
        value={prefs.notation}
        options={NOTATION_OPTIONS}
        onChange={(notation) => setPrefs({ notation })}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchItem}>
          <Text style={styles.switchLabel}>Thousand separators</Text>
          <Switch
            value={prefs.useGrouping}
            onValueChange={(useGrouping) => setPrefs({ useGrouping })}
            trackColor={{ false: defiColors.borderMuted, true: defiColors.goldHover }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.switchItem}>
          <Text style={styles.switchLabel}>Trim trailing zeros</Text>
          <Switch
            value={prefs.trimTrailingZeros}
            onValueChange={(trimTrailingZeros) => setPrefs({ trimTrailingZeros })}
            trackColor={{ false: defiColors.borderMuted, true: defiColors.goldHover }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <View style={styles.previewPanel}>
        <Text style={styles.previewLabel}>Preview</Text>
        {PREVIEW_SAMPLES.map((sample) => (
          <View key={sample.label} style={styles.previewRow}>
            <Text style={styles.previewName}>{sample.label}</Text>
            <FormattedNumber value={sample.value} variant={sample.variant} />
          </View>
        ))}
      </View>
    </View>
  );

  if (!collapsible) return panel;

  return (
    <View style={styles.sectionCard}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Number Display, ${summary}. ${open ? 'Collapse' : 'Expand'}`}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Number Display</Text>
          <Text style={styles.sectionSummary}>{summary}</Text>
        </View>
        <Text style={styles.sectionChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open ? <View style={styles.sectionBody}>{panel}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.semiBold,
    marginBottom: 4,
  },
  subtitle: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 18,
  },
  sectionLabel: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  compactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
  },
  compactBtnActive: {
    backgroundColor: defiColors.goldHover,
    borderColor: defiColors.goldHover,
  },
  compactBtnText: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.semiBold,
  },
  compactBtnTextActive: {
    color: '#fff',
  },
  hint: {
    color: defiColors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  accentPanel: {
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(24, 24, 27, 0.4)',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  accentLabel: {
    color: defiColors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: 14,
  },
  sectionTitle: {
    color: '#fafafa',
    fontSize: 14,
    fontWeight: theme.typography.semiBold,
  },
  sectionSummary: {
    color: defiColors.textSecondary,
    fontSize: 11,
    marginTop: 3,
  },
  sectionChevron: {
    color: defiColors.textMuted,
    fontSize: 16,
    lineHeight: 18,
  },
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  collapsible: {
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(9, 9, 11, 0.5)',
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  collapsibleChevron: {
    color: defiColors.textMuted,
    fontSize: 10,
  },
  collapsibleTitle: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
  },
  collapsibleDesc: {
    color: defiColors.textMuted,
    fontSize: 10,
  },
  collapsibleValues: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  collapsibleValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  collapsibleValueLabel: {
    color: defiColors.textMuted,
    fontSize: 10,
  },
  collapsibleBody: {
    borderTopWidth: 1,
    borderTopColor: defiColors.borderMuted,
    padding: theme.spacing.sm,
  },
  colorRow: {
    marginBottom: theme.spacing.sm,
  },
  colorRowLabel: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    marginBottom: 2,
  },
  colorRowDesc: {
    color: defiColors.textMuted,
    fontSize: 11,
    marginBottom: theme.spacing.sm,
  },
  colorBtnWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  funLabel: {
    color: defiColors.textMuted,
    fontSize: 10,
    marginBottom: theme.spacing.xs,
  },
  swatch: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  swatchSm: {
    width: 10,
    height: 10,
  },
  swatchLg: {
    width: 14,
    height: 14,
  },
  badgePreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: defiColors.borderMuted,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  optionGroup: {
    marginBottom: theme.spacing.md,
  },
  optionLabel: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  optionBtnWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  optionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: defiColors.bgCard,
    borderWidth: 1,
    borderColor: defiColors.border,
  },
  optionBtnActive: {
    backgroundColor: defiColors.goldHover,
    borderColor: defiColors.goldHover,
  },
  optionBtnText: {
    color: defiColors.textSecondary,
    fontSize: 11,
  },
  optionBtnTextActive: {
    color: '#fff',
    fontWeight: theme.typography.semiBold,
  },
  switchRow: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  switchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  switchLabel: {
    color: defiColors.textSecondary,
    fontSize: theme.typography.bodySm,
  },
  previewPanel: {
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(24, 24, 27, 0.5)',
    padding: theme.spacing.md,
  },
  previewLabel: {
    color: defiColors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: theme.spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  previewName: {
    color: defiColors.textMuted,
    fontSize: theme.typography.caption,
  },
});

export default NumberDisplaySettings;