/**
 * The campaign library — the in-memory port and the IndexedDB adapter.
 *
 * The IndexedDB adapter is exercised against `fake-indexeddb`, which
 * implements the real API — the same code path the browser runs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  AUTOSAVE_SLOT,
  MANUAL_SAVE_SLOT,
  createMemoryCampaignStore,
  type CampaignMeta,
} from '@shared/ports/campaignStore';
import { createIndexedDbCampaignStore } from '@/pwa/indexedDbCampaignStore';

function meta(id: string, overrides: Partial<CampaignMeta> = {}): CampaignMeta {
  return {
    id,
    name: id,
    turn: 1,
    year: -4000,
    civilizationName: 'Rome',
    updatedAt: 1000,
    sizeBytes: 10,
    version: 5,
    kind: 'manual',
    ...overrides,
  };
}

/** A fresh, isolated IndexedDB database for every test. */
function freshFactory(): IDBFactory {
  const factory = new IDBFactory();
  return factory;
}

describe('memory campaign store', () => {
  it('writes, reads, lists and removes', async () => {
    const store = createMemoryCampaignStore();
    await store.write('a', '{"version":5}', meta('a'));
    await store.write('b', '{"version":5}', meta('b', { updatedAt: 2000 }));

    expect(await store.read('a')).toBe('{"version":5}');
    expect(await store.read('missing')).toBeNull();

    const listed = await store.list();
    expect(listed.map((entry) => entry.id)).toEqual(['b', 'a']);

    await store.remove('a');
    expect(await store.read('a')).toBeNull();
    expect((await store.list()).map((entry) => entry.id)).toEqual(['b']);
  });

  it('removing a missing id is not an error', async () => {
    const store = createMemoryCampaignStore();
    await expect(store.remove('nope')).resolves.toBeUndefined();
  });
});

describe('IndexedDB campaign store', () => {
  let store: ReturnType<typeof createIndexedDbCampaignStore>;

  beforeEach(() => {
    store = createIndexedDbCampaignStore(freshFactory());
  });

  it('round-trips a blob and its metadata', async () => {
    await store.write(MANUAL_SAVE_SLOT, '{"version":5,"currentTurn":9}', meta(MANUAL_SAVE_SLOT));

    expect(await store.read(MANUAL_SAVE_SLOT)).toBe('{"version":5,"currentTurn":9}');
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(MANUAL_SAVE_SLOT);
    expect(listed[0].turn).toBe(1);
  });

  it('overwrites an existing campaign', async () => {
    await store.write(AUTOSAVE_SLOT, 'first', meta(AUTOSAVE_SLOT));
    await store.write(AUTOSAVE_SLOT, 'second', meta(AUTOSAVE_SLOT, { updatedAt: 9999 }));

    expect(await store.read(AUTOSAVE_SLOT)).toBe('second');
    expect((await store.list())[0].updatedAt).toBe(9999);
  });

  it('lists campaigns newest first', async () => {
    await store.write('old', 'a', meta('old', { updatedAt: 1 }));
    await store.write('new', 'b', meta('new', { updatedAt: 2 }));
    expect((await store.list()).map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('removes a campaign', async () => {
    await store.write('gone', 'x', meta('gone'));
    await store.remove('gone');
    expect(await store.read('gone')).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('survives a new store instance over the same database', async () => {
    const factory = freshFactory();
    const first = createIndexedDbCampaignStore(factory);
    await first.write('keep', '{"version":5}', meta('keep'));

    const second = createIndexedDbCampaignStore(factory);
    expect(await second.read('keep')).toBe('{"version":5}');
  });
});
