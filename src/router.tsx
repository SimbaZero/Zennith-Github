import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // The default is true: every time someone switched back to this
        // browser tab, EVERY query on the page re-ran, and several of them
        // download whole collections. Testing all day, that alone ran the
        // free daily database allowance out. Pages still load fresh data
        // when they open, and after any save.
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
