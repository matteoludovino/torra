import type { AdminScope } from "@torra/shared";
import type { AuthUser } from "../auth/auth-user.ts";
import { adminOnly } from "../auth/admin.ts";

/**
 * What an admin may see and change. The store's own admins (no sandbox) run the real store: every
 * customer's orders, the shared catalog, the shared stock. A demo's admin runs only that demo: its
 * customers' orders, its own products and coupons, its copy of the stock. Never another corner.
 */
export interface Admin {
  user: AuthUser;
  scope: AdminScope;
  /** The demo's sandbox, or null for the store. */
  sandboxId: string | null;
}

export function asAdmin(user: AuthUser): Admin {
  adminOnly(user);
  return { user, scope: user.sandboxId ? "demo" : "store", sandboxId: user.sandboxId };
}

/** Orders an admin sees: all of them for the store, the demo's own for a demo. */
export function ordersOf(admin: Admin) {
  return admin.sandboxId ? { sandboxId: admin.sandboxId } : {};
}

/** Catalog rows an admin may change (products, variants, coupons): their own corner's only. */
export function ownedBy(admin: Admin) {
  return { sandboxId: admin.sandboxId };
}
