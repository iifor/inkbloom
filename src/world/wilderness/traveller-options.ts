export const STOP_KINDS = [
  'peaceful',
  'infected',
  'recovering',
  'restored',
  'spawn',
  'ruin',
  'bridge',
  'roadside',
] as const;
export type StopKind = (typeof STOP_KINDS)[number];

export interface TravelOption {
  kind: StopKind;
  metres: number;
  onward: boolean;
  place?: string;
}

export function modelOptions(value: unknown): TravelOption[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 10) return null;
  const options: TravelOption[] = [];
  for (const o of value) {
    if (
      !o ||
      !STOP_KINDS.includes(o.kind) ||
      !Number.isInteger(o.metres) ||
      o.metres < 0 ||
      o.metres > 20000 ||
      typeof o.onward !== 'boolean'
    )
      return null;
    if (o.place !== undefined && !validPlace(o.place)) return null;
    options.push({
      kind: o.kind,
      metres: o.metres,
      onward: o.onward,
      ...(o.place ? { place: o.place } : {}),
    });
  }
  return options;
}

export interface Sighting {
  place: string;
  kind: StopKind;
  /** World clock at the time of the encounter. */
  at: number;
}

export const MEMORY_LIMIT = 12;

function validPlace(p: unknown): p is string {
  return typeof p === 'string' && /^(?:c-?\d{1,9}_-?\d{1,9}|bridge:\d{1,5}|spawn|ruin|roadside)$/.test(p);
}

export function validSightings(value: unknown): value is Sighting[] {
  return (
    Array.isArray(value) &&
    value.length <= MEMORY_LIMIT &&
    value.every(
      (s) =>
        s &&
        validPlace(s.place) &&
        Number.isFinite(s.at) &&
        s.at >= 0 &&
        (s.place.startsWith('c')
          ? ['peaceful', 'infected', 'restored'].includes(s.kind)
          : s.place.startsWith('bridge:')
            ? s.kind === 'bridge'
            : s.place === s.kind && s.kind !== 'roadside'),
    )
  );
}
