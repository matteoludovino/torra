import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ApiError } from "@torra/shared";
import type { FastifyReply } from "fastify";

const DEFAULT_MESSAGES: Record<number, [string, string]> = {
  400: ["invalid", "Requisição inválida."],
  401: ["unauthenticated", "Entre na sua conta para continuar."],
  403: ["forbidden", "Você não tem acesso a isto."],
  404: ["not_found", "Não encontrado."],
  409: ["conflict", "Isto mudou enquanto você olhava. Atualize e tente de novo."],
  413: ["too_large", "Conteúdo grande demais."],
  429: ["rate_limited", "Muitas tentativas. Espere um pouco."],
};

/**
 * One error shape for the whole API ({ error: { code, message, fields? } }), and nothing internal in a 500:
 * those are logged with their details and answered with a generic message.
 */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors");

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof (exception as { statusCode?: unknown })?.statusCode === "number"
          ? (exception as { statusCode: number }).statusCode
          : HttpStatus.INTERNAL_SERVER_ERROR;

    // Unexpected failures say nothing; a deliberate 503 (a temporary limit, like a full demo) says why.
    const deliberate = exception instanceof HttpException && status === HttpStatus.SERVICE_UNAVAILABLE;
    if (status >= 500 && !deliberate) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
      void reply.status(500).send(body("internal", "Algo deu errado do nosso lado. Tente de novo."));
      return;
    }
    const [fallbackCode, fallbackMessage] = DEFAULT_MESSAGES[status] ?? [
      "error",
      "Não foi possível concluir.",
    ];
    // Ours carry { code, message, fields? }; Nest's own (404 on unknown routes, …) get the defaults.
    const response = exception instanceof HttpException ? exception.getResponse() : null;
    const own =
      typeof response === "object" && response !== null && "code" in response
        ? (response as ApiError["error"])
        : null;
    // Rate limits say how long to wait.
    const retryAfter = (response as { retryAfter?: unknown } | null)?.retryAfter;
    if (typeof retryAfter === "number") void reply.header("Retry-After", String(retryAfter));
    void reply
      .status(status)
      .send(body(own?.code ?? fallbackCode, own?.message ?? fallbackMessage, own?.fields));
  }
}

function body(code: string, message: string, fields?: ApiError["error"]["fields"]): ApiError {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}
