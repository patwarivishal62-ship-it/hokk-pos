/**
 * Product workflow (spec §6).
 *
 * The lifecycle is data, not hard-coded branches: TRANSITIONS declares which
 * moves are legal from each status, and `canTransition` additionally applies
 * gating rules (e.g. a product cannot become SHOPIFY_READY while mandatory
 * information is missing).
 */
import type { ProductStatus } from '@/lib/types';

export interface TransitionRule {
  to: ProductStatus;
  label: string;
  /** Requires the Shopify readiness engine to report READY. */
  requiresReady?: boolean;
  /** Requires the Shopify readiness engine to report READY or WARNINGS. */
  requiresReadyOrWarnings?: boolean;
  requiresComment?: boolean;
  permission?: string;
  tone?: 'default' | 'primary' | 'danger';
}

export const TRANSITIONS: Record<ProductStatus, TransitionRule[]> = {
  DRAFT: [
    { to: 'INFORMATION_REQUIRED', label: 'Send for information' },
    { to: 'INFORMATION_COMPLETE', label: 'Mark information complete' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  INFORMATION_REQUIRED: [
    { to: 'INFORMATION_COMPLETE', label: 'Information complete' },
    { to: 'DRAFT', label: 'Return to draft' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  INFORMATION_COMPLETE: [
    { to: 'PHOTOGRAPHY_REQUIRED', label: 'Send to photography' },
    { to: 'CONTENT_REVIEW', label: 'Send to content review' },
    { to: 'INFORMATION_REQUIRED', label: 'Information incomplete' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  PHOTOGRAPHY_REQUIRED: [
    { to: 'PHOTOGRAPHY_COMPLETE', label: 'Photography complete' },
    { to: 'INFORMATION_REQUIRED', label: 'Return for information' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  PHOTOGRAPHY_COMPLETE: [
    { to: 'CONTENT_REVIEW', label: 'Send to content review' },
    { to: 'PHOTOGRAPHY_REQUIRED', label: 'Return to photography' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  CONTENT_REVIEW: [
    { to: 'INTERNAL_REVIEW', label: 'Send to internal review' },
    { to: 'CHANGES_REQUESTED', label: 'Request changes', requiresComment: true, tone: 'danger' },
    { to: 'PHOTOGRAPHY_REQUIRED', label: 'Return to photography' },
    { to: 'INFORMATION_REQUIRED', label: 'Return for information' },
  ],
  INTERNAL_REVIEW: [
    { to: 'FOUNDER_APPROVAL', label: 'Send for founder approval' },
    { to: 'CHANGES_REQUESTED', label: 'Request changes', requiresComment: true, tone: 'danger' },
    { to: 'CONTENT_REVIEW', label: 'Return to content review' },
  ],
  FOUNDER_APPROVAL: [
    { to: 'SHOPIFY_READY', label: 'Approve — Shopify ready', requiresReady: true, permission: 'product.approve', tone: 'primary' },
    { to: 'CHANGES_REQUESTED', label: 'Request changes', requiresComment: true, tone: 'danger' },
    { to: 'REJECTED', label: 'Reject', requiresComment: true, permission: 'product.reject', tone: 'danger' },
    { to: 'INTERNAL_REVIEW', label: 'Return to internal review' },
  ],
  SHOPIFY_READY: [
    { to: 'EXPORTED', label: 'Mark exported', permission: 'export.run' },
    { to: 'PUBLISHED', label: 'Mark published', permission: 'export.run' },
    { to: 'CHANGES_REQUESTED', label: 'Request changes', requiresComment: true, tone: 'danger' },
    { to: 'INTERNAL_REVIEW', label: 'Return to internal review' },
  ],
  EXPORTED: [
    { to: 'PUBLISHED', label: 'Mark published', permission: 'export.run' },
    { to: 'SHOPIFY_READY', label: 'Back to Shopify ready' },
  ],
  PUBLISHED: [
    { to: 'SHOPIFY_READY', label: 'Re-open for changes' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  CHANGES_REQUESTED: [
    { to: 'INFORMATION_REQUIRED', label: 'Return for information' },
    { to: 'PHOTOGRAPHY_REQUIRED', label: 'Return to photography' },
    { to: 'CONTENT_REVIEW', label: 'Return to content review' },
    { to: 'DRAFT', label: 'Return to draft' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  REJECTED: [
    { to: 'DRAFT', label: 'Re-open as draft' },
    { to: 'ARCHIVED', label: 'Archive', permission: 'product.archive' },
  ],
  ARCHIVED: [{ to: 'DRAFT', label: 'Restore to draft', permission: 'product.archive' }],
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export function canTransition(
  from: ProductStatus,
  to: ProductStatus,
  context: {
    readinessState?: 'READY' | 'WARNINGS' | 'BLOCKED';
    readinessIssueCount?: number;
    hasComment?: boolean;
    permissions?: string[];
  } = {},
): TransitionCheck {
  const rule = TRANSITIONS[from]?.find((t) => t.to === to);
  if (!rule) return { allowed: false, reason: `A product in "${from}" cannot move directly to "${to}".` };

  if (rule.permission) {
    const granted = context.permissions ?? [];
    const ok = granted.includes('*') || granted.includes(rule.permission);
    if (!ok) return { allowed: false, reason: `Requires the "${rule.permission}" permission.` };
  }
  if (rule.requiresReady && context.readinessState !== 'READY') {
    return {
      allowed: false,
      reason: 'Shopify readiness must be READY before a product can be approved.',
    };
  }
  if (rule.requiresReadyOrWarnings && context.readinessState === 'BLOCKED') {
    return { allowed: false, reason: 'Resolve blocking issues before moving this product on.' };
  }
  if (rule.requiresComment && !context.hasComment) {
    return { allowed: false, reason: 'A reason is required for this action.' };
  }
  return { allowed: true };
}

export function nextStatuses(status: ProductStatus): TransitionRule[] {
  return TRANSITIONS[status] ?? [];
}
