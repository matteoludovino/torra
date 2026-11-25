import type { Metadata } from "next";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = { title: "Confirmar e-mail" };

export default function VerifyPage() {
  return <VerifyEmail />;
}
