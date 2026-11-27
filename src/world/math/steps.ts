/** Consume cooperative work immediately when a synchronous rules query needs the result. */
export function finishSteps<T>(steps: Generator<void, T>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** A prefetch and a synchronous query share the same deterministic calculation. */
export class StepCache<K, T> {
  private readonly values = new Map<K, T>();
  private readonly pending = new Map<K, { steps: Generator<void, T>; users: number }>();

  *prepare(key: K, make: () => Generator<void, T>): Generator<void, T> {
    if (this.values.has(key)) return this.values.get(key)!;
    let work = this.pending.get(key);
    if (!work) this.pending.set(key, (work = { steps: make(), users: 0 }));
    work.users++;
    try {
      while (!this.values.has(key)) {
        const next = work.steps.next();
        if (next.done) {
          this.values.set(key, next.value);
          this.pending.delete(key);
          return next.value;
        }
        yield;
      }
      return this.values.get(key)!;
    } finally {
      if (--work.users === 0 && this.pending.get(key) === work) {
        this.pending.delete(key);
        work.steps.return(undefined as T);
      }
    }
  }
}
