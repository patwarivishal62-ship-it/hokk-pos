/**
 * Seeds system-level configuration and creates the first super admin.
 *
 *   npm run bootstrap
 *
 * Deliberately narrow: this creates ONLY roles, settings defaults, image slot
 * templates, attribute-field definitions and the Shopify column mapping — plus
 * the single super-admin account read from SEED_ADMIN_*. No products,
 * categories, handloom cultures or collections are seeded; the catalog starts
 * empty and is built by the team.
 */
import {
  createSuperAdmin,
  ensureSchema,
  isInitialized,
  seedShopifyMapping,
  seedSystemDefaults,
} from '@/lib/bootstrap';
import { all, get } from '@/lib/db';

function main(): void {
  ensureSchema();

  const alreadyInitialized = isInitialized();
  if (alreadyInitialized) {
    console.log('System is already initialised — re-seeding configuration only.');
  }

  seedSystemDefaults();
  const mapping = seedShopifyMapping();

  const roles = get<{ n: number }>('SELECT COUNT(*) AS n FROM role')?.n ?? 0;
  const settings = get<{ n: number }>('SELECT COUNT(*) AS n FROM setting')?.n ?? 0;
  const templates = get<{ n: number }>('SELECT COUNT(*) AS n FROM image_slot_template')?.n ?? 0;
  const slots = get<{ n: number }>('SELECT COUNT(*) AS n FROM image_slot_definition')?.n ?? 0;
  const fields = get<{ n: number }>('SELECT COUNT(*) AS n FROM attribute_field')?.n ?? 0;

  console.log(`Roles: ${roles}`);
  console.log(`Settings: ${settings}`);
  console.log(`Image slot templates: ${templates} (${slots} slots)`);
  console.log(`Attribute field definitions: ${fields}`);
  console.log(`Shopify column mapping: ${mapping.inserted} inserted, ${mapping.updated} updated`);

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Founder';

  if (!email || !password) {
    console.log('\nSEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set — skipping super admin creation.');
    console.log('You can also create the first account from the /setup screen in the browser.');
    return;
  }

  if (password === 'change-me') {
    console.log('\nRefusing to create a super admin with the placeholder password "change-me".');
    console.log('Set SEED_ADMIN_PASSWORD to a real password, or use the /setup screen.');
    process.exitCode = 1;
    return;
  }

  try {
    const created = createSuperAdmin({ email, name, password }, { allowWhenInitialized: alreadyInitialized });
    console.log(`\nSuper admin created: ${email} (${created.id})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already|UNIQUE/i.test(message)) {
      console.log(`\nSuper admin already exists (${email}) — nothing to do.`);
      return;
    }
    throw error;
  }

  const users = all<{ email: string; is_active: number }>('SELECT email, is_active FROM "user" ORDER BY created_at');
  console.log(`\nUsers: ${users.map((user) => user.email).join(', ')}`);
}

main();
