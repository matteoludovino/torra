import { z } from "zod";
import { ZodPipe } from "./zod.pipe.ts";

/** A uuid in the path; anything else is simply something that doesn't exist (404). */
export const uuidParam = (message = "Não encontrado.") => new ZodPipe(z.uuid(), { notFound: message });
