/**
 * Applies db/schema.sql to the configured database.
 *
 *   npm run db:init
 *
 * Idempotent: the DDL is all CREATE ... IF NOT EXISTS, so re-running is safe.
 * Run `npm run bootstrap` afterwards to seed roles, settings, image slot
 * templates and the Shopify column mapping.
 */
import { ensureSchema } from '@/lib/bootstrap';
import { all } from '@/lib/db';

function main(): void {
  const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
  console.log(`Applying schema to ${databaseUrl}`);
  ensureSchema();

  const tables = all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  console.log(`${tables.length} tables ready:`);
  console.log(
    tables
      .map((table) => table.name)
      .join(', '),
  );
}

main();
