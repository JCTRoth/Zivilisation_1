import type { SaveStore } from '@civ1/shared';

export type { SaveStore } from '@civ1/shared';

/** Room-scoped save storage. A production room can swap this for a database. */
export class InMemorySaveStore implements SaveStore {
  private readonly slots = new Map<string, string>();

  get(key: string): string | null {
    return this.slots.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.slots.set(key, value);
  }

  /** Convenience for tests/tools — not part of the shared port. */
  remove(key: string): void {
    this.slots.delete(key);
  }
}
