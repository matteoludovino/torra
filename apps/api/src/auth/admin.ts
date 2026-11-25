import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "./auth-user.ts";

/** Admin routes: everyone else gets a 403. (An admin acts only within their own sandbox: see callers.) */
export function adminOnly(user: AuthUser): void {
  if (user.role !== "admin")
    throw new ForbiddenException({ code: "admins_only", message: "Só administradores." });
}
