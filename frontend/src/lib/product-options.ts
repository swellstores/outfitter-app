import type { SwellData } from '@swell/apps-sdk';

/**
 * A product's options, in the shape the product page renders and the cart
 * middleware posts back.
 *
 * Swell models four input types and four deprecated aliases for them. An
 * option may also be a *variant* option, meaning its values are what the
 * product's variants are built from — the page does not resolve the variant
 * itself: the API does, from the values posted. See `toCartOptions`.
 *
 * Pure, so the product page and the cart handler agree on one reading of the
 * same data without either importing the other.
 */

export type OptionInput = 'select' | 'toggle' | 'short_text' | 'long_text';

/** The field name an option's control carries, and the cart handler reads. */
export const OPTION_FIELD_PREFIX = 'options[';

export interface OptionValue {
  id: string;
  name: string;
  /** Added to the unit price by the API when this value is chosen. */
  price: number;
  /** The product in this value — a colourway — shown when it is chosen. */
  image: string;
}

export interface ProductOption {
  id: string;
  name: string;
  input: OptionInput;
  /** Its values, empty for the text inputs. */
  values: OptionValue[];
  required: boolean;
  /** Whether this option's values are what the variants are built from. */
  variant: boolean;
  /** Placeholder for a text input, help text for the rest. */
  hint: string;
  description: string;
  /** Charged when the option is answered at all — text inputs only. */
  price: number;
  /** Shown only when the parent option holds one of `parentValueIds`. */
  parentId: string;
  parentValueIds: string[];
  /** The form field this option's control is named with. */
  field: string;
}

/**
 * The deprecated aliases resolve to the type that replaced them. Swell's own
 * reference theme has no branch for them at all and renders such an option as
 * nothing, silently; mapping them costs four lines and cannot surprise anyone.
 */
const INPUTS: Record<string, OptionInput> = {
  select: 'select',
  dropdown: 'select',
  toggle: 'toggle',
  checkbox: 'toggle',
  short_text: 'short_text',
  text: 'short_text',
  long_text: 'long_text',
  textarea: 'long_text',
};

export function optionField(id: string): string {
  return `${OPTION_FIELD_PREFIX}${id}]`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function money(value: unknown): number {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * The options a shopper answers, in the merchant's order. An option with no
 * id is dropped: it is what the API matches on, and a name match is case
 * folded and therefore ambiguous between two similarly named options.
 */
export function productOptions(product: SwellData | null | undefined): ProductOption[] {
  const raw: SwellData[] = Array.isArray(product?.options) ? product.options : [];

  return raw
    .filter((option) => option?.active !== false && text(option?.id))
    .map((option) => {
      const values: OptionValue[] = (Array.isArray(option.values) ? option.values : [])
        .filter((value: SwellData) => text(value?.id))
        .map((value: SwellData) => ({
          id: String(value.id),
          name: text(value.name),
          price: money(value.price),
          image: text(value.image?.url),
        }));

      // A missing input_type means the option is a plain select, which is what
      // the dashboard creates when a merchant adds values and nothing else.
      const input = INPUTS[text(option.input_type)] ?? 'select';

      return {
        id: String(option.id),
        name: text(option.name),
        input,
        values,
        // The model's own default: everything is required except a toggle.
        required: option.required === undefined ? input !== 'toggle' : option.required === true,
        variant: option.variant === true,
        hint: text(option.input_hint),
        description: text(option.description),
        price: money(option.price),
        parentId: text(option.parent_id),
        parentValueIds: Array.isArray(option.parent_value_ids)
          ? option.parent_value_ids.map((id: unknown) => String(id))
          : [],
        field: optionField(String(option.id)),
      };
    })
    .filter((option) => option.name !== '' && (option.input !== 'select' || option.values.length > 0));
}

/**
 * What a chosen value adds to the price: the value's own for an option that
 * has values, the option's own for a text input, which is charged as soon as
 * it is answered. The API applies both; this is only what the page says it
 * will do before the shopper commits.
 */
export function optionPrice(option: ProductOption, valueId?: string): number {
  if (option.values.length === 0) {
    return option.price;
  }

  return option.values.find((value) => value.id === valueId)?.price ?? 0;
}

/**
 * Form fields to the `options` payload `cart.addItem` takes.
 *
 * Values are posted as ids and reach the API as `{ id, value }` — swell-js
 * strips every other key. An id is accepted in `value` and is unambiguous,
 * where a name is matched case-folded against every value on the option.
 *
 * Empty answers are dropped rather than sent as blanks: an unchecked toggle
 * is the absence of the option, not an option with no value.
 */
export function toCartOptions(form: FormData): Array<{ id: string; value: string }> {
  const options: Array<{ id: string; value: string }> = [];

  // forEach, not entries(): the Workers FormData type does not declare the
  // iterator, and this runs in the worker.
  form.forEach((raw, field) => {
    if (!field.startsWith(OPTION_FIELD_PREFIX) || !field.endsWith(']')) {
      return;
    }

    const id = field.slice(OPTION_FIELD_PREFIX.length, -1);
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (id && value) {
      options.push({ id, value });
    }
  });

  return options;
}
