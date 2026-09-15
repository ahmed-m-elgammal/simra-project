import { z } from "zod";

export const RequiresSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.object({
      all: z.array(z.object({ var: z.string(), op: z.enum(["==", "!=", "<", "<=", ">", ">="]), value: z.number() })),
    }),
    z.object({
      any: z.array(z.object({ var: z.string(), op: z.enum(["==", "!=", "<", "<=", ">", ">="]), value: z.number() })),
    }),
    z.object({ not: RequiresSchema }),
  ]),
);

export const PersonaEffectSchema = z.object({
  persona_id: z.string().min(1),
  delta: z.record(z.string(), z.number()),
  outcome_text: z.string().min(20).max(2000),
});

export const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().min(1),
  next: z.string().min(1),
  requires: RequiresSchema,
  lock_reason: z.string().min(1),
  persona_effects: PersonaEffectSchema.array().min(1),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: OptionSchema.array().min(2).max(4),
});

export const CanonicalChapterSchema = z.object({
  chapter_id: z.string().min(1),
  order: z.number().int().nonnegative(),
  sourcing: z.object({ mode: z.enum(["extract", "invent"]), quote: z.string() }),
  new_variables: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      type: z.string().min(1),
      range: z.tuple([z.number().nullable(), z.number().nullable()]),
      display: z.enum(["bar", "number", "currency", "percent"]),
      default_value: z.number(),
      distinction_note: z.string().optional(),
    }),
  ),
  decisions: DecisionSchema.array().min(1),
  recap_hints: z.array(z.object({ persona_id: z.string(), hint: z.string() })),
});
