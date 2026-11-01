/**
 * Run with: npx tsx --test utils/minedBlockCounts.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  consumeRewardPage,
  REWARD_DAY_SEC,
  REWARD_MONTH_SEC,
  REWARD_WEEK_SEC,
  scanRewardPages,
  unixSeconds,
  type RewardStamp,
} from './minedBlockCounts';

const NOW = 1_800_000_000;

function reward(txid: string, ageSec: number): RewardStamp {
  return { txid, isReward: true, timestamp: NOW - ageSec };
}

describe('unixSeconds', () => {
  test('keeps unix seconds and converts milliseconds', () => {
    assert.equal(unixSeconds(NOW), NOW);
    assert.equal(unixSeconds(NOW * 1000), NOW);
    assert.equal(unixSeconds(0), null);
    assert.equal(unixSeconds(null), null);
  });
});

describe('consumeRewardPage', () => {
  test('counts a page larger than 50 across the three windows', () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => reward(`d${i}`, 3600)),
      ...Array.from({ length: 10 }, (_, i) => reward(`w${i}`, 3 * REWARD_DAY_SEC)),
      ...Array.from({ length: 5 }, (_, i) => reward(`m${i}`, 10 * REWARD_DAY_SEC)),
      reward('old', REWARD_MONTH_SEC + 10),
      { txid: 'xfer', isReward: false, timestamp: NOW - 10 },
    ];
    const step = consumeRewardPage(rows, true, NOW, new Set(), null);
    assert.equal(step.day, 60);
    assert.equal(step.week, 70);
    assert.equal(step.month, 75);
    assert.equal(step.reason, 'reached-month');
  });

  test('keeps reading when the next page shares a timestamp but has new transactions', () => {
    const seen = new Set<string>();
    const first = consumeRewardPage([reward('a', 10)], true, NOW, seen, null);
    const second = consumeRewardPage([reward('b', 10)], true, NOW, seen, first.oldest);
    assert.equal(first.reason, 'continue');
    assert.equal(second.reason, 'continue');
    assert.equal(first.day + second.day, 2);
  });

  test('does not count the same reward twice', () => {
    const seen = new Set<string>();
    const first = consumeRewardPage([reward('a', 10), reward('b', 20)], true, NOW, seen, null);
    const second = consumeRewardPage([reward('b', 20), reward('c', 30)], false, NOW, seen, first.oldest);
    assert.equal(first.day + second.day, 3);
  });
});

describe('scanRewardPages', () => {
  test('keeps paging after the first 50 rewards', async () => {
    const pages: RewardStamp[][] = [
      Array.from({ length: 50 }, (_, i) => reward(`p1-${i}`, 1000 + i)),
      Array.from({ length: 50 }, (_, i) => reward(`p2-${i}`, 5000 + i)),
      [reward('old', REWARD_MONTH_SEC + 60)],
    ];
    const fetched: number[] = [];
    const counts = await scanRewardPages(
      async (page) => {
        fetched.push(page);
        const rows = pages[page - 1] ?? [];
        return { rows, hasMore: page < pages.length };
      },
      NOW,
      { batch: 1 },
    );
    assert.ok(counts);
    assert.deepEqual(fetched, [1, 2, 3]);
    assert.equal(counts.day, 100);
    assert.equal(counts.week, 100);
    assert.equal(counts.month, 100);
    assert.equal(counts.dayExact, true);
    assert.equal(counts.weekExact, true);
    assert.equal(counts.monthExact, true);
  });

  test('stops once a page is older than a month and does not read further pages', async () => {
    const fetched: number[] = [];
    const counts = await scanRewardPages(
      async (page) => {
        fetched.push(page);
        if (page === 1) {
          return {
            rows: Array.from({ length: 80 }, (_, i) => reward(`n${i}`, 60 * i)),
            hasMore: true,
          };
        }
        return {
          rows: [
            reward('still', REWARD_WEEK_SEC),
            reward('past', REWARD_MONTH_SEC + 5),
          ],
          hasMore: true,
        };
      },
      NOW,
      { batch: 1 },
    );
    assert.deepEqual(fetched, [1, 2]);
    assert.equal(counts?.day, 80);
    assert.equal(counts?.week, 81);
    assert.equal(counts?.month, 81);
    assert.equal(counts?.monthExact, true);
  });

  test('marks the count inexact when paging stalls on the same timestamps', async () => {
    const row = reward('same', 10);
    const counts = await scanRewardPages(
      async () => ({ rows: [row], hasMore: true }),
      NOW,
      { batch: 1 },
    );
    assert.equal(counts?.day, 1);
    assert.equal(counts?.dayExact, false);
    assert.equal(counts?.monthExact, false);
  });
});
