// @vitest-environment jsdom
/**
 * Regression tests for form wiring.
 *
 * The /setup and /login pages rendered a <form> WITHOUT the server-action
 * returned by useActionState, so submits fell through to a native GET reload
 * and never reached setupAction/loginAction. The import page had the same bug
 * class: the column-mapping selects lived in an action-less <form> separate
 * from ImportPreview's run form, while runImportAction reads map:* values from
 * the FormData of the run form.
 *
 * Each component below is mounted in jsdom, its fields are filled, and the
 * form is submitted with requestSubmit(). The mocked action must receive the
 * field values — which is only possible if the action is attached to the very
 * <form> that is submitted.
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React act() requires this flag in test environments.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { setupAction, loginAction, runImportAction } = vi.hoisted(() => ({
  setupAction: vi.fn(),
  loginAction: vi.fn(),
  runImportAction: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({
  setupAction: (prev: unknown, formData: FormData) => setupAction(prev, formData),
  loginAction: (prev: unknown, formData: FormData) => loginAction(prev, formData),
}));
vi.mock('@/app/actions/imports', () => ({
  runImportAction: (prev: unknown, formData: FormData) => runImportAction(prev, formData),
}));

import { SetupFields } from '@/app/setup/setup-fields';
import { LoginFields } from '@/app/login/login-fields';
import { ImportPreview } from '@/app/(app)/imports/import-preview';

let container: HTMLDivElement;
let root: Root;

function render(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
}

function form(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form');
  expect(form, 'component must render a <form>').not.toBeNull();
  return form as HTMLFormElement;
}

function input(form: HTMLFormElement, name: string): HTMLInputElement {
  const el = form.querySelector(`input[name="${name}"]`);
  expect(el, `form must contain input[name="${name}"]`).not.toBeNull();
  return el as HTMLInputElement;
}

function select(form: HTMLFormElement, name: string): HTMLSelectElement {
  const el = form.querySelector(`select[name="${name}"]`);
  expect(el, `form must contain select[name="${name}"]`).not.toBeNull();
  return el as HTMLSelectElement;
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(prototype, 'value')?.set as
    | ((this: HTMLInputElement | HTMLSelectElement, value: string) => void)
    | undefined;
  expect(set, 'value setter must exist').toBeTruthy();
  set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAction.mockResolvedValue({ ok: true, message: 'created' });
  loginAction.mockResolvedValue({ ok: true, message: 'signed in' });
  runImportAction.mockResolvedValue({ ok: true, message: 'imported' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('setup form wiring', () => {
  it('submits name/email/password/confirm to setupAction', async () => {
    render(<SetupFields defaults={{ name: '', email: '' }} />);
    const formEl = form(container);

    setValue(input(formEl, 'name'), 'Asha Patel');
    setValue(input(formEl, 'email'), 'asha@hokk.example');
    setValue(input(formEl, 'password'), 'Hokk-2026!x');
    setValue(input(formEl, 'confirm'), 'Hokk-2026!x');

    await submit(formEl);

    expect(setupAction).toHaveBeenCalledTimes(1);
    const [prev, data] = setupAction.mock.calls[0] as [unknown, FormData];
    expect(prev).toBeNull();
    expect(data.get('name')).toBe('Asha Patel');
    expect(data.get('email')).toBe('asha@hokk.example');
    expect(data.get('password')).toBe('Hokk-2026!x');
    expect(data.get('confirm')).toBe('Hokk-2026!x');
  });

  it('keeps the card classes on the form', () => {
    render(<SetupFields defaults={{ name: '', email: '' }} />);
    const formEl = form(container);
    expect(formEl.classList.contains('card')).toBe(true);
    expect(formEl.classList.contains('flex')).toBe(true);
  });
});

describe('login form wiring', () => {
  it('submits email/password to loginAction', async () => {
    render(<LoginFields />);
    const formEl = form(container);

    setValue(input(formEl, 'email'), 'asha@hokk.example');
    setValue(input(formEl, 'password'), 'Hokk-2026!x');

    await submit(formEl);

    expect(loginAction).toHaveBeenCalledTimes(1);
    const [prev, data] = loginAction.mock.calls[0] as [unknown, FormData];
    expect(prev).toBeNull();
    expect(data.get('email')).toBe('asha@hokk.example');
    expect(data.get('password')).toBe('Hokk-2026!x');
  });
});

describe('import form wiring', () => {
  const targets = [
    { key: 'name', label: 'Product name' },
    { key: 'sku', label: 'SKU' },
    { key: 'category', label: 'Category (name)' },
  ];
  const columns = ['Title', 'SKU', 'Category', 'Price'];
  const summary = { total: 4, valid: 3, invalid: 1, duplicates: 1, newProducts: 3, updates: 0 };

  it('submits the column mapping together with the run controls', async () => {
    render(
      <ImportPreview
        previewId="preview_123"
        mode="NEW"
        summary={summary}
        targets={targets}
        columns={columns}
        mapping={{ name: 'Title', sku: 'SKU' }}
      />,
    );
    const formEl = form(container);

    // The mapping selects and the run controls must live in the same form.
    expect(formEl.querySelector('button[type="submit"]'), 'run button must be in the form').not.toBeNull();
    const nameSelect = select(formEl, 'map:name');
    const skuSelect = select(formEl, 'map:sku');
    const categorySelect = select(formEl, 'map:category');
    expect(nameSelect.value).toBe('Title');
    expect(skuSelect.value).toBe('SKU');

    setValue(skuSelect, 'Price');

    await submit(formEl);

    expect(runImportAction).toHaveBeenCalledTimes(1);
    const data = runImportAction.mock.calls[0][1] as FormData;
    expect(data.get('preview_id')).toBe('preview_123');
    expect(data.get('map:name')).toBe('Title');
    expect(data.get('map:sku')).toBe('Price');
    expect(data.get('map:category')).toBe('');
    expect(data.get('skip_duplicates')).toBe('1');
  });

  it('omits skip_duplicates when the box is unchecked', async () => {
    render(
      <ImportPreview
        previewId="preview_123"
        mode="UPDATE"
        summary={summary}
        targets={targets}
        columns={columns}
        mapping={{}}
      />,
    );
    const formEl = form(container);
    const checkbox = input(formEl, 'skip_duplicates');
    expect(checkbox.checked).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    await submit(formEl);

    expect(runImportAction).toHaveBeenCalledTimes(1);
    const data = runImportAction.mock.calls[0][1] as FormData;
    expect(data.get('skip_duplicates')).toBeNull();
    expect(data.get('map:name')).toBe('');
  });
});
