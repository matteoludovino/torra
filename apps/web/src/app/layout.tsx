import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { DemoBanner } from "@/components/demo-banner";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Torra · Cafés especiais", template: "%s · Torra" },
  description:
    "Cafés especiais torrados na semana, utensílios de preparo e cursos para fazer um café melhor em casa.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen">
        <Providers>
          <SiteHeader />
          <DemoBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
