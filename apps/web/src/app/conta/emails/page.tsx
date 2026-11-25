import type { Metadata } from "next";
import { EmailPreferencesForm } from "./email-preferences";

export const metadata: Metadata = { title: "Preferências de e-mail" };

export default function EmailPreferencesPage() {
  return <EmailPreferencesForm />;
}
