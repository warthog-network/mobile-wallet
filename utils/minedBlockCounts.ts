/**
 * Blocks Mined (24h / week / month).
 * The history list loads one indexer page of 50 transactions, so counting
 * rewards on that list caps at 50. This walks older pages until the month
 * window is covered.
 */
import { fetchAccountHistory } from './historyParser';
import {
  fetchIndexerHealth,
  fetchIndexerHistoryPage,
  resolveIndexerBase,
} from './warthogIndexer';

export const REWARD_DAY_SEC = 86400;
export const REWARD_WEEK_SEC = 604800;
export const REWARD_MONTH_SEC = 2592000;

const INDEXER_PAGE_SIZE = 100;
const MAX_PAGES = 2000;
const INDEXER_BATCH = 8;

export type RewardStamp = {
  txid?: string;
  isReward: boolean;
  timestamp: number | null;
};

export type MinedBlockCounts = {
  day: number;
  week: number;
  month: number;
  dayExact: boolean;
  weekExact: boolean;
  monthExact: boolean;
};

type PageChunk = {
  rows: RewardStamp[];
  hasMore: boolean;
};

type ConsumeReason = 'continue' | 'history-ended' | 'reached-month' | 'stalled' | 'no-timestamps';

export function unixSeconds(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  if (raw > 1e12) return Math.floor(raw / 1000);
  return Math.floor(raw);
}

export function consumeRewardPage(
  rows: RewardStamp[],
  hasMore: boolean,
  nowSec: number,
  seen: Set<string>,
  previousOldest: number | null,
): {
  day: number;
  week: number;
  month: number;
  oldest: number | null;
  reason: ConsumeReason;
} {
  const dayCut = nowSec - REWARD_DAY_SEC;
  const weekCut = nowSec - REWARD_WEEK_SEC;
  const monthCut = nowSec - REWARD_MONTH_SEC;
  let day = 0;
  let week = 0;
  let month = 0;
  let oldest: number | null = null;
  const seenBefore = seen.size;

  for (const row of rows) {
    const ts = unixSeconds(row.timestamp);
    if (ts != null && (oldest == null || ts < oldest)) oldest = ts;
    const id = row.txid || '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (!row.isReward || ts == null || ts < monthCut) continue;
    month += 1;
    if (ts >= weekCut) week += 1;
    if (ts >= dayCut) day += 1;
  }

  const learned = seen.size - seenBefore;
  let reason: ConsumeReason = 'continue';
  if (rows.length === 0 || !hasMore) reason = 'history-ended';
  else if (oldest == null) reason = 'no-timestamps';
  else if (previousOldest != null && (oldest > previousOldest || (oldest === previousOldest && learned === 0))) {
    reason = 'stalled';
  } else if (oldest < monthCut) reason = 'reached-month';

  return { day, week, month, oldest, reason };
}

function toCounts(
  day: number,
  week: number,
  month: number,
  oldest: number | null,
  historyEnded: boolean,
  failed: boolean,
  nowSec: number,
): MinedBlockCounts {
  if (failed) {
    return { day, week, month, dayExact: false, weekExact: false, monthExact: false };
  }
  if (historyEnded) {
    return { day, week, month, dayExact: true, weekExact: true, monthExact: true };
  }
  return {
    day,
    week,
    month,
    dayExact: oldest != null && oldest < nowSec - REWARD_DAY_SEC,
    weekExact: oldest != null && oldest < nowSec - REWARD_WEEK_SEC,
    monthExact: oldest != null && oldest < nowSec - REWARD_MONTH_SEC,
  };
}

/**
 * Walk newest-first pages. Page 1 is fetched alone so a short history is one
 * request. Later pages are fetched in small parallel batches.
 * Returns null when the first page cannot be loaded.
 */
export async function scanRewardPages(
  fetchPage: (page: number) => Promise<PageChunk | null>,
  nowSec: number,
  options?: {
    maxPages?: number;
    batch?: number;
    onProgress?: (counts: MinedBlockCounts) => void;
  },
): Promise<MinedBlockCounts | null> {
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const batch = Math.max(1, options?.batch ?? INDEXER_BATCH);
  const seen = new Set<string>();
  let day = 0;
  let week = 0;
  let month = 0;
  let previousOldest: number | null = null;
  let oldestSeen: number | null = null;
  let nextPage = 1;

  while (nextPage <= maxPages) {
    const width = nextPage === 1 ? 1 : Math.min(batch, maxPages - nextPage + 1);
    const pageNos = Array.from({ length: width }, (_, i) => nextPage + i);
    const results = await Promise.all(pageNos.map((page) => fetchPage(page)));

    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      if (!result) {
        if (nextPage === 1 && i === 0) return null;
        return toCounts(day, week, month, null, false, true, nowSec);
      }
      const step = consumeRewardPage(result.rows, result.hasMore, nowSec, seen, previousOldest);
      day += step.day;
      week += step.week;
      month += step.month;
      if (step.oldest != null && (oldestSeen == null || step.oldest < oldestSeen)) {
        oldestSeen = step.oldest;
      }
      const failed = step.reason === 'stalled' || step.reason === 'no-timestamps';
      const historyEnded = step.reason === 'history-ended';
      const partial = toCounts(
        day,
        week,
        month,
        oldestSeen,
        historyEnded,
        failed,
        nowSec,
      );
      options?.onProgress?.(partial);
      if (step.reason !== 'continue') return partial;
      previousOldest = step.oldest;
    }

    nextPage += width;
  }

  return toCounts(day, week, month, oldestSeen, false, false, nowSec);
}

async function scanNodeHistory(
  node: string,
  address: string,
  nowSec: number,
  onProgress?: (counts: MinedBlockCounts) => void,
): Promise<MinedBlockCounts> {
  const seen = new Set<string>();
  let day = 0;
  let week = 0;
  let month = 0;
  let previousOldest: number | null = null;
  let oldestSeen: number | null = null;
  let before: number | string = 4294967295;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let result;
    try {
      result = await fetchAccountHistory(node, address, before);
    } catch {
      return toCounts(day, week, month, null, false, true, nowSec);
    }
    const step = consumeRewardPage(
      result.items.map((tx) => ({
        txid: tx.txid,
        isReward: Boolean(tx.isReward),
        timestamp: tx.timestamp,
      })),
      Boolean(result.hasMore && result.fromId != null),
      nowSec,
      seen,
      previousOldest,
    );
    day += step.day;
    week += step.week;
    month += step.month;
    if (step.oldest != null && (oldestSeen == null || step.oldest < oldestSeen)) {
      oldestSeen = step.oldest;
    }
    const failed = step.reason === 'stalled' || step.reason === 'no-timestamps';
    const historyEnded = step.reason === 'history-ended';
    const partial = toCounts(day, week, month, oldestSeen, historyEnded, failed, nowSec);
    onProgress?.(partial);
    if (step.reason !== 'continue') return partial;
    if (result.fromId == null) {
      return toCounts(day, week, month, oldestSeen, true, false, nowSec);
    }
    previousOldest = step.oldest;
    before = result.fromId;
  }

  return toCounts(day, week, month, oldestSeen, false, false, nowSec);
}

const COUNT_CACHE_MS = 60_000;

type CountJob = {
  promise: Promise<MinedBlockCounts>;
  listeners: Set<(counts: MinedBlockCounts) => void>;
};

const countCache = new Map<string, { at: number; counts: MinedBlockCounts }>();
const countJobs = new Map<string, CountJob>();
const countSerial = new Map<string, number>();
let nextCountSerial = 0;

function countCacheKey(node: string, address: string): string {
  return `${node.replace(/\/+$/, '').toLowerCase()}::${address.replace(/^0x/i, '').toLowerCase()}`;
}

export async function fetchMinedBlockCounts(
  node: string,
  address: string,
  options?: {
    nowSec?: number;
    fresh?: boolean;
    onProgress?: (counts: MinedBlockCounts) => void;
  },
): Promise<MinedBlockCounts> {
  const nowSec = options?.nowSec ?? Date.now() / 1000;
  const onProgress = options?.onProgress;
  const key = countCacheKey(node, address);
  const cached = !options?.fresh && options?.nowSec == null ? countCache.get(key) : undefined;
  if (cached && Date.now() - cached.at < COUNT_CACHE_MS) {
    onProgress?.(cached.counts);
    return cached.counts;
  }

  const existing = !options?.fresh && options?.nowSec == null ? countJobs.get(key) : undefined;
  if (existing) {
    if (onProgress) existing.listeners.add(onProgress);
    try {
      return await existing.promise;
    } finally {
      if (onProgress) existing.listeners.delete(onProgress);
    }
  }

  const listeners = new Set<(counts: MinedBlockCounts) => void>();
  if (onProgress) listeners.add(onProgress);
  const emit = (counts: MinedBlockCounts) => {
    for (const listener of listeners) listener(counts);
  };
  const serial = ++nextCountSerial;
  countSerial.set(key, serial);

  const job: CountJob = {
    listeners,
    promise: scanMinedBlockCounts(node, address, nowSec, emit).then((counts) => {
      if (
        countSerial.get(key) === serial &&
        counts.dayExact &&
        counts.weekExact &&
        counts.monthExact
      ) {
        countCache.set(key, { at: Date.now(), counts });
      }
      return counts;
    }),
  };
  if (options?.nowSec == null) countJobs.set(key, job);

  try {
    return await job.promise;
  } finally {
    if (countJobs.get(key) === job) countJobs.delete(key);
    if (onProgress) listeners.delete(onProgress);
  }
}

async function scanMinedBlockCounts(
  node: string,
  address: string,
  nowSec: number,
  onProgress?: (counts: MinedBlockCounts) => void,
): Promise<MinedBlockCounts> {
  const indexerBase = resolveIndexerBase(node);
  if (indexerBase) {
    const health = await fetchIndexerHealth(indexerBase);
    if (health.ok) {
      const scanned = await scanRewardPages(
        async (page) => {
          const indexed = await fetchIndexerHistoryPage(node, address, {
            page,
            count: INDEXER_PAGE_SIZE,
            tipHeight: health.dbHeight,
          });
          if (!indexed) return null;
          return {
            rows: indexed.items.map((tx) => ({
              txid: tx.txid,
              isReward: Boolean(tx.isReward),
              timestamp: tx.timestamp,
            })),
            hasMore: indexed.hasMore,
          };
        },
        nowSec,
        { onProgress },
      );
      if (scanned) return scanned;
    }
  }
  return scanNodeHistory(node, address, nowSec, onProgress);
}
