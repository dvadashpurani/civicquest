import Link from "next/link";
import { signOut } from "@/app/auth-actions";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

type NavLink = { readonly href: string; readonly label: string };

type AppHeaderProps = {
  /** Links for this role's area, shown left to right after the brand. */
  links?: readonly NavLink[];
  /** "calm" for adult screens; "sticker" for kid and projector screens. */
  tone?: "calm" | "sticker";
  className?: string;
};

/**
 * The top bar on signed-in screens: brand, the role's links, and sign out.
 * On phones the links wrap under the brand so nothing scrolls sideways.
 */
export function AppHeader({ links = [], tone = "calm", className }: AppHeaderProps) {
  const sticker = tone === "sticker";
  return (
    <header
      className={cn(
        "sticky top-0 z-30 print:hidden",
        sticker
          ? "border-b-[2.5px] border-kid-ink bg-kid-bg"
          : "border-b border-line bg-surface",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <Link
          href="/"
          className={cn(
            "inline-flex min-h-12 items-center gap-2 font-heading text-xl font-extrabold",
            sticker ? "text-kid-ink" : "text-ink",
          )}
        >
          <Icon name="classical-building" alt="" size={28} />
          CivicQuest
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "inline-flex min-h-12 items-center rounded-lg px-3 text-base font-bold",
                sticker ? "text-kid-ink hover:bg-kid-soft" : "text-ink hover:bg-brand-soft",
              )}
            >
              {link.label}
            </Link>
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className={cn(
                "inline-flex min-h-12 items-center rounded-lg px-3 text-base font-bold",
                sticker ? "text-kid-muted hover:bg-kid-soft" : "text-subtle hover:bg-brand-soft",
              )}
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}

export const TEACHER_LINKS: readonly NavLink[] = [
  { href: "/teacher", label: "Today" },
  { href: "/teacher/roadmap", label: "Roadmap" },
];
export const ADMIN_LINKS: readonly NavLink[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/proof-log", label: "Proof log" },
];
export const PARTNER_LINKS: readonly NavLink[] = [{ href: "/partner", label: "Opportunities" }];
export const LEADER_LINKS: readonly NavLink[] = [
  { href: "/me", label: "My hours" },
  { href: "/me/scan", label: "Scan" },
  { href: "/me/certificate", label: "Certificate" },
];
