import { Inject, Injectable, Logger } from "@nestjs/common";
import { UFS, formatCep, type Address, type Uf } from "@torra/shared";
import { ENV, type Env } from "../env.ts";

const TIMEOUT_MS = 3000;
const CACHE_SIZE = 1000;

export type Lookup = { found: true; address: Address } | { found: false } | { unavailable: true };

/**
 * A CEP's address, from ViaCEP (the public postal directory): fills in the checkout form and tells
 * shipping the state. Answers are cached (a CEP's address doesn't change); a slow or failing directory is
 * "unavailable", and checkout falls back to typing the state by hand.
 */
@Injectable()
export class AddressLookup {
  private readonly logger = new Logger("AddressLookup");
  private readonly cache = new Map<string, Address | null>();
  /** Swappable in tests. */
  fetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async lookup(cep: string): Promise<Lookup> {
    if (this.cache.has(cep)) {
      const cached = this.cache.get(cep)!;
      return cached ? { found: true, address: cached } : { found: false };
    }
    let body: Record<string, unknown>;
    try {
      const response = await this.fetch(`${this.env.VIACEP_URL}/${cep}/json/`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 400) return this.remember(cep, null);
      if (!response.ok) throw new Error(`status ${response.status}`);
      body = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(`CEP lookup failed: ${error instanceof Error ? error.message : error}`);
      return { unavailable: true };
    }
    const uf = String(body["uf"] ?? "");
    if (body["erro"] || !(UFS as readonly string[]).includes(uf)) return this.remember(cep, null);
    return this.remember(cep, {
      cep: formatCep(cep),
      street: String(body["logradouro"] ?? ""),
      district: String(body["bairro"] ?? ""),
      city: String(body["localidade"] ?? ""),
      uf: uf as Uf,
    });
  }

  private remember(cep: string, address: Address | null): Lookup {
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cep, address);
    return address ? { found: true, address } : { found: false };
  }
}
