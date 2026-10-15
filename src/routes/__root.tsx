import { AuthProvider } from "@/context/AuthContext";
import "../firebase";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { useEffect } from "react";

/**
 * Registers the hand-written service worker in public/sw.js.
 *
 * WHY here: the root route is the one component guaranteed to mount once for
 * every page of the app, whatever the user opens first. Registering from a
 * role dashboard would mean the app is only saved offline for people who
 * happen to reach that page.
 *
 * WHY production only: in `bun run dev` Vite serves modules fresh on every
 * edit, and a worker that caches /assets/* would happily serve yesterday's
 * code back — so changes stop appearing and the cause is invisible. PROD is
 * statically replaced at build time, so this whole block is dropped from the
 * dev bundle rather than merely skipped at runtime.
 *
 * WHY in an effect, not at module scope: this module is also evaluated during
 * SSR, where `navigator` does not exist. An effect only ever runs in the
 * browser.
 */
function useRegisterServiceWorker() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      // A failed registration must never take the app down with it — the app
      // still works online, it just won't be available offline.
      .catch((err) =>
        console.error("Service worker registration failed:", err),
      );
  }, []);
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

// Runs in the page head, before the app's own code loads: someone who opens
// /login while already signed in (the installed app's start page, a bookmark, a
// reload) goes straight to their role's home page instead of sitting on the
// sign-in form. Only a direct load of /login is affected; moving to /login from
// inside the app (sign out, "sign in again") is ordinary navigation and never
// runs this. The role names are the same ones getAuth() accepts, and the
// destination is built from a fixed list, never from stored text.
const SIGNED_IN_REDIRECT = `try{var r=localStorage.getItem("zennith_auth");if(location.pathname==="/login"&&["admin","doctor","nurse","pharmacist","receptionist","patient","super_admin"].indexOf(r)>-1){location.replace("/"+r.replace("_","-"))}}catch(e){}`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Zennith Health Services" },
      { name: "description", content: "Zennith Project" },
      { name: "author", content: "Simbarashe Gandi" },
      { property: "og:title", content: "Zennith Project" },
      { property: "og:description", content: "Zennith Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "" },
      // The browser's address-bar / title-bar colour for the installed app.
      { name: "theme-color", content: "#0F1B3D" },
    ],
    scripts: [{ children: SIGNED_IN_REDIRECT }],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Installability ("Add to Home Screen"): the manifest names the app and
      // lists its icons; all of these files live in public/.
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useRegisterServiceWorker();

  return (
   <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
