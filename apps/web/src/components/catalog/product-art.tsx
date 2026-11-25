import type { ReactNode } from "react";

/** Label colours for coffee bags and course covers, picked by the product's slug. */
const LABELS = ["#b45309", "#9a3412", "#3f6212", "#155e75", "#6b21a8", "#9f1239", "#1e3a8a"];

function pick(slug: string): string {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return LABELS[hash % LABELS.length]!;
}

const INK = "#3b2a20";
const STEEL = "#a8a29e";

/** The built-in illustration of a product (decorative: the product's name is always next to it). */
export function ProductArt({ art, slug, className = "" }: { art: string; slug: string; className?: string }) {
  const label = pick(slug);
  return (
    <svg viewBox="0 0 400 300" aria-hidden className={`block h-auto w-full ${className}`}>
      <rect width="400" height="300" fill="#f5efe6" />
      <ellipse cx="200" cy="262" rx="120" ry="12" fill="#e7dccb" />
      {DRAWINGS[art]?.(label) ?? DRAWINGS["bag"]!(label)}
    </svg>
  );
}

const DRAWINGS: Record<string, (label: string) => ReactNode> = {
  bag: (label) => (
    <g>
      <path d="M140 70 L260 70 L272 255 L128 255 Z" fill="#8b6b4a" />
      <path d="M140 70 L260 70 L256 92 L144 92 Z" fill="#6f5238" />
      <rect x="156" y="120" width="88" height="96" rx="6" fill="#faf7f2" />
      <rect x="156" y="120" width="88" height="22" rx="6" fill={label} />
      <circle cx="200" cy="178" r="20" fill="none" stroke={INK} strokeWidth="3" />
      <path d="M200 160 Q190 178 200 196" fill="none" stroke={INK} strokeWidth="3" />
    </g>
  ),
  grinder: () => (
    <g>
      <rect x="165" y="110" width="70" height="145" rx="10" fill={STEEL} />
      <rect x="165" y="110" width="70" height="26" rx="8" fill="#78716c" />
      <path d="M200 110 L200 70 L268 70" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <circle cx="272" cy="70" r="13" fill="#6f5238" />
      <rect x="175" y="190" width="50" height="8" rx="4" fill="#d6d3d1" />
    </g>
  ),
  dripper: (label) => (
    <g>
      <path d="M130 100 L270 100 L232 190 L168 190 Z" fill="#faf7f2" stroke={INK} strokeWidth="4" />
      <path d="M150 120 L250 120 M160 145 L240 145 M170 170 L230 170" stroke="#d6cfc4" strokeWidth="4" />
      <rect x="148" y="190" width="104" height="14" rx="5" fill={label} />
      <path d="M160 206 L240 206 L230 255 L170 255 Z" fill="#e7e5e4" stroke={INK} strokeWidth="4" />
    </g>
  ),
  kettle: () => (
    <g>
      <path d="M140 140 Q140 255 200 255 Q260 255 260 140 Z" fill={STEEL} />
      <rect x="150" y="122" width="100" height="22" rx="8" fill="#78716c" />
      <circle cx="200" cy="114" r="10" fill={INK} />
      <path d="M140 170 Q100 165 88 105" fill="none" stroke={STEEL} strokeWidth="9" strokeLinecap="round" />
      <path d="M260 150 Q300 160 292 215" fill="none" stroke={INK} strokeWidth="10" strokeLinecap="round" />
    </g>
  ),
  scale: (label) => (
    <g>
      <rect x="110" y="190" width="180" height="60" rx="12" fill={INK} />
      <rect x="125" y="178" width="150" height="16" rx="6" fill="#57534e" />
      <rect x="140" y="207" width="70" height="26" rx="4" fill={label} />
      <text x="175" y="226" textAnchor="middle" fontFamily="monospace" fontSize="16" fill="#faf7f2">
        18,0
      </text>
      <circle cx="245" cy="220" r="9" fill="#a8a29e" />
    </g>
  ),
  course: (label) => (
    <g>
      <rect x="110" y="70" width="180" height="125" rx="10" fill={INK} />
      <rect x="122" y="82" width="156" height="101" rx="6" fill={label} />
      <path d="M188 112 L188 154 L222 133 Z" fill="#faf7f2" />
      <rect x="170" y="195" width="60" height="14" fill="#57534e" />
      <rect x="140" y="209" width="120" height="10" rx="5" fill={INK} />
    </g>
  ),
  ebook: (label) => (
    <g>
      <rect x="150" y="60" width="110" height="190" rx="8" fill={INK} />
      <rect x="140" y="64" width="110" height="190" rx="8" fill={label} />
      <rect x="156" y="96" width="78" height="8" rx="4" fill="#faf7f2" />
      <rect x="156" y="112" width="58" height="8" rx="4" fill="#faf7f2" opacity="0.7" />
      <path d="M195 170 L182 220 L208 220 Z" fill="#faf7f2" opacity="0.9" />
      <rect x="186" y="150" width="18" height="22" rx="3" fill="#faf7f2" opacity="0.9" />
    </g>
  ),
};
