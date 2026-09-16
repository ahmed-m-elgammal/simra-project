import type { Db } from "./db.ts";

export interface FlagContext {
  db: Pick<Db, "getFlags">;
  env: Readonly<Record<string, string | undefined>>;
}

export async function paymentsEnabled(ctx: FlagContext): Promise<boolean> {
  const flags = await ctx.db.getFlags();
  const override = flags.payments_enabled;
  if (typeof override === "boolean") return override;
  return ctx.env.PAYMENTS_ENABLED === "true";
}
