import { notFound } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { hasPermission } from '@/lib/rbac';
import { all } from '@/lib/db';
import { getExport, markExportStatus, readExportFile } from '@/lib/export';
import { buildOperationsWorkbook } from '@/lib/excel';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.permissions, 'export.view')) {
    return new Response('Forbidden', { status: 403 });
  }
  const { id } = await context.params;
  const record = getExport(id);
  if (!record) notFound();

  const format = request.nextUrl.searchParams.get('format') ?? 'csv';

  if (format === 'xlsx') {
    const items = all<{ product_id: string }>('SELECT product_id FROM export_run_product WHERE export_id = ? AND state != ?', [
      id,
      'BLOCKED',
    ]);
    const buffer = await buildOperationsWorkbook(items.map((item) => item.product_id));
    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="hokk-operations-${String(record.run.number).padStart(4, '0')}.xlsx"`,
      },
    });
  }

  const filePath = String(record.run.file_path ?? '');
  const buffer = readExportFile(filePath);
  if (!buffer) return new Response('Export file is no longer available.', { status: 410 });
  markExportStatus(id, 'DOWNLOADED');

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${String(record.run.file_name ?? 'shopify-products.csv')}"`,
      'content-length': String(buffer.length),
    },
  });
}
