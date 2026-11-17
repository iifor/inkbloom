import { describe, expect, it } from 'vitest';
import { JumpWindow } from '@/systems/player/jump-window';

const DT = 1 / 60;
/** Run frames of (onGround, pressed); return the frame indices that jumped from the ground. */
function run(w: JumpWindow, frames: [boolean, boolean][]): number[] {
  return frames.flatMap(([g, p], i) => (w.update(DT, g, p) ? [i] : []));
}
const repeat = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

describe('jump window', () => {
  it('jumps at once when pressed on the ground', () => {
    expect(run(new JumpWindow(0.1, 0.12), [[true, true]])).toEqual([0]);
  });

  it('still jumps from the ground just after running off a ledge', () => {
    // 4 frames (~0.07 s) after leaving the ground
    const frames: [boolean, boolean][] = [
      [true, false],
      ...repeat(4, [false, false] as [boolean, boolean]),
      [false, true],
    ];
    expect(run(new JumpWindow(0.1, 0.12), frames)).toEqual([5]);
  });

  it('is an air jump once the coyote time has passed', () => {
    const w = new JumpWindow(0.1, 0.12);
    const frames: [boolean, boolean][] = [
      [true, false],
      ...repeat(10, [false, false] as [boolean, boolean]),
      [false, true],
    ];
    expect(run(w, frames)).toEqual([]);
    expect(w.airborne).toBe(true);
  });

  it('a press just before landing jumps on landing; a press long before does not', () => {
    const early: [boolean, boolean][] = [
      [false, true],
      ...repeat(5, [false, false] as [boolean, boolean]),
      [true, false],
    ];
    expect(run(new JumpWindow(0.1, 0.12), early)).toEqual([6]);
    const tooEarly: [boolean, boolean][] = [
      [false, true],
      ...repeat(12, [false, false] as [boolean, boolean]),
      [true, false],
    ];
    expect(run(new JumpWindow(0.1, 0.12), tooEarly)).toEqual([]);
  });

  it('one press makes one jump, even while still touching the ground', () => {
    expect(
      run(new JumpWindow(0.1, 0.12), [
        [true, true],
        [true, false],
        [true, false],
      ]),
    ).toEqual([0]);
  });

  it('an air jump uses the press, so landing does not jump again', () => {
    const w = new JumpWindow(0.1, 0.12);
    run(w, [[true, false], ...repeat(10, [false, false] as [boolean, boolean])]);
    expect(w.update(DT, false, true)).toBe(false);
    w.consume();
    expect(w.update(DT, true, false)).toBe(false);
  });
});
