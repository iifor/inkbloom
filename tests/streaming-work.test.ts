import { expect, it } from 'vitest';
import { finishSteps, StepCache } from '@/world/math/steps';
import { createWilderness } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';
import { seasNear, seasNearSteps } from '@/world/wilderness/groves';
import { springsNear, springsNearSteps } from '@/world/wilderness/landmarks';

it('shares unfinished work with synchronous queries and caches null results', () => {
  const cache = new StepCache<string, number | null>();
  let starts = 0;
  const make = function* () {
    starts++;
    yield;
    yield;
    return null;
  };
  const background = cache.prepare('road', make);
  expect(background.next().done).toBe(false);
  expect(finishSteps(cache.prepare('road', make))).toBeNull();
  expect(background.next()).toEqual({ done: true, value: null });
  expect(finishSteps(cache.prepare('road', make))).toBeNull();
  expect(starts).toBe(1);
});

it('cancels abandoned work and its nested prefetches, while preserving another reader', () => {
  const inner = new StepCache<string, number>();
  const outer = new StepCache<string, number>();
  let starts = 0,
    closes = 0;
  const make = function* () {
    starts++;
    try {
      yield;
      yield;
      return 3;
    } finally {
      closes++;
    }
  };
  const one = outer.prepare('a', function* () {
    return yield* inner.prepare('b', make);
  });
  one.next();
  const two = inner.prepare('b', make);
  two.next();
  one.return(0);
  expect(closes).toBe(0);
  two.return(0);
  expect(closes).toBe(1);
  expect(finishSteps(inner.prepare('b', make))).toBe(3);
  expect(starts).toBe(2);
  expect(closes).toBe(2);
});

it('keeps road results identical when a synchronous query overtakes a prefetch', () => {
  const a = pathsOf(createWilderness(4242));
  const b = pathsOf(createWilderness(4242));
  const pending = a.prepare(300, -100, 600, 100);
  for (let i = 0; i < 40; i++) expect(pending.next().done).toBe(false);
  const expected = b.trailsNear(300, -100, 600, 100);
  expect(a.trailsNear(300, -100, 600, 100)).toEqual(expected);
  expect(finishSteps(pending)).toEqual(expected);
});

it('surveys distant flower seas and springs cooperatively without changing the results', () => {
  const a = createWilderness(4242);
  const b = createWilderness(4242);
  const seaWork = seasNearSteps(a, 1108, -650, 450);
  const springWork = springsNearSteps(a, 1108, -1042, 220);
  expect(seaWork.next().done).toBe(false);
  expect(finishSteps(seaWork)).toEqual(seasNear(b, 1108, -650, 450));
  expect(finishSteps(springWork)).toEqual(springsNear(b, 1108, -1042, 220));
});
