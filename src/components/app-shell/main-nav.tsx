"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Portafolio" },
  { href: "/ask", label: "Preguntar" },
  { href: "/admin", label: "Administración" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLinks({
  pathname,
  className,
}: {
  pathname: string | null;
  className?: string;
}) {
  return (
    <nav
      aria-label="Principal"
      className={cn("flex items-center gap-1 overflow-x-auto text-sm", className)}
    >
      {NAV_ITEMS.map(({ href, label }) => {
        const active = pathname !== null && isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function ActiveNavLinks({ className }: { className?: string }) {
  return <NavLinks pathname={usePathname()} className={className} />;
}

/**
 * The active item depends on the URL, which is only known at request time on
 * dynamic routes. The Suspense boundary lets the shell prerender with no item
 * highlighted; the highlight streams in (Cache Components).
 */
export function MainNav({ className }: { className?: string }) {
  return (
    <Suspense fallback={<NavLinks pathname={null} className={className} />}>
      <ActiveNavLinks className={className} />
    </Suspense>
  );
}
