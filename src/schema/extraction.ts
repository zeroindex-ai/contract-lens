import { z } from 'zod';

/**
 * Schema for a structured, cited extraction from any official document.
 *
 * The model classifies the document, writes a short summary, names the parties,
 * and surfaces the most meaningful labeled details it finds — each one carrying
 * a verbatim `evidence_quote` and the `evidence_page` it appears on. There is no
 * fixed field list: `key_details` is open, so the tool adapts to whatever the
 * document actually contains (a contract's governing law, an offer letter's
 * start date and salary, an invoice's totals and due date, …).
 *
 * The verification layer (src/lib/verify.ts) deterministically matches each
 * quote against the PDF's extracted page text; confidence is computed there,
 * not reported by the model. An absent detail is simply not emitted — there is
 * no null/"not in document" state to model.
 */

/** A cited claim: a verbatim quote and the page it appears on. */
const CitedShape = {
  evidence_quote: z.string(),
  // The model's *claimed* page. Not constrained to >0: strict tool use can't
  // carry a `minimum` keyword (it's stripped from the wire schema), so the
  // model occasionally emits 0 / an out-of-range page. verify() treats the page
  // as a claim and searches the PDF regardless, so a bad page degrades to
  // wrong-page / not-found instead of a hard parse failure.
  evidence_page: z.number().int(),
};

/** One party to / named entity in the document. */
const Party = z.object({
  name: z.string(),
  /** Freeform role from the document's own language (Buyer, Employer, Employee,
   *  Vendor, Licensor, …); "Other" when not named. */
  role: z.string(),
  ...CitedShape,
});

/** One meaningful, labeled detail the model chose to surface. */
const KeyDetail = z.object({
  /** Short human label, e.g. "Effective date", "Annual salary", "Governing law". */
  label: z.string(),
  /** The extracted value, concise. */
  value: z.string(),
  ...CitedShape,
});

export const DocumentExtractionSchema = z.object({
  /** Model-classified document type, e.g. "Employment Offer Letter", "Mutual NDA", "Invoice". */
  document_type: z.string(),
  /** One- or two-sentence plain-language gist of the document. */
  summary: z.string(),
  parties: z.array(Party),
  key_details: z.array(KeyDetail),
});

export type DocumentExtraction = z.infer<typeof DocumentExtractionSchema>;
export type ContractParty = z.infer<typeof Party>;
export type KeyDetail = z.infer<typeof KeyDetail>;
