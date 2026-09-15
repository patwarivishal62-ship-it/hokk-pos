import { describe, expect, it } from 'vitest';
import { TRANSITIONS, canTransition, nextStatuses } from '@/lib/workflow';
import { PRODUCT_STATUSES } from '@/lib/types';

describe('workflow transitions (spec §6)', () => {
  it('follows the documented happy path', () => {
    const path = [
      ['DRAFT', 'INFORMATION_COMPLETE'],
      ['INFORMATION_COMPLETE', 'PHOTOGRAPHY_REQUIRED'],
      ['PHOTOGRAPHY_REQUIRED', 'PHOTOGRAPHY_COMPLETE'],
      ['PHOTOGRAPHY_COMPLETE', 'CONTENT_REVIEW'],
      ['CONTENT_REVIEW', 'INTERNAL_REVIEW'],
      ['INTERNAL_REVIEW', 'FOUNDER_APPROVAL'],
    ] as const;
    for (const [from, to] of path) {
      expect(canTransition(from, to).allowed, `${from} -> ${to}`).toBe(true);
    }
  });

  it('refuses to skip stages', () => {
    expect(canTransition('DRAFT', 'SHOPIFY_READY').allowed).toBe(false);
    expect(canTransition('DRAFT', 'PUBLISHED').allowed).toBe(false);
  });

  it('blocks Shopify readiness unless the readiness engine reports READY', () => {
    expect(canTransition('FOUNDER_APPROVAL', 'SHOPIFY_READY', { readinessState: 'BLOCKED' }).allowed).toBe(false);
    expect(canTransition('FOUNDER_APPROVAL', 'SHOPIFY_READY', { readinessState: 'WARNINGS' }).allowed).toBe(false);
    expect(
      canTransition('FOUNDER_APPROVAL', 'SHOPIFY_READY', { readinessState: 'READY', permissions: ['*'] }).allowed,
    ).toBe(true);
  });

  it('requires the approve permission', () => {
    const result = canTransition('FOUNDER_APPROVAL', 'SHOPIFY_READY', {
      readinessState: 'READY',
      permissions: ['product.view'],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('product.approve');
  });

  it('requires a reason when requesting changes', () => {
    expect(canTransition('CONTENT_REVIEW', 'CHANGES_REQUESTED', { hasComment: false }).allowed).toBe(false);
    expect(canTransition('CONTENT_REVIEW', 'CHANGES_REQUESTED', { hasComment: true }).allowed).toBe(true);
  });

  it('lets a product return to an earlier stage', () => {
    expect(canTransition('CONTENT_REVIEW', 'PHOTOGRAPHY_REQUIRED').allowed).toBe(true);
    expect(canTransition('CHANGES_REQUESTED', 'INFORMATION_REQUIRED').allowed).toBe(true);
  });

  it('gates archiving behind the archive permission', () => {
    expect(canTransition('DRAFT', 'ARCHIVED', { permissions: ['product.view'] }).allowed).toBe(false);
    expect(canTransition('DRAFT', 'ARCHIVED', { permissions: ['product.archive'] }).allowed).toBe(true);
  });

  it('can restore an archived product', () => {
    expect(canTransition('ARCHIVED', 'DRAFT', { permissions: ['*'] }).allowed).toBe(true);
  });

  it('defines outgoing transitions for every status', () => {
    for (const status of PRODUCT_STATUSES) {
      expect(TRANSITIONS[status], `${status} has no transitions`).toBeDefined();
      expect(nextStatuses(status).length, `${status} is a dead end`).toBeGreaterThan(0);
    }
  });
});
