import { Body, Controller, Get, Patch } from "@nestjs/common";
import { updateAccountInput, type Me } from "@torra/shared";
import type { z } from "zod";
import { CurrentUser, Public, Viewer, type AuthUser } from "../auth/auth-user.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { Profiles } from "./profiles.service.ts";

@Controller()
export class ProfilesController {
  constructor(private readonly profiles: Profiles) {}

  /** Who is signed in, if anyone: what the web app asks on every page (no 401 for visitors). */
  @Public()
  @Get("session")
  async session(@Viewer() viewer: AuthUser | null): Promise<{ me: Me | null }> {
    return { me: viewer ? await this.profiles.me(viewer.id) : null };
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.profiles.me(user.id);
  }

  @Patch("me")
  rename(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateAccountInput)) body: z.infer<typeof updateAccountInput>,
  ): Promise<Me> {
    return this.profiles.rename(user, body.name);
  }
}
