import type { Metadata } from "next";
import { Unsubscribe } from "./unsubscribe";

export const metadata: Metadata = { title: "Descadastrar" };

export default function UnsubscribePage() {
  return <Unsubscribe />;
}
