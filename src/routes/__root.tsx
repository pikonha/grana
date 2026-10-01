import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  Outlet,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { getSessionFn } from "#/server/session";
import appCss from "../styles.css?url";
type Session = Awaited<ReturnType<typeof getSessionFn>>;
export interface RouterContext {
  queryClient: QueryClient;
  session?: Session;
}
const SERVICE_WORKER_SCRIPT = `if('serviceWorker'in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(error){console.error('Service worker registration failed:',error)})})}`;
const SITE_URL = "https://grana.up.railway.app";
const APP_TITLE = "Finances";
const APP_DESCRIPTION = "Controle pessoal de contas, transações, faturas e recorrências.";
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => ({ session: await getSessionFn() }),
  notFoundComponent: () => (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="mt-2">A página que você procura não existe.</p>
    </div>
  ),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_TITLE },
      { name: "description", content: APP_DESCRIPTION },
      { name: "theme-color", content: "#ffdb00" },
      { name: "application-name", content: APP_TITLE },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:title", content: APP_TITLE },
      { property: "og:description", content: APP_DESCRIPTION },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:image:secure_url", content: OG_IMAGE_URL },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Finances dashboard preview" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: APP_TITLE },
      { name: "twitter:description", content: APP_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE_URL },
      { name: "twitter:image:alt", content: "Finances dashboard preview" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icons/icon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      {
        rel: "apple-touch-icon",
        href: "/icons/apple-touch-icon-180.png",
      },
    ],
  }),
  component: Outlet,
  shellComponent: RootDocument,
});
function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
        <Scripts />
        {import.meta.env.PROD && (
          <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER_SCRIPT }} />
        )}
      </body>
    </html>
  );
}
