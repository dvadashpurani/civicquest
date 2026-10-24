import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";

const TABS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: "/me", label: "Hours", icon: "star" },
  { href: "/me/scan", label: "Scan", icon: "round-pushpin" },
  { href: "/me/certificate", label: "Certificate", icon: "classical-building" },
];

/** Bottom tab bar on phones for the Leader pages (design.md responsive rules). */
export function LeaderTabs({ current }: { current: "/me" | "/me/scan" | "/me/certificate" }) {
  return (
    <nav
      aria-label="Leader navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-surface px-2 pb-[calc(0.3rem+env(safe-area-inset-bottom))] pt-1 sm:hidden print:hidden"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={cn(
            "flex min-h-14 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-sm font-bold text-ink",
            tab.href === current && "bg-brand-soft text-brand",
          )}
        >
          <Icon name={tab.icon} alt="" size={24} />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
