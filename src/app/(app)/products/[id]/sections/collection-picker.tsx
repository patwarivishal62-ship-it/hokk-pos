'use client';

import { useState } from 'react';

interface Collection {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  handle: string;
}

/**
 * Checkbox grid whose selections are mirrored into a single hidden
 * `collection_ids` field, so the server action receives one canonical list.
 */
export function CollectionPicker({ collections, assigned }: { collections: Collection[]; assigned: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(assigned));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <input type="hidden" name="collection_ids" value={[...selected].join(',')} />
      <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-2 text-2xs text-ink-500">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setSelected(new Set(collections.map((c) => c.id)))}
        >
          Select all
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
          Clear
        </button>
        <span className="ml-auto">{selected.size} selected</span>
      </div>
      <ul className="grid gap-1 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((collection) => (
          <li key={collection.id}>
            <label className="flex items-start gap-2 text-sm normal-case">
              <input type="checkbox" checked={selected.has(collection.id)} onChange={() => toggle(collection.id)} />
              <span className="flex flex-col">
                <span>{collection.name}</span>
                <span className="mono text-2xs text-ink-400">{collection.handle}</span>
                {collection.description && <span className="text-2xs text-ink-400">{collection.description}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
