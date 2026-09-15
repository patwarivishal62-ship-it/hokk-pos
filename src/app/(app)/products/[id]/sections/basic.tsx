import { requireUser, userCan } from '@/lib/auth';
import { all, get, parseJson } from '@/lib/db';
import { isHandloomProduct, type CompletenessResult, type ProductBundle } from '@/lib/completeness';
import type { ReadinessResult } from '@/lib/readiness';
import { Badge, Card, EmptyState, Meter, ReadinessBadge, StatusBadge, formatDateTime } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { assignAction, decideNameAction, proposeNameAction, saveAttributesAction, setGapAction, updateProductAction } from '@/app/actions/products';
import { CheckboxField, FormActions, MoneyField, SelectField, TextAreaField, TextField } from './fields';
import { NAME_STATUS_LABELS } from '@/lib/types';

interface Photos {
  complete: number;
  required: number;
}

interface Assignment {
  id: string;
  task_type: string;
  user_id: string;
  status: string;
  note: string | null;
  due_at: string | null;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function OverviewTab({
  bundle,
  completeness,
  readiness,
  photos,
  assignments,
  users,
}: {
  bundle: ProductBundle;
  completeness: CompletenessResult;
  readiness: ReadinessResult;
  photos: Photos;
  assignments: Assignment[];
  users: Array<{ id: string; name: string }>;
}) {
  const user = await requireUser();
  const { product } = bundle;
  const proposals = all<{
    id: string;
    proposed_name: string;
    rationale: string | null;
    status: string;
    created_at: string;
    proposer: string;
  }>(
    `SELECT np.id, np.proposed_name, np.rationale, np.status, np.created_at, u.name AS proposer
     FROM name_proposal np LEFT JOIN "user" u ON u.id = np.proposed_by_id
     WHERE np.product_id = ? ORDER BY np.created_at DESC`,
    [product.id],
  );
  const gaps = all<{ field_key: string; label: string; severity: string; status: string; note: string | null }>(
    'SELECT field_key, label, severity, status, note FROM product_gap WHERE product_id = ? ORDER BY status, label',
    [product.id],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="At a glance">
          <div className="grid grid-cols-2 gap-3 px-4 py-3 text-sm">
            <Summary label="SKU" value={product.sku} mono />
            <Summary label="Product name" value={product.name ?? '—'} />
            <Summary label="Name status" value={NAME_STATUS_LABELS[product.name_status]} />
            <Summary label="Status" value={<StatusBadge status={product.status} />} />
            <Summary label="Category" value={product.category_name ?? '—'} />
            <Summary label="Handloom culture" value={product.culture_name ?? '—'} />
            <Summary label="Colour" value={product.colour ?? '—'} />
            <Summary label="Fabric" value={product.fabric ?? '—'} />
            <Summary label="Price" value={product.price ? `${product.currency} ${product.price.toLocaleString('en-IN')}` : '—'} />
            <Summary label="Variants" value={String(bundle.variants.length)} />
            <Summary label="Images" value={`${bundle.images.length} (${photos.complete}/${photos.required} required)`} />
            <Summary label="Collections" value={bundle.collections.map((c) => c.name).join(', ') || '—'} />
          </div>
        </Card>

        <Card title="Naming workflow">
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-500">Current name</span>
              <span className="text-sm font-medium">{product.name ?? <em className="text-ink-400">Not named</em>}</span>
            </div>
            <Badge tone={product.name_status === 'NAME_APPROVED' ? 'success' : product.name_status === 'NOT_NAMED' ? 'neutral' : 'warn'}>
              {NAME_STATUS_LABELS[product.name_status]}
            </Badge>
            <p className="text-2xs text-ink-400">
              Names are never auto-generated. Content proposes, a reviewer or admin approves.
            </p>

            {userCan(user, 'name.propose') && (
              <ActionForm action={proposeNameAction} className="flex flex-col gap-2">
                <input type="hidden" name="product_id" value={product.id} />
                <input className="field" name="proposed_name" placeholder="Proposed product name" required />
                <input className="field" name="rationale" placeholder="Why this name? (optional)" />
                <button className="btn btn-sm" type="submit">
                  Propose name
                </button>
              </ActionForm>
            )}

            {proposals.length > 0 && (
              <ul className="flex flex-col divide-y divide-ink-100 border-t border-ink-200">
                {proposals.map((proposal) => (
                  <li key={proposal.id} className="flex flex-col gap-1 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{proposal.proposed_name}</span>
                      <Badge
                        tone={
                          proposal.status === 'APPROVED' ? 'success' : proposal.status === 'REJECTED' ? 'danger' : proposal.status === 'PENDING' ? 'warn' : 'neutral'
                        }
                      >
                        {proposal.status.toLowerCase()}
                      </Badge>
                    </div>
                    {proposal.rationale && <p className="text-2xs text-ink-500">{proposal.rationale}</p>}
                    <p className="text-2xs text-ink-400">
                      {proposal.proposer} · {formatDateTime(proposal.created_at)}
                    </p>
                    {proposal.status === 'PENDING' && userCan(user, 'name.approve') && (
                      <ActionForm action={decideNameAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="proposal_id" value={proposal.id} />
                        <input type="hidden" name="product_id" value={product.id} />
                        <button className="btn btn-sm btn-primary" type="submit" name="decision" value="approve">
                          Approve
                        </button>
                        <button className="btn btn-sm" type="submit" name="decision" value="reject">
                          Reject
                        </button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card title="Information completeness">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(completeness.bySection)
            .filter(([, section]) => section.total > 0)
            .map(([key, section]) => {
              const done = section.total - section.missing.length;
              const pct = Math.round((done / section.total) * 100);
              return (
                <div key={key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xs uppercase tracking-wider text-ink-500">{key.toLowerCase()}</span>
                    <span className="text-xs text-ink-600">
                      {done}/{section.total}
                    </span>
                  </div>
                  <Meter value={pct} />
                  {section.missing.length > 0 && (
                    <p className="text-2xs text-ink-400">Missing: {section.missing.map((m) => m.label).join(', ')}</p>
                  )}
                </div>
              );
            })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Missing information flags">
          {gaps.length === 0 ? (
            <EmptyState title="No flags" body="Mark a field as missing when the information cannot be confirmed. Never invent cultural details." />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-100">
              {gaps.map((gap) => (
                <li key={gap.field_key} className="flex items-start justify-between gap-2 px-4 py-2">
                  <div className="flex flex-col">
                    <span className="text-sm">{gap.label}</span>
                    <span className="text-2xs text-ink-400">
                      {gap.severity.toLowerCase()} · {gap.status.toLowerCase()}
                      {gap.note ? ` · ${gap.note}` : ''}
                    </span>
                  </div>
                  {userCan(user, 'product.edit') && (
                    <ActionForm action={setGapAction}>
                      <input type="hidden" name="product_id" value={product.id} />
                      <input type="hidden" name="field_key" value={gap.field_key} />
                      <input type="hidden" name="open" value={gap.status === 'OPEN' ? '0' : '1'} />
                      <button className="btn btn-sm" type="submit">
                        {gap.status === 'OPEN' ? 'Resolve' : 'Re-open'}
                      </button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Assignments">
          <div className="flex flex-col gap-3 px-4 py-3">
            {assignments.length === 0 ? (
              <p className="text-xs text-ink-400">No tasks assigned.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-ink-100">
                {assignments.map((assignment) => (
                  <li key={assignment.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm">
                      <span className="text-2xs uppercase tracking-wider text-ink-400">{assignment.task_type}</span>{' '}
                      {users.find((u) => u.id === assignment.user_id)?.name ?? 'Unknown'}
                    </span>
                    <Badge tone={assignment.status === 'DONE' ? 'success' : 'neutral'}>{assignment.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {userCan(user, 'product.assign') && (
              <ActionForm action={assignAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="product_id" value={product.id} />
                <SelectField
                  name="task_type"
                  label="Task"
                  placeholder="Overall owner"
                  options={[
                    { value: 'CONTENT', label: 'Content' },
                    { value: 'PHOTOGRAPHY', label: 'Photography' },
                    { value: 'REVIEW', label: 'Review' },
                    { value: 'APPROVAL', label: 'Approval' },
                    { value: 'DATA', label: 'Data entry' },
                  ]}
                />
                <SelectField name="assignee_id" label="Team member" options={users.map((u) => ({ value: u.id, label: u.name }))} />
                <TextField name="note" label="Note" />
                <TextField name="due_at" label="Due" type="date" />
                <button className="btn btn-sm" type="submit">
                  Assign
                </button>
              </ActionForm>
            )}
          </div>
        </Card>
      </div>

      <Card title="Shopify readiness">
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <ReadinessBadge state={readiness.state} />
            <span className="text-sm">
              {readiness.errors.length} error{readiness.errors.length === 1 ? '' : 's'}, {readiness.warnings.length} warning
              {readiness.warnings.length === 1 ? '' : 's'}
            </span>
          </div>
          {readiness.issues.length === 0 ? (
            <p className="text-xs text-emerald-700">This product can be exported to Shopify.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-ink-100">
              {readiness.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="flex items-start gap-2 py-1.5">
                  <Badge tone={issue.severity === 'ERROR' ? 'danger' : 'warn'}>{issue.severity === 'ERROR' ? 'Error' : 'Warning'}</Badge>
                  <span className="text-xs text-ink-700">{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function Summary({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wider text-ink-500">{label}</span>
      <span className={`text-sm text-ink-800 ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product data
// ---------------------------------------------------------------------------

export async function ProductDataTab({ bundle }: { bundle: ProductBundle }) {
  const user = await requireUser();
  const { product } = bundle;
  const canEdit = userCan(user, 'product.edit');
  const canEditSku = userCan(user, 'product.sku.edit');
  const categories = all<{ id: string; name: string; parent_id: string | null }>(
    'SELECT id, name, parent_id FROM category WHERE is_archived = 0 ORDER BY sort_order, name',
  );
  const cultures = all<{ id: string; name: string; code: string }>(
    'SELECT id, name, code FROM handloom_culture WHERE is_archived = 0 ORDER BY sort_order, name',
  );
  const users = all<{ id: string; name: string }>('SELECT id, name FROM "user" WHERE is_active = 1 ORDER BY name');
  const templateKey = product.template_key || 'GENERIC';
  const isSaree = isHandloomProduct(product);

  return (
    <ActionForm
      action={updateProductAction}
      className="flex flex-col gap-4"
    >
        <input type="hidden" name="product_id" value={product.id} />
      <Card title="Basic information">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            name="sku"
            label="Product ID / SKU"
            value={product.sku}
            disabled={!canEditSku}
            hint={canEditSku ? 'Unique. Changing this breaks existing exports.' : 'Only an administrator can change the SKU.'}
          />
          <TextField name="internal_reference" label="Internal reference" value={product.internal_reference} placeholder="Legacy sheet id" />
          <TextField name="product_type_label" label="Product type" value={product.product_type_label} placeholder="Saree, T-shirt…" />
          <TextField name="name" label="Product name" value={product.name} placeholder="Leave blank until naming is approved" hint="Approved through the naming workflow." />
          <SelectField
            name="gender"
            label="Gender"
            value={product.gender}
            options={['Women', 'Men', 'Unisex', 'Girls', 'Boys'].map((v) => ({ value: v, label: v }))}
          />
          <TextField name="target_audience" label="Target audience" value={product.target_audience} />
          <TextField name="occasion" label="Occasion" value={product.occasion} placeholder="Festive, Everyday…" />
          <TextField name="season" label="Season" value={product.season} />
          <SelectField name="assignee_id" label="Assigned to" value={product.assignee_id} options={users.map((u) => ({ value: u.id, label: u.name }))} />
        </div>
      </Card>

      <Card title="Classification">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            name="category_id"
            label="Category"
            value={product.category_id}
            options={categories.filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            name="subcategory_id"
            label="Subcategory"
            value={product.subcategory_id}
            options={categories.filter((c) => c.parent_id).map((c) => ({ value: c.id, label: `${c.name}` }))}
          />
          <SelectField
            name="handloom_culture_id"
            label="Handloom culture"
            value={product.handloom_culture_id}
            options={cultures.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
          />
          <TextField name="region" label="Region" value={product.region} />
          <TextField name="state" label="State" value={product.state} />
          <TextField name="origin" label="Origin" value={product.origin} placeholder="Kaithoon, Rajasthan" />
        </div>
      </Card>

      <Card title={isSaree ? 'Saree specifications' : templateKey === 'APPAREL' ? 'Apparel specifications' : 'Product details'}>
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField name="colour" label="Colour" value={product.colour} />
          <TextField name="fabric" label="Fabric" value={product.fabric} />
          <TextField name="fabric_composition" label="Fabric composition" value={product.fabric_composition} placeholder="Silk 60% / Cotton 40%" />
          <TextField name="material" label="Material" value={product.material} />
          <TextField name="weave" label="Weave" value={product.weave} />
          <TextField name="technique" label="Technique" value={product.technique} />
          <TextField name="pattern" label="Pattern" value={product.pattern} />
          <TextField name="motifs" label="Motifs" value={product.motifs} />
          <TextField name="weight" label="Weight" value={product.weight} type="number" />
          <TextField name="care_instructions" label="Care instructions" value={product.care_instructions} />

          {isSaree && (
            <>
              <TextField name="border" label="Border" value={product.border} />
              <TextField name="pallu" label="Pallu" value={product.pallu} />
              <TextField name="zari" label="Zari" value={product.zari} />
              <TextField name="saree_length" label="Saree length (cm)" value={product.saree_length} type="number" />
              <TextField name="saree_width" label="Saree width (cm)" value={product.saree_width} type="number" />
              <TextField name="blouse_length" label="Blouse length (cm)" value={product.blouse_length} type="number" />
              <TextField name="blouse_fabric" label="Blouse fabric" value={product.blouse_fabric} />
              <TextField name="blouse_colour" label="Blouse colour" value={product.blouse_colour} />
              <TextField name="transparency" label="Transparency" value={product.transparency} />
              <TextField name="fall_pico_status" label="Fall / pico status" value={product.fall_pico_status} />
            </>
          )}

          {templateKey === 'APPAREL' && (
            <>
              <TextField name="fit" label="Fit" value={product.fit} />
              <TextField name="neckline" label="Neckline" value={product.neckline} />
              <TextField name="sleeve" label="Sleeve" value={product.sleeve} />
              <TextField name="garment_length" label="Length" value={product.garment_length} />
              <TextField name="closure" label="Closure" value={product.closure} />
              <TextField name="lining" label="Lining" value={product.lining} />
              <TextField name="pockets" label="Pockets" value={product.pockets} />
              <TextField name="stretch" label="Stretch" value={product.stretch} />
            </>
          )}
        </div>
      </Card>

      {bundle.attributes.length > 0 && <AttributeEditor bundle={bundle} />}

      <Card title="Tags & internal notes">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <TextField
            name="tags"
            label="Tags"
            value={parseJson<string[]>(product.tags, []).join(', ')}
            hint="Comma separated. Exported to the Shopify Tags column."
          />
          <TextAreaField name="internal_notes" label="Internal notes" value={product.internal_notes} rows={3} hint="Never exported to Shopify." />
        </div>
      </Card>

      {canEdit && <FormActions />}
    </ActionForm>
  );
}

function AttributeEditor({ bundle }: { bundle: ProductBundle }) {
  const groups = bundle.attributes.reduce<Record<string, typeof bundle.attributes>>((acc, field) => {
    const key = field.group_label || field.group_key;
    (acc[key] ??= []).push(field);
    return acc;
  }, {});

  return (
    <Card title="Additional attributes" action={<span className="text-2xs text-ink-400">Admin-defined per product type</span>}>
      {Object.entries(groups).map(([groupLabel, fields]) => (
        <div key={groupLabel} className="border-b border-ink-100 px-4 py-3 last:border-0">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-500">{groupLabel}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((field) => {
              const options = parseJson<string[]>(field.options, []);
              const name = `attr:${field.id}`;
              return (
                <div key={field.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="normal-case">{field.label}</label>
                    <label className="flex items-center gap-1 text-2xs normal-case text-amber-700">
                      <input type="checkbox" name={`${name}:missing`} defaultChecked={field.is_missing === 1} />
                      Missing
                    </label>
                  </div>
                  {field.field_type === 'SELECT' ? (
                    <select className="field" name={name} defaultValue={field.value ?? ''}>
                      <option value="">—</option>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.field_type === 'BOOLEAN' ? (
                    <select className="field" name={name} defaultValue={field.value ?? ''}>
                      <option value="">—</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  ) : field.field_type === 'TEXTAREA' ? (
                    <textarea className="field" name={name} rows={2} defaultValue={field.value ?? ''} />
                  ) : (
                    <input
                      className="field"
                      name={name}
                      type={field.field_type === 'NUMBER' ? 'number' : 'text'}
                      defaultValue={field.value ?? ''}
                      placeholder={field.unit ? `in ${field.unit}` : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="border-t border-ink-200 px-4 py-2 text-2xs text-ink-400">
        Tick “Missing” instead of guessing. Flagged fields appear on the missing-information dashboard and block export when
        the field is required.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Handloom & craft
// ---------------------------------------------------------------------------

export async function HandloomTab({ bundle }: { bundle: ProductBundle }) {
  const user = await requireUser();
  const { product } = bundle;
  const culture = product.handloom_culture_id
    ? get<{
        name: string;
        region: string | null;
        state: string | null;
        description: string | null;
        history: string | null;
        technique: string | null;
        significance: string | null;
        typical_materials: string | null;
        typical_motifs: string | null;
      }>('SELECT * FROM handloom_culture WHERE id = ?', [product.handloom_culture_id])
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Never invent cultural information. If a detail cannot be confirmed with the weaver or cluster, tick “Mark missing” —
        it will surface on the missing-information dashboard instead of being published.
      </div>

      <ActionForm
        action={updateProductAction}
        className="flex flex-col gap-4"
      >
          <input type="hidden" name="product_id" value={product.id} />
        <Card title="Provenance">
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField name="artisan_name" label="Artisan / weaver" value={product.artisan_name} hint="Only if verified." />
            <TextField name="yarn" label="Yarn" value={product.yarn} />
            <TextField name="zari_type" label="Zari type" value={product.zari_type} />
            <TextField name="dyeing_method" label="Dyeing method" value={product.dyeing_method} />
            <TextField name="embroidery" label="Embroidery" value={product.embroidery} />
            <TextField name="special_techniques" label="Special techniques" value={product.special_techniques} />
            <TextField name="certification" label="Authenticity / certification" value={product.certification} placeholder="Handloom Mark, Silk Mark…" />
            <TextField name="origin" label="Origin" value={product.origin} />
          </div>
        </Card>

        <Card title="Stories">
          <div className="grid gap-3 px-4 py-3">
            <TextAreaField name="craft_story" label="Craft story" value={product.craft_story} rows={4} />
            <TextAreaField name="artisan_story" label="Weaver story" value={product.artisan_story} rows={4} hint="Only with the weaver's consent and verified facts." />
            <TextAreaField name="historical_context" label="Historical context" value={product.historical_context} rows={4} />
            <TextAreaField name="cultural_significance" label="Cultural significance" value={product.cultural_significance} rows={4} />
          </div>
        </Card>

        {userCan(user, 'product.edit') && <FormActions />}
      </ActionForm>

      {culture && (
        <Card title={`Reference: ${culture.name}`} action={<span className="text-2xs text-ink-400">Curated guidance — copy carefully</span>}>
          <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-2">
            <RefField label="Region" value={culture.region} />
            <RefField label="State" value={culture.state} />
            <RefField label="Typical materials" value={culture.typical_materials} />
            <RefField label="Typical motifs" value={culture.typical_motifs} />
            <RefField label="Technique" value={culture.technique} wide />
            <RefField label="History" value={culture.history} wide />
            <RefField label="Significance" value={culture.significance} wide />
            <RefField label="Description" value={culture.description} wide />
          </div>
        </Card>
      )}
    </div>
  );
}

function RefField({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-2xs uppercase tracking-wider text-ink-500">{label}</span>
      <span className="text-xs text-ink-700">{value || '—'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export async function MeasurementsTab({
  bundle,
  measurements,
}: {
  bundle: ProductBundle;
  measurements: Array<{ label: string; value: string; unit: string }>;
}) {
  const user = await requireUser();
  const { product } = bundle;
  const sizeGuides = all<{ id: string; name: string; unit: string }>('SELECT id, name, unit FROM size_guide WHERE is_archived = 0 ORDER BY name');
  const guide = product.size_guide_id
    ? get<{ id: string; name: string; unit: string }>('SELECT id, name, unit FROM size_guide WHERE id = ?', [product.size_guide_id])
    : null;
  const guideColumns = guide
    ? all<{ id: string; key: string; label: string }>('SELECT id, key, label FROM size_guide_column WHERE size_guide_id = ? ORDER BY sort_order', [guide.id])
    : [];
  const guideRows = guide
    ? all<{ id: string; size_label: string }>('SELECT id, size_label FROM size_guide_row WHERE size_guide_id = ? ORDER BY sort_order', [guide.id])
    : [];
  const cells = guide
    ? all<{ row_id: string; column_id: string; value: string }>('SELECT row_id, column_id, value FROM size_guide_cell WHERE row_id IN (SELECT id FROM size_guide_row WHERE size_guide_id = ?)', [guide.id])
    : [];

  return (
    <div className="flex flex-col gap-4">
      <ActionForm
        action={updateProductAction}
        className="flex flex-col gap-4"
      >
          <input type="hidden" name="product_id" value={product.id} />
        <Card title="Product measurements">
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="text-2xs text-ink-400">
              One entry per line as <span className="mono">label=value|unit</span>, for example{' '}
              <span className="mono">Saree length=550|cm</span>. Sarees use product-specific measurements rather than apparel sizes.
            </p>
            <textarea
              className="field font-mono text-xs"
              name="measurements"
              rows={Math.max(4, measurements.length + 1)}
              defaultValue={measurements.map((m) => `${m.label}=${m.value}|${m.unit}`).join('\n')}
            />
            <input type="hidden" name="length_unit" value={product.length_unit} />
          </div>
        </Card>

        <Card title="Size guide">
          <div className="flex flex-wrap items-end gap-3 px-4 py-3">
            <SelectField
              name="size_guide_id"
              label="Assigned size guide"
              value={product.size_guide_id}
              options={sizeGuides.map((g) => ({ value: g.id, label: `${g.name} (${g.unit})` }))}
              className="w-64"
            />
            {userCan(user, 'product.edit') && (
              <button className="btn btn-sm" type="submit">
                Save
              </button>
            )}
          </div>
        </Card>
      </ActionForm>

      <Card title={guide ? `Size guide: ${guide.name}` : 'Size guide'}>
        {!guide ? (
          <EmptyState title="No size guide assigned" body="Create one under Size guides, then assign it to this product." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Size</th>
                  {guideColumns.map((column) => (
                    <th key={column.id}>
                      {column.label} ({guide.unit})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guideRows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.size_label}</td>
                    {guideColumns.map((column) => (
                      <td key={column.id}>{cells.find((cell) => cell.row_id === row.id && cell.column_id === column.id)?.value || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
