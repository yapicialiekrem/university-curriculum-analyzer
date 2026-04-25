"use client";

/**
 * TopBar — Site genelinde tek navigasyon. Logo + ana sayfa / derin analiz
 * link'i + slug query'si korunarak geçiş.
 */

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopBar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--color-paper)]/85 border-b"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="px-6 sm:px-10 max-w-[1440px] mx-auto flex items-center justify-between h-14">
        <Link
          href={`/${suffix}`}
          className="flex items-center gap-2 group"
        >
          <span
            aria-hidden
            className="font-serif italic text-2xl leading-none"
            style={{ color: "var(--color-uni-b)" }}
          >
            U
          </span>
          <span className="font-serif font-medium text-lg tracking-tight">
            UniCurriculum
          </span>
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <NavLink href={`/${suffix}`} active={pathname === "/"}>
            Yan yana gör
          </NavLink>
          <NavLink
            href={`/deep-analysis${suffix}`}
            active={pathname?.startsWith("/deep-analysis") || false}
          >
            Derin Analiz
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`relative pb-1 transition-colors ${
        active
          ? "text-[color:var(--color-ink-900)] font-medium"
          : "text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-700)]"
      }`}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute -bottom-px left-0 right-0 h-px bg-[color:var(--color-ink-900)]"
        />
      )}
    </Link>
  );
}
