import { z } from "zod";

/** Who a one-click demo visitor can be: a customer, or the admin of that demo's own corner of the store. */
export const DEMO_PERSONAS = ["customer", "admin"] as const;
export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export const DEMO_PERSONA_LABELS: Record<DemoPersona, { label: string; description: string }> = {
  customer: {
    label: "Cliente",
    description:
      "Pedidos já pagos com o Stripe de teste, um aguardando pagamento e o carrinho para continuar.",
  },
  admin: {
    label: "Admin",
    description: "Envie, reembolse e cadastre produtos e cupons: só nesta demonstração, nunca na loja real.",
  },
};

export const demoInput = z.object({ persona: z.enum(DEMO_PERSONAS) });

/** An email the demo's people got: kept for the visitor to read, never sent. */
export interface DemoEmail {
  id: string;
  to: string;
  subject: string;
  text: string;
  createdAt: string;
}

/** Whether the demo's starting story (its orders) is in place yet: it's written in the background. */
export interface DemoStatus {
  ready: boolean;
}
