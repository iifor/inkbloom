import catalogue from '@/content/npc-voices.json';
import type { GameContext } from '@/game/types';
import type { Synth } from '@/engine/audio/synth';
import { npcBattles, type NpcFighter } from '@/systems/combat/npc-combat';

/** Short local greetings; no queue of stale dialogue when walking through a crowd. */
export class NpcVoices {
  private readonly visits = new WeakMap<
    NpcFighter,
    { inside: boolean; next: number; voice: number; last: number }
  >();
  private time = 0;
  private scan = 0;
  private next = 0;

  private stop: (() => void) | null = null;
  private readonly cancel = () => {
    this.stop?.();
    this.stop = null;
  };
  private readonly visibility = () => {
    if (document.hidden) this.cancel();
  };
  constructor(
    private readonly ctx: GameContext,
    private readonly synth: Synth,
  ) {
    for (let voice = 0; voice < catalogue.voices.length; voice++)
      for (const { id: line } of catalogue.lines) {
        const name = 'npc-' + voice + '-' + line;
        void synth.load(name, [import.meta.env.BASE_URL + 'sounds/voices/' + voice + '-' + line + '.mp3']);
      }
    window.addEventListener('blur', this.cancel);
    document.addEventListener('visibilitychange', this.visibility);
    synth.ctx?.addEventListener('statechange', this.cancel);
  }
  update(dt: number): void {
    this.time += dt;
    if (this.synth.speechVolume === 0) this.cancel();
    this.scan -= dt;
    if (this.scan > 0) return;
    this.scan = 0.25;
    const { player } = this.ctx;
    const battles = npcBattles(this.ctx);
    let chosen: NpcFighter | undefined,
      nearest = 9;
    for (const npc of battles.people) {
      let visit = this.visits.get(npc);
      if (!visit)
        this.visits.set(
          npc,
          (visit = {
            inside: false,
            next: 0,
            last: -1,
            voice: Math.abs(Math.round(npc.position.x * 7 + npc.position.z * 11)) % catalogue.voices.length,
          }),
        );
      const distance = npc.position.distanceToSquared(player.position);
      if (distance > 25) visit.inside = false;
      if (
        distance >= nearest ||
        visit.inside ||
        this.time < visit.next ||
        !npc.alive ||
        npc.busy ||
        npc.physics !== this.ctx.scenes.active.physics ||
        player.flying ||
        player.gliding ||
        !this.ctx.combat.alive ||
        !battles.visible(npc.physics, npc.position, player.position)
      )
        continue;
      chosen = npc;
      nearest = distance;
    }
    if (!chosen || this.time < this.next || document.hidden || this.synth.speechVolume === 0) return;
    const visit = this.visits.get(chosen)!;
    const options = catalogue.lines.filter((_, i) => i !== visit.last);
    const line = options[Math.floor(Math.random() * options.length)]!;
    const name = `npc-${visit.voice}-${line.id}`;
    const stop = this.synth.dialogue(name, chosen.eye);
    if (!stop) return;
    this.cancel();
    this.stop = stop;
    visit.last = catalogue.lines.indexOf(line);
    visit.inside = true;
    visit.next = this.time + 60;
    this.next = this.time + 8;
  }
  dispose(): void {
    this.cancel();
    window.removeEventListener('blur', this.cancel);
    document.removeEventListener('visibilitychange', this.visibility);
    this.synth.ctx?.removeEventListener('statechange', this.cancel);
  }
}
