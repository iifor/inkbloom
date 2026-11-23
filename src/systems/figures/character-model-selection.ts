import type * as THREE from 'three';
import { characterModel, type CharacterKey } from '@/content/characters';
import { loadCourier } from './quaternius-courier';

/** Ignore late downloads after changing outfits or disposing the owner. */
export class CharacterModelSelection {
  private key: CharacterKey | undefined;
  private generation = 0;
  private disposed = false;

  select(key: CharacterKey, accept: (source: THREE.Group | null) => void): void {
    if (this.disposed || this.key === key || typeof window === 'undefined') return;
    this.key = key;
    const generation = ++this.generation;
    accept(null);
    if (!characterModel(key)) return;
    void loadCourier(key)
      .then((source) => {
        if (!this.disposed && generation === this.generation) accept(source);
      })
      .catch((error) => {
        if (generation === this.generation) {
          this.key = undefined;
          console.warn('角色模型加载失败，暂用备用外观。', error);
        }
      });
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }
}
