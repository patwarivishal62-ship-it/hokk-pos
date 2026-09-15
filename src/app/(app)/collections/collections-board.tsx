'use client';

import { useActionState, useState } from 'react';
import { reorderCollectionsAction } from '@/app/actions/taxonomy';

interface Collection {
  id: string;
  name: string;
  sort_order: number;
}

export function CollectionsBoard({ collections, canManage }: { collections: Collection[]; canManage: boolean }) {
  const [order, setOrder] = useState(collections.map((collection) => collection.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(reorderCollectionsAction, null);
  const dirty = order.join(',') !== collections.map((collection) => collection.id).join(',');

  const move = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setOrder((prev) => {
      const next = prev.filter((id) => id !== dragId);
      const index = next.indexOf(targetId);
      next.splice(index === -1 ? next.length : index, 0, dragId);
      return next;
    });
  };

  const ordered = order
    .map((id) => collections.find((collection) => collection.id === id))
    .filter((collection): collection is Collection => Boolean(collection));

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y divide-ink-100">
        {ordered.map((collection, index) => (
          <li
            key={collection.id}
            draggable={canManage}
            onDragStart={() => setDragId(collection.id)}
            onDragEnter={() => move(collection.id)}
            onDragEnd={() => setDragId(null)}
            className={`flex items-center gap-2 px-4 py-2 ${dragId === collection.id ? 'opacity-50' : ''}`}
          >
            <span className="w-5 text-right text-xs text-ink-400">{index + 1}</span>
            <span className="flex-1 text-sm">{collection.name}</span>
            {canManage && <span className="cursor-grab text-ink-300">⋮⋮</span>}
          </li>
        ))}
      </ul>
      {canManage && (
        <form action={action} className="flex items-center gap-2 border-t border-ink-200 px-4 py-2.5">
          <input type="hidden" name="order" value={order.join(',')} />
          <button className="btn btn-sm btn-primary" type="submit" disabled={!dirty || pending}>
            {pending ? 'Saving…' : 'Save order'}
          </button>
          {state && (
            <span className={`text-2xs ${state.ok ? 'text-emerald-700' : 'text-red-600'}`}>
              {state.ok ? state.message : state.error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
