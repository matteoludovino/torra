import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

/** Who is making the request, as the guard loaded it. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
  sandboxId: string | null;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    viewer?: AuthUser | null;
  }
}

export const IS_PUBLIC = "torra:public";

/** The route answers anyone; the signed-in user, if any, is still available through `@Viewer()`. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ANY_ORIGIN = "torra:any-origin";
/**
 * A state-changing route that may be called from anywhere (no Origin check): only for requests that
 * carry their own proof, like a signed one-click unsubscribe link posted by an email client.
 */
export const AnyOrigin = () => SetMetadata(ANY_ORIGIN, true);

/** The signed-in user (on routes that aren't public, there always is one). */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<FastifyRequest>().viewer!,
);

/** The signed-in user or null (public routes). */
export const Viewer = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser | null =>
    context.switchToHttp().getRequest<FastifyRequest>().viewer ?? null,
);
