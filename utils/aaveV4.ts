/**
 * Aave v4 on Ethereum mainnet, Main Spoke only.
 *
 * Users call the Spoke directly. The function signatures below are a hand-written minimal
 * fragment of the deployed Spoke's public interface (no contract source is copied). Each one was
 * checked with live eth_call reads/simulations against the deployed Main Spoke before use.
 * See https://aave.com/docs/aave-v4 for the model.
 *
 * Everything goes through the Spoke directly. Aave holds WETH, not ETH: the wallet wraps ETH with
 * WETH.deposit before supplying, and unwraps with WETH.withdraw after borrowing or withdrawing WETH.
 * The optional NativeTokenGateway is not used because it would need the user to grant that contract
 * position-manager rights on their position.
 *
 * Nothing here handles keys. Transactions go through `sendEthCall` in ethChain.ts.
 */
import { ethers } from 'ethers';
import { ETH_CHAIN_ID, ETH_RPC, ETH_USDC, ETH_USDT, ETH_WBTC, ETH_WETH } from './ethTokens';
import { parseTokenAmount, sendEthCall } from './ethChain';

export const AAVE_MAIN_SPOKE = '0x94e7A5dCbE816e498b89aB752661904E2F56c485';
export const AAVE_CORE_HUB = '0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9';

/** The wallet refuses to build a borrow or withdrawal that would end below this health factor. */
export const MIN_SAFE_HEALTH_FACTOR = 1.5;
const MIN_SAFE_WAD = 15n * 10n ** 17n;
const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
/** Largest share of a hub-side limit (remaining cap, pool liquidity) this wallet offers to use. */
const LIMIT_USE_BPS = 9_000n;
/** Extra approved/wrapped on a full repay so interest accrued before mining still clears. */
const FULL_REPAY_BUFFER_BPS = 10_005n;
/** Gas held back when wrapping or repaying with ETH: about this many units at the current max fee, never under the floor. */
const GAS_RESERVE_UNITS = 600_000n;
const GAS_RESERVE_FLOOR_ETH = 0.003;

export interface AaveReserveDef {
  id: number;
  symbol: string;
  underlying: string;
  decimals: number;
  /** Can be offered as collateral (still needs a collateral factor above zero on chain). */
  collateral: boolean;
  /** Candidate for borrowing. Whether it is borrowable now is read from `getReserveConfig` on chain. */
  borrow: boolean;
}

/**
 * Reserve ids on the Main Spoke. `loadAaveMarket` re-checks each id against `getReserve(id)` (underlying
 * and decimals) and drops any reserve that does not match. Borrowing is only offered when the Spoke
 * reports the reserve borrowable, not paused, not frozen and active on the Hub.
 */
export const AAVE_RESERVES: AaveReserveDef[] = [
  { id: 0, symbol: 'WETH', underlying: ETH_WETH, decimals: 18, collateral: true, borrow: true },
  { id: 1, symbol: 'wstETH', underlying: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', decimals: 18, collateral: true, borrow: false },
  { id: 2, symbol: 'weETH', underlying: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', decimals: 18, collateral: true, borrow: false },
  { id: 3, symbol: 'WBTC', underlying: ETH_WBTC, decimals: 8, collateral: true, borrow: true },
  { id: 4, symbol: 'cbBTC', underlying: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8, collateral: true, borrow: true },
  { id: 7, symbol: 'USDC', underlying: ETH_USDC, decimals: 6, collateral: true, borrow: true },
  { id: 8, symbol: 'USDT', underlying: ETH_USDT, decimals: 6, collateral: true, borrow: true },
  { id: 9, symbol: 'EURC', underlying: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', decimals: 6, collateral: false, borrow: true },
  { id: 10, symbol: 'RLUSD', underlying: '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD', decimals: 18, collateral: false, borrow: true },
  { id: 11, symbol: 'USDG', underlying: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D', decimals: 6, collateral: false, borrow: true },
  { id: 12, symbol: 'frxUSD', underlying: '0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29', decimals: 18, collateral: false, borrow: true },
  { id: 13, symbol: 'GHO', underlying: '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f', decimals: 18, collateral: false, borrow: true },
];

export const WETH_RESERVE_ID = 0;

const SPOKE_ABI = [
  'function supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)',
  'function withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)',
  'function borrow(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)',
  'function repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)',
  'function setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf)',
  'function ORACLE() view returns (address)',
  'function getReserve(uint256 reserveId) view returns (tuple(address underlying, address hub, uint16 assetId, uint8 decimals, uint24 collateralRisk, uint8 flags, uint32 dynamicConfigKey))',
  'function getReserveConfig(uint256 reserveId) view returns (tuple(uint24 collateralRisk, bool paused, bool frozen, bool borrowable, bool receiveSharesEnabled))',
  'function getDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey) view returns (tuple(uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee))',
  'function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)',
  'function getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)',
  'function getUserReserveStatus(uint256 reserveId, address user) view returns (bool, bool)',
  'function getUserPosition(uint256 reserveId, address user) view returns (tuple(uint120 drawnShares, uint120 premiumShares, int200 premiumOffsetRay, uint120 suppliedShares, uint32 dynamicConfigKey))',
  'function getUserAccountData(address user) view returns (tuple(uint256 riskPremium, uint256 avgCollateralFactor, uint256 healthFactor, uint256 totalCollateralValue, uint256 totalDebtValueRay, uint256 activeCollateralCount, uint256 borrowCount))',
];

const HUB_ABI = [
  'function getSpoke(uint256 assetId, address spoke) view returns (tuple(uint120 drawnShares, uint120 premiumShares, int200 premiumOffsetRay, uint120 addedShares, uint40 addCap, uint40 drawCap, uint24 riskPremiumThreshold, bool active, bool halted, uint200 deficitRay))',
  'function getSpokeAddedAssets(uint256 assetId, address spoke) view returns (uint256)',
  'function getSpokeTotalOwed(uint256 assetId, address spoke) view returns (uint256)',
  'function getAssetLiquidity(uint256 assetId) view returns (uint256)',
  'function getAssetDrawnRate(uint256 assetId) view returns (uint256)',
  'function MAX_ALLOWED_SPOKE_CAP() view returns (uint40)',
];

const ORACLE_ABI = [
  'function decimals() view returns (uint8)',
  'function getReservePrice(uint256 reserveId) view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256)',
];

const WETH_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 wad)',
];

const spokeIface = new ethers.Interface(SPOKE_ABI);
const erc20Iface = new ethers.Interface(ERC20_ABI);
const wethIface = new ethers.Interface(WETH_ABI);

export interface AaveReserveState extends AaveReserveDef {
  /** Price in USD with `priceDecimals` places. */
  price: bigint;
  walletBalance: bigint;
  supplied: bigint;
  debt: bigint;
  enabledAsCollateral: boolean;
  /** Collateral factor in basis points for this user's position (0 if it does not count). */
  collateralFactorBps: number;
  frozen: boolean;
  paused: boolean;
  /** Spoke says borrowable, not paused, not frozen, and the Hub has this Spoke active for it. */
  canBorrow: boolean;
  /** Most that can still be supplied under the Spoke's cap on the Hub, in raw units. */
  supplyRoom: bigint;
  /** Most that can still be borrowed under the Spoke's draw cap and Hub liquidity, in raw units. */
  borrowRoom: bigint;
  /** Hub drawn rate in RAY. Zero when no rate is read. */
  drawnRateRay: bigint;
}

export interface AaveAccount {
  /** Health factor in WAD. `null` means no debt. */
  healthFactorWad: bigint | null;
  riskPremiumBps: number;
  avgCollateralFactorWad: bigint;
  /** Raw "Value" units straight from the Spoke (USD, 8 decimals, scaled by 1e18). */
  totalCollateralValue: bigint;
  /** Raw debt "Value" scaled by RAY. */
  totalDebtValueRay: bigint;
  borrowCount: number;
  activeCollateralCount: number;
}

export interface AaveMarket {
  block: number;
  priceDecimals: number;
  account: AaveAccount;
  reserves: AaveReserveState[];
  ethBalance: bigint;
  /** ETH this wallet keeps back from wrapping and repaying, to pay gas for the steps. */
  ethGasReserve: bigint;
  /** True when the Spoke reported a reserve whose underlying did not match the wallet's table. */
  skipped: string[];
}

function provider(): ethers.JsonRpcProvider {
  const network = ethers.Network.from(ETH_CHAIN_ID);
  return new ethers.JsonRpcProvider(ETH_RPC, network, { staticNetwork: network });
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Whole-asset cap -> raw units. A cap at the Hub's maximum means "no cap". */
function capRaw(cap: bigint, max: bigint, decimals: number): bigint | null {
  if (cap >= max) return null;
  return cap * 10n ** BigInt(decimals);
}

function roomUnder(cap: bigint | null, used: bigint): bigint {
  if (cap == null) return ethers.MaxUint256;
  return cap > used ? cap - used : 0n;
}

export async function loadAaveMarket(user: string): Promise<AaveMarket> {
  const owner = ethers.getAddress(user);
  const client = provider();
  try {
    const hex = await client.send('eth_chainId', []);
    if (BigInt(hex) !== BigInt(ETH_CHAIN_ID)) throw new Error('Ethereum RPC is not mainnet.');
    const spoke = new ethers.Contract(AAVE_MAIN_SPOKE, SPOKE_ABI, client);
    const hub = new ethers.Contract(AAVE_CORE_HUB, HUB_ABI, client);
    const oracleAddress = await spoke.ORACLE() as string;
    const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, client);
    const [block, priceDecimalsRaw, maxCap, acct, ethBalance, fees] = await Promise.all([
      client.getBlockNumber(),
      oracle.decimals() as Promise<bigint>,
      hub.MAX_ALLOWED_SPOKE_CAP() as Promise<bigint>,
      spoke.getUserAccountData(owner) as Promise<ethers.Result>,
      client.getBalance(owner),
      client.getFeeData(),
    ]);
    const feeCap = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    const ethGasReserve = ethers.parseEther(String(GAS_RESERVE_FLOOR_ETH)) > feeCap * GAS_RESERVE_UNITS
      ? ethers.parseEther(String(GAS_RESERVE_FLOOR_ETH))
      : feeCap * GAS_RESERVE_UNITS;
    const skipped: string[] = [];
    const rows = await Promise.all(AAVE_RESERVES.map(async (def): Promise<AaveReserveState | null> => {
      const reserve = await spoke.getReserve(def.id) as ethers.Result;
      if (String(reserve.underlying).toLowerCase() !== def.underlying.toLowerCase()
        || Number(reserve.decimals) !== def.decimals) {
        skipped.push(def.symbol);
        return null;
      }
      const token = new ethers.Contract(def.underlying, ERC20_ABI, client);
      const assetId = BigInt(reserve.assetId);
      const [config, position, supplied, debt, status, price, balance, hubSpoke, added, owed, liquidity, rate] = await Promise.all([
        spoke.getReserveConfig(def.id) as Promise<ethers.Result>,
        spoke.getUserPosition(def.id, owner) as Promise<ethers.Result>,
        spoke.getUserSuppliedAssets(def.id, owner) as Promise<bigint>,
        spoke.getUserTotalDebt(def.id, owner) as Promise<bigint>,
        spoke.getUserReserveStatus(def.id, owner) as Promise<ethers.Result>,
        oracle.getReservePrice(def.id) as Promise<bigint>,
        token.balanceOf(owner) as Promise<bigint>,
        hub.getSpoke(assetId, AAVE_MAIN_SPOKE) as Promise<ethers.Result>,
        hub.getSpokeAddedAssets(assetId, AAVE_MAIN_SPOKE) as Promise<bigint>,
        hub.getSpokeTotalOwed(assetId, AAVE_MAIN_SPOKE) as Promise<bigint>,
        hub.getAssetLiquidity(assetId) as Promise<bigint>,
        hub.getAssetDrawnRate(assetId) as Promise<bigint>,
      ]);
      // Use the dynamic config the user's own position is on, falling back to the reserve's latest one.
      const key = supplied > 0n ? Number(position.dynamicConfigKey) : Number(reserve.dynamicConfigKey);
      const dyn = await spoke.getDynamicReserveConfig(def.id, key) as ethers.Result;
      const active = Boolean(hubSpoke.active) && !hubSpoke.halted;
      const addRoom = active ? roomUnder(capRaw(BigInt(hubSpoke.addCap), maxCap, def.decimals), added) : 0n;
      const drawRoom = active
        ? minBig(roomUnder(capRaw(BigInt(hubSpoke.drawCap), maxCap, def.decimals), owed), liquidity)
        : 0n;
      return {
        ...def,
        price,
        walletBalance: balance,
        supplied,
        debt,
        enabledAsCollateral: Boolean(status[0]),
        collateralFactorBps: Number(dyn.collateralFactor),
        frozen: Boolean(config.frozen),
        paused: Boolean(config.paused),
        canBorrow: def.borrow && Boolean(config.borrowable) && !config.paused && !config.frozen && active,
        supplyRoom: addRoom,
        borrowRoom: drawRoom,
        drawnRateRay: rate,
      };
    }));
    const healthRaw = BigInt(acct.healthFactor);
    return {
      block,
      priceDecimals: Number(priceDecimalsRaw),
      account: {
        healthFactorWad: BigInt(acct.borrowCount) === 0n || BigInt(acct.totalDebtValueRay) === 0n ? null : healthRaw,
        riskPremiumBps: Number(acct.riskPremium),
        avgCollateralFactorWad: BigInt(acct.avgCollateralFactor),
        totalCollateralValue: BigInt(acct.totalCollateralValue),
        totalDebtValueRay: BigInt(acct.totalDebtValueRay),
        borrowCount: Number(acct.borrowCount),
        activeCollateralCount: Number(acct.activeCollateralCount),
      },
      reserves: rows.filter((row): row is AaveReserveState => row != null),
      ethBalance,
      ethGasReserve,
      skipped,
    };
  } finally {
    client.destroy();
  }
}

/** Value of a raw token amount in the Spoke's "Value" units (USD 8 decimals x 1e18). */
export function valueOf(amount: bigint, price: bigint, decimals: number): bigint {
  return amount * price * WAD / 10n ** BigInt(decimals);
}

function healthWad(weightedWad: bigint, debtRay: bigint): bigint | null {
  if (debtRay <= 0n) return null;
  return weightedWad * RAY / debtRay;
}

/** Health factor after taking on `extraDebt` raw units of `asset`. `null` means still no debt. */
export function healthAfterBorrow(market: AaveMarket, asset: AaveReserveState, extraDebt: bigint): bigint | null {
  const a = market.account;
  const weighted = a.totalCollateralValue * a.avgCollateralFactorWad;
  const debtRay = a.totalDebtValueRay + valueOf(extraDebt, asset.price, asset.decimals) * RAY;
  return healthWad(weighted, debtRay);
}

/** Health factor after withdrawing `amount` raw units of `reserve`. */
export function healthAfterWithdraw(market: AaveMarket, reserve: AaveReserveState, amount: bigint): bigint | null {
  const a = market.account;
  if (a.totalDebtValueRay <= 0n) return null;
  let weighted = a.totalCollateralValue * a.avgCollateralFactorWad;
  if (reserve.enabledAsCollateral && reserve.collateralFactorBps > 0) {
    const removed = valueOf(amount, reserve.price, reserve.decimals) * BigInt(reserve.collateralFactorBps) * 10n ** 14n;
    weighted = weighted > removed ? weighted - removed : 0n;
  }
  return healthWad(weighted, a.totalDebtValueRay);
}

/** Health factor after repaying `amount` raw units of `asset`. */
export function healthAfterRepay(market: AaveMarket, asset: AaveReserveState, amount: bigint): bigint | null {
  const a = market.account;
  const weighted = a.totalCollateralValue * a.avgCollateralFactorWad;
  const repaid = valueOf(amount, asset.price, asset.decimals) * RAY;
  const debtRay = a.totalDebtValueRay > repaid ? a.totalDebtValueRay - repaid : 0n;
  return healthWad(weighted, debtRay);
}

/** Largest amount of `asset` that keeps the health factor at `MIN_SAFE_HEALTH_FACTOR` or above, within the hub limits. */
export function maxSafeBorrow(market: AaveMarket, asset: AaveReserveState): bigint {
  const a = market.account;
  if (!asset.canBorrow) return 0n;
  const weighted = a.totalCollateralValue * a.avgCollateralFactorWad;
  const allowedDebtRay = weighted * RAY / MIN_SAFE_WAD;
  if (allowedDebtRay <= a.totalDebtValueRay) return 0n;
  const headroomValue = (allowedDebtRay - a.totalDebtValueRay) / RAY;
  const byHealth = headroomValue * 10n ** BigInt(asset.decimals) / (asset.price * WAD);
  const byLimits = asset.borrowRoom === ethers.MaxUint256 ? byHealth : asset.borrowRoom * LIMIT_USE_BPS / 10_000n;
  return minBig(byHealth, byLimits);
}

/**
 * Extra debt, in "Value" units (USD, 8 decimals, scaled by 1e18), that still keeps the health factor at
 * `MIN_SAFE_HEALTH_FACTOR` or above. Ignores pool liquidity and caps. Zero when already under the limit.
 */
export function safeBorrowHeadroomValue(market: AaveMarket): bigint {
  const a = market.account;
  const weighted = a.totalCollateralValue * a.avgCollateralFactorWad;
  const allowedDebtRay = weighted * RAY / MIN_SAFE_WAD;
  if (allowedDebtRay <= a.totalDebtValueRay) return 0n;
  return (allowedDebtRay - a.totalDebtValueRay) / RAY;
}

/** Largest withdrawal that keeps the health factor safe. With no debt it is the whole supply. */
export function maxSafeWithdraw(market: AaveMarket, reserve: AaveReserveState): bigint {
  if (reserve.supplied <= 0n) return 0n;
  const a = market.account;
  if (a.totalDebtValueRay <= 0n || !reserve.enabledAsCollateral || reserve.collateralFactorBps === 0) {
    return reserve.supplied;
  }
  const weighted = a.totalCollateralValue * a.avgCollateralFactorWad;
  const keep = a.totalDebtValueRay * MIN_SAFE_WAD / RAY;
  if (weighted <= keep) return 0n;
  const removableWeighted = weighted - keep;
  const weightPerWholeUnit = reserve.price * BigInt(reserve.collateralFactorBps) * 10n ** 14n * WAD;
  if (weightPerWholeUnit <= 0n) return reserve.supplied;
  return minBig(reserve.supplied, removableWeighted * 10n ** BigInt(reserve.decimals) / weightPerWholeUnit);
}

export function healthToNumber(wad: bigint | null): number | null {
  if (wad == null) return null;
  if (wad > 1_000_000n * WAD) return Infinity;
  return Number(wad / 10n ** 12n) / 1e6;
}

export function formatHealth(wad: bigint | null): string {
  const n = healthToNumber(wad);
  if (n == null || !Number.isFinite(n)) return 'No debt';
  return n.toFixed(2);
}

/** Approximate annual percentage of the Hub's drawn rate. Excludes the user's risk premium. */
export function rateToPercent(rateRay: bigint): string {
  const bps = rateRay * 10_000n / RAY;
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function usdOf(amount: bigint, price: bigint, decimals: number, priceDecimals: number): number {
  const scaled = amount * price / 10n ** BigInt(decimals);
  return Number(scaled) / 10 ** priceDecimals;
}

export type AaveStep = {
  label: string;
  to: string;
  data: string;
  value?: bigint;
};

function approveStep(token: string, symbol: string, amount: bigint): AaveStep {
  return {
    label: `Approve ${symbol} for the Aave Main Spoke`,
    to: token,
    data: erc20Iface.encodeFunctionData('approve', [AAVE_MAIN_SPOKE, amount]),
  };
}

async function readAllowance(token: string, owner: string): Promise<bigint> {
  const client = provider();
  try {
    return await new ethers.Contract(token, ERC20_ABI, client).allowance(owner, AAVE_MAIN_SPOKE) as bigint;
  } finally {
    client.destroy();
  }
}

/** Approve exactly `amount`. USDT-style tokens need the allowance reset to zero first. */
async function approvalSteps(reserve: AaveReserveDef, owner: string, amount: bigint): Promise<AaveStep[]> {
  const current = await readAllowance(reserve.underlying, owner);
  if (current >= amount) return [];
  const steps: AaveStep[] = [];
  if (current > 0n) steps.push(approveStep(reserve.underlying, reserve.symbol, 0n));
  steps.push(approveStep(reserve.underlying, reserve.symbol, amount));
  return steps;
}

export function parseAaveAmount(text: string, decimals: number): bigint {
  return parseTokenAmount(text, decimals);
}

async function readTokenBalance(token: string, owner: string): Promise<bigint> {
  const client = provider();
  try {
    return await new ethers.Contract(token, ERC20_ABI, client).balanceOf(owner) as bigint;
  } finally {
    client.destroy();
  }
}

function wrapStep(amount: bigint, label: string): AaveStep {
  return { label, to: ETH_WETH, data: wethIface.encodeFunctionData('deposit'), value: amount };
}

function unwrapStep(amount: bigint, label: string): AaveStep {
  return { label, to: ETH_WETH, data: wethIface.encodeFunctionData('withdraw', [amount]) };
}

/** Most plain ETH the wallet will wrap, always leaving the gas reserve behind. */
export function maxWrappableEth(market: AaveMarket): bigint {
  return market.ethBalance > market.ethGasReserve ? market.ethBalance - market.ethGasReserve : 0n;
}

/**
 * Supply `amount` and make sure the reserve is enabled as collateral.
 * With `fromEth` (WETH reserve only) the wallet first wraps that much ETH, keeping the gas reserve.
 */
export async function planSupply(
  owner: string,
  market: AaveMarket,
  reserve: AaveReserveState,
  amount: bigint,
  fromEth = false,
): Promise<AaveStep[]> {
  if (!reserve.collateral) throw new Error(`${reserve.symbol} is not offered as collateral here.`);
  if (reserve.paused || reserve.frozen) throw new Error(`${reserve.symbol} is paused or frozen on Aave.`);
  if (reserve.collateralFactorBps <= 0) throw new Error(`${reserve.symbol} does not count as collateral on the Main Spoke.`);
  if (amount > reserve.supplyRoom) throw new Error(`Aave's supply cap for ${reserve.symbol} leaves room for ${ethers.formatUnits(reserve.supplyRoom, reserve.decimals)}.`);
  const steps: AaveStep[] = [];
  if (fromEth) {
    if (reserve.id !== WETH_RESERVE_ID) throw new Error('Only ETH can be wrapped here.');
    const max = maxWrappableEth(market);
    if (amount > max) {
      throw new Error(`Keep ${ethers.formatEther(market.ethGasReserve)} ETH for gas. The most ETH you can supply is ${ethers.formatEther(max)}.`);
    }
    steps.push(wrapStep(amount, 'Wrap ETH to WETH'));
  } else if (amount > await readTokenBalance(reserve.underlying, owner)) {
    throw new Error(`Only ${ethers.formatUnits(reserve.walletBalance, reserve.decimals)} ${reserve.symbol} is in this wallet.`);
  }
  steps.push(...await approvalSteps(reserve, owner, amount));
  steps.push({
    label: `Supply ${reserve.symbol}`,
    to: AAVE_MAIN_SPOKE,
    data: spokeIface.encodeFunctionData('supply', [reserve.id, amount, owner]),
  });
  if (!reserve.enabledAsCollateral) {
    steps.push({
      label: `Enable ${reserve.symbol} as collateral`,
      to: AAVE_MAIN_SPOKE,
      data: spokeIface.encodeFunctionData('setUsingAsCollateral', [reserve.id, true, owner]),
    });
  }
  return steps;
}

/**
 * Borrow `amount` of any borrowable reserve. For WETH, `unwrap` adds a step turning it into ETH.
 * Blocks a borrow that ends under the safe health factor, computed from the chosen asset's oracle price.
 */
export function planBorrow(
  owner: string,
  market: AaveMarket,
  asset: AaveReserveState,
  amount: bigint,
  unwrap: boolean,
): AaveStep[] {
  if (!asset.canBorrow) throw new Error(`Borrowing ${asset.symbol} is turned off on Aave right now.`);
  if (amount > asset.borrowRoom) throw new Error(`That is above the remaining ${asset.symbol} borrow cap or pool liquidity.`);
  const after = healthAfterBorrow(market, asset, amount);
  if (after != null && after < MIN_SAFE_WAD) {
    throw new Error(`Blocked: this borrow would leave a health factor of ${formatHealth(after)}. This wallet requires at least ${MIN_SAFE_HEALTH_FACTOR.toFixed(1)}.`);
  }
  const steps: AaveStep[] = [{
    label: `Borrow ${asset.symbol}`,
    to: AAVE_MAIN_SPOKE,
    data: spokeIface.encodeFunctionData('borrow', [asset.id, amount, owner]),
  }];
  if (unwrap && asset.id === WETH_RESERVE_ID) steps.push(unwrapStep(amount, 'Unwrap the borrowed WETH to ETH'));
  return steps;
}

/**
 * Repay debt in `asset`. `full` repays everything, with a small buffer approved so interest accrued
 * before mining still clears. For WETH, ETH is wrapped to cover any shortfall (keeping the gas reserve).
 * Other assets must already be in the wallet.
 */
export async function planRepay(
  owner: string,
  market: AaveMarket,
  asset: AaveReserveState,
  amount: bigint,
  full: boolean,
): Promise<AaveStep[]> {
  if (asset.paused) throw new Error(`${asset.symbol} is paused on Aave, so it cannot be repaid right now.`);
  if (asset.debt <= 0n) throw new Error(`There is no ${asset.symbol} debt to repay.`);
  if (!full && amount > asset.debt) throw new Error(`That is more than the ${asset.symbol} debt.`);
  const need = full ? asset.debt * FULL_REPAY_BUFFER_BPS / 10_000n : amount;
  const balance = await readTokenBalance(asset.underlying, owner);
  const steps: AaveStep[] = [];
  if (balance < need) {
    if (asset.id === WETH_RESERVE_ID) {
      const shortfall = need - balance;
      if (shortfall > maxWrappableEth(market)) {
        throw new Error(`Not enough ETH and WETH for that repayment while keeping ${ethers.formatEther(market.ethGasReserve)} ETH for gas.`);
      }
      steps.push(wrapStep(shortfall, 'Wrap ETH to WETH for the repayment'));
    } else if (!full || balance < asset.debt) {
      throw new Error(`Only ${ethers.formatUnits(balance, asset.decimals)} ${asset.symbol} is in this wallet, less than the ${full ? 'debt' : 'amount'}.`);
    }
  }
  steps.push(...await approvalSteps(asset, owner, need));
  steps.push({
    label: full ? `Repay all ${asset.symbol} debt` : `Repay ${asset.symbol}`,
    to: AAVE_MAIN_SPOKE,
    data: spokeIface.encodeFunctionData('repay', [asset.id, full ? ethers.MaxUint256 : amount, owner]),
  });
  return steps;
}

/**
 * Withdraw supplied collateral. `full` passes MaxUint256, which the Spoke treats as a full withdrawal.
 * For WETH, `unwrap` adds a step turning the withdrawn WETH into ETH (a full withdrawal unwraps the
 * supplied amount read at review time; interest earned since then stays as WETH).
 */
export function planWithdraw(
  owner: string,
  market: AaveMarket,
  reserve: AaveReserveState,
  amount: bigint,
  full: boolean,
  unwrap = false,
): AaveStep[] {
  if (reserve.supplied <= 0n) throw new Error(`No ${reserve.symbol} is supplied.`);
  if (!full && amount > reserve.supplied) throw new Error(`Only ${ethers.formatUnits(reserve.supplied, reserve.decimals)} ${reserve.symbol} is supplied.`);
  const sent = full ? reserve.supplied : amount;
  const after = healthAfterWithdraw(market, reserve, sent);
  if (after != null && after < MIN_SAFE_WAD) {
    throw new Error(`Blocked: this withdrawal would leave a health factor of ${formatHealth(after)}. This wallet requires at least ${MIN_SAFE_HEALTH_FACTOR.toFixed(1)}.`);
  }
  const steps: AaveStep[] = [{
    label: `Withdraw ${reserve.symbol}`,
    to: AAVE_MAIN_SPOKE,
    data: spokeIface.encodeFunctionData('withdraw', [reserve.id, full ? ethers.MaxUint256 : amount, owner]),
  }];
  if (unwrap && reserve.id === WETH_RESERVE_ID) steps.push(unwrapStep(sent, 'Unwrap the withdrawn WETH to ETH'));
  return steps;
}

/** Sends each step in order through the wallet's existing Ethereum signer. Stops at the first failure. */
export async function runAaveSteps(
  steps: AaveStep[],
  onStep: (label: string, index: number, total: number) => void,
): Promise<string> {
  let last = '';
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onStep(step.label, i + 1, steps.length);
    const receipt = await sendEthCall({ to: step.to, data: step.data, value: step.value });
    last = receipt.hash;
  }
  return last;
}
