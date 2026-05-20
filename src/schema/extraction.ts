import { z } from 'zod';

/**
 * Schema for a structured contract extraction.
 *
 * Each scalar field is EITHER a full object (`value`, `evidence_quote`
 * verbatim from the PDF, `evidence_page`) OR `null` when the field isn't
 * present in the contract. Whole-field nullability (one union per field)
 * keeps the strict-tool-use union count low — three independently-nullable
 * properties per field would blow Anthropic strict mode's 16-union limit.
 *
 * The verification layer (src/lib/verify.ts) deterministically matches each
 * field's `evidence_quote` against the PDF's extracted page text. Confidence
 * is computed there, not reported by the model.
 *
 * Field count: 10 (parties + 9 scalar fields).
 */

const FieldData = z.object({
  value: z.string(),
  evidence_quote: z.string(),
  evidence_page: z.number().int().positive(),
});

/** A scalar field: the data object, or null when absent from the contract. */
const Field = FieldData.nullable();

/**
 * One party to the contract. Roles are freeform (Buyer/Seller/Provider/Client/
 * Licensor/Licensee/Other) — the model picks based on the contract's own
 * language. Each party carries its own page-anchored evidence.
 */
const Party = z.object({
  name: z.string(),
  role: z.string(),
  evidence_quote: z.string(),
  evidence_page: z.number().int().positive(),
});

export const ContractExtractionSchema = z.object({
  parties: z.array(Party),
  effective_date: Field,
  term: Field,
  payment_terms: Field,
  deliverables: Field,
  ip_ownership: Field,
  termination_clause: Field,
  governing_law: Field,
  kill_fee: Field,
  limitation_of_liability: Field,
});

export type ContractExtraction = z.infer<typeof ContractExtractionSchema>;
/** Field data when present (non-null). */
export type ContractFieldData = z.infer<typeof FieldData>;
/** A scalar field as the model returns it: data object or null. */
export type ContractField = z.infer<typeof Field>;
export type ContractParty = z.infer<typeof Party>;

/**
 * Ordered list of scalar field keys. Used by the UI to render rows in a stable
 * order and by the verification layer to iterate fields uniformly.
 *
 * Excludes `parties` because parties is an array-of-objects, not a Field.
 */
export const SCALAR_FIELD_KEYS = [
  'effective_date',
  'term',
  'payment_terms',
  'deliverables',
  'ip_ownership',
  'termination_clause',
  'governing_law',
  'kill_fee',
  'limitation_of_liability',
] as const;

export type ScalarFieldKey = (typeof SCALAR_FIELD_KEYS)[number];

/**
 * Human-readable labels for the UI (left-pane field rows, eval reports, etc).
 */
export const FIELD_LABELS: Record<'parties' | ScalarFieldKey, string> = {
  parties: 'Parties',
  effective_date: 'Effective date',
  term: 'Term',
  payment_terms: 'Payment terms',
  deliverables: 'Deliverables',
  ip_ownership: 'IP ownership',
  termination_clause: 'Termination',
  governing_law: 'Governing law',
  kill_fee: 'Kill fee',
  limitation_of_liability: 'Limitation of liability',
};
