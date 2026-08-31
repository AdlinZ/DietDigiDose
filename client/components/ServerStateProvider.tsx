import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function ServerStateProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
