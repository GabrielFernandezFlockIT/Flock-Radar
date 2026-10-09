import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteHeader } from "@/components/app-shell/site-header";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Flock-Radar", template: "%s · Flock-Radar" },
  description:
    "Tablero de dirección que anticipa riesgos de entrega, recuerda el trabajo con evidencia verificable y responde preguntas sobre todas las herramientas de ingeniería del equipo.",
  openGraph: {
    title: "Flock-Radar",
    description:
      "Tablero de dirección que anticipa riesgos de entrega, recuerda el trabajo con evidencia verificable y responde preguntas sobre todas las herramientas de ingeniería del equipo.",
    siteName: "Flock-Radar",
    locale: "es_AR",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </main>
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
