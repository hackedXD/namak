// Request validation (design §5.3): validate + coerce with zod, and REJECT
// unknown parameters (.strict()) rather than ignore them.
import { z } from 'zod';

export const ladderQuery = z
  .object({
    formulation: z.coerce.number().int().positive().optional(),
    product: z.string().min(1).optional(),
    quantity: z.coerce.number().int().positive().max(1000).default(30),
    pincode: z
      .string()
      .regex(/^\d{6}$/, 'pincode must be 6 digits')
      .optional(),
    quoted: z.coerce.number().positive().optional(),
  })
  .strict()
  .refine((v) => v.formulation !== undefined || v.product !== undefined, {
    message: 'either `formulation` or `product` is required',
  });

export type LadderQuery = z.infer<typeof ladderQuery>;

export const searchQuery = z
  .object({
    q: z.string().min(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
  })
  .strict();

/** Flatten a ZodError into { field: message } for the 400 envelope. */
export function zodFields(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    out[key] = issue.message;
  }
  return out;
}
