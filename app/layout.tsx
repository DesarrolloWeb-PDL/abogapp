import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Inter (SIL OFL) is self-hosted by next/font and injected as the
 * `--font-inter` variable, which tokens.css consumes as the `--ds-font-sans`
 * family — so the design system stays the single source of truth for type.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Expedientes y plazos",
    template: "%s · Expedientes y plazos",
  },
  description:
    "Gestioná tus expedientes, pruebas y plazos procesales desde un solo lugar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-text">{children}</body>
    </html>
  );
}
