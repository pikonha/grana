import { Link, useRouter } from "@tanstack/react-router";
import { LogOut, Menu, WalletCards } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { Button } from "./ui/button";

const NAV_LINKS = [
  { to: "/", label: "Painel" },
  { to: "/transactions", label: "Transações" },
  { to: "/accounts", label: "Contas" },
  { to: "/faturas", label: "Faturas" },
  { to: "/report", label: "Relatórios" },
] as const;

export default function Header() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-foreground bg-background">
      <nav className="page-wrap flex min-h-14 items-center gap-3 py-2 sm:gap-5">
        {session?.user && (
          // ponytail: native <details> is the whole mobile menu — no state, no outside-click listener.
          <details className="relative sm:hidden">
            <summary
              className="flex size-10 cursor-pointer list-none items-center justify-center border-2 border-foreground bg-background [&::-webkit-details-marker]:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="size-5" />
            </summary>
            <div
              className="absolute left-0 top-full z-50 mt-2 flex w-52 flex-col border-2 border-foreground bg-background p-1 brutal-shadow"
              onClick={(event) =>
                event.currentTarget
                  .closest("details")
                  ?.removeAttribute("open")
              }
            >
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="nav-link px-3 py-3 text-sm"
                  activeProps={{ className: "nav-link is-active px-3 py-3 text-sm" }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </details>
        )}
        <Link
          to="/"
          className="display-title flex shrink-0 items-center gap-2 border-2 border-foreground bg-primary px-2 py-1 text-primary-foreground no-underline brutal-shadow"
        >
          <WalletCards className="size-5" /> Grana
        </Link>
        {session?.user && (
          <div className="hidden flex-1 items-center gap-4 whitespace-nowrap text-sm font-medium sm:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="nav-link"
                activeProps={{ className: "nav-link is-active" }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {session?.user && (
            <>
              <span className="hidden text-xs text-muted-foreground md:inline">
                {session.user.email}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sair"
                onClick={async () => {
                  await authClient.signOut();
                  await router.invalidate();
                  await router.navigate({ to: "/login" });
                }}
              >
                <LogOut className="size-4" />
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
