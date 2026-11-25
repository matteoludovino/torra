import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RateLimiter } from "../common/rate-limiter.ts";
import { ENV, type Env } from "../env.ts";
import { ANY_ORIGIN, IS_PUBLIC } from "./auth-user.ts";
import { Sessions } from "./sessions.service.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Anything that changes state must come from the web app itself: browsers always send Origin on those
 * requests, so a page elsewhere can't use the visitor's cookie (on top of SameSite=Lax).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ANY_ORIGIN, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if (this.env.WEB_ORIGINS.includes(request.headers.origin ?? "")) return true;
    throw new ForbiddenException({ code: "forbidden_origin", message: "Origem não permitida." });
  }
}

/**
 * Loads the signed-in user on every request (public routes can still tell who is looking) and turns
 * away anonymous requests unless the route is marked `@Public()`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: Sessions,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    request.viewer = await this.sessions.resolve(request, http.getResponse<FastifyReply>());
    if (request.viewer) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    throw new UnauthorizedException();
  }
}

/** Writes per sandbox (one customer, or one demo and all its personas) per minute. */
export const SANDBOX_WRITES = { max: 60, windowMs: 60_000 };

/**
 * Runs after the session guard: a customer's state-changing requests count against their sandbox's
 * per-minute budget. Shopping needs far fewer; scripting the API hits the limit.
 */
@Injectable()
export class SandboxWriteLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const sandboxId = request.viewer?.sandboxId;
    if (sandboxId && !SAFE_METHODS.has(request.method))
      this.limiter.hit(`sandbox:writes:${sandboxId}`, SANDBOX_WRITES);
    return true;
  }
}
