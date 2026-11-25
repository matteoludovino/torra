import { BadRequestException, NotFoundException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/**
 * Validates (and converts) a request part with a Zod schema from the shared package, so the API and the
 * web app check the same rules. Usage: `@Body(new ZodPipe(schema)) body: z.infer<typeof schema>`.
 * The error names each problem by its path, without echoing the values back. For ids in the path, pass
 * `notFound`: a malformed id is simply something that doesn't exist.
 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(
    private readonly schema: T,
    private readonly options: { notFound?: string } = {},
  ) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    if (this.options.notFound) {
      throw new NotFoundException({ code: "not_found", message: this.options.notFound });
    }
    throw new BadRequestException({
      code: "invalid",
      message: "Dados inválidos.",
      fields: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), problem: issue.code })),
    });
  }
}
