import { formatBRL, type ProductSummary } from "@torra/shared";
import Link from "next/link";
import { ProductArt } from "./product-art";

/** A product in a grid: picture, name, price, and what's special about it. */
export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <article className="group relative grid content-start overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow-md">
      <div className="relative">
        <ProductArt art={product.art} slug={product.slug} />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {product.kind === "digital" ? <Badge tone="info">Digital</Badge> : null}
          {product.soldOut ? <Badge tone="muted">Esgotado</Badge> : null}
        </div>
      </div>
      <div className="grid gap-1 p-4">
        <h3 className="font-semibold text-stone-900">
          <Link
            href={`/produto/${product.slug}`}
            className="after:absolute after:inset-0 group-hover:text-brand-800"
          >
            {product.title}
          </Link>
        </h3>
        <p className="line-clamp-2 text-sm text-stone-600">{product.subtitle}</p>
        <p className="mt-1 text-sm">
          {product.priceVaries ? <span className="text-stone-500">a partir de </span> : null}
          <span className="font-semibold text-stone-900">{formatBRL(product.priceFromCents)}</span>
        </p>
      </div>
    </article>
  );
}

export function Badge({ tone, children }: { tone: "info" | "muted" | "warn"; children: string }) {
  const tones = {
    info: "bg-sky-100 text-sky-900",
    muted: "bg-stone-800/80 text-white",
    warn: "bg-amber-100 text-amber-900",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
