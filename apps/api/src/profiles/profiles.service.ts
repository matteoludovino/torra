import { Injectable } from "@nestjs/common";
import type { Me } from "@torra/shared";
import type { AuthUser } from "../auth/auth-user.ts";
import { PrismaService } from "../prisma/prisma.service.ts";

/** The signed-in account, as its owner sees it. */
@Injectable()
export class Profiles {
  constructor(private readonly db: PrismaService) {}

  async me(userId: string): Promise<Me> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { sandbox: true } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      demo: user.sandbox?.expiresAt != null,
    };
  }

  async rename(user: AuthUser, name: string): Promise<Me> {
    await this.db.user.update({ where: { id: user.id }, data: { name } });
    return this.me(user.id);
  }
}
