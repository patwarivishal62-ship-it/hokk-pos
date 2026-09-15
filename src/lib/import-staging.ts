import 'server-only';
import { buildPreview, type ImportPreview } from '@/lib/importer';
import type { ExportMode } from '@/lib/types';

/**
 * Holds an uploaded CSV between the "analyse" step and the confirmed import.
 *
 * This lives outside `app/actions/imports.ts` because a `'use server'` module may
 * only export async functions, and the imports page needs a synchronous read.
 * Entries are evicted after 30 minutes.
 */
export interface StagedImport {
  text: string;
  mapping: Record<string, string>;
  mode: ExportMode;
  userId: string;
  createdAt: number;
}

const staged = new Map<string, StagedImport>();
const TTL_MS = 30 * 60 * 1000;

export function stageImport(id: string, entry: StagedImport): void {
  staged.set(id, entry);
  for (const [key, value] of staged) {
    if (Date.now() - value.createdAt > TTL_MS) staged.delete(key);
  }
}

export function takeStagedImport(id: string): StagedImport | undefined {
  return staged.get(id);
}

export function releaseStagedImport(id: string): void {
  staged.delete(id);
}

export function getStagedPreview(id: string): (ImportPreview & { mode: ExportMode }) | null {
  const entry = staged.get(id);
  if (!entry) return null;
  return { ...buildPreview(entry.text, entry.mapping, entry.mode), mode: entry.mode };
}
