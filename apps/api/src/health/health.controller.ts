import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth-user.ts";
import { API_VERSION, type HealthResponse } from "@torra/shared";

@Controller("health")
export class HealthController {
  // No database query: the landing page calls this to wake the instance up, and the platform's health
  // check must not fail because the database is momentarily slow.
  @Public()
  @Get()
  health(): HealthResponse {
    return { status: "ok", version: API_VERSION };
  }
}
