import type { Metadata } from "next";
import { CartScreen } from "./cart-screen";

export const metadata: Metadata = { title: "Carrinho" };

export default function CartPage() {
  return <CartScreen />;
}
