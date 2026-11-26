import type { Metadata } from "next";
import { CheckoutScreen } from "./checkout-screen";

export const metadata: Metadata = { title: "Finalizar compra" };

export default function CheckoutPage() {
  return <CheckoutScreen />;
}
