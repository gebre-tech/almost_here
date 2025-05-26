import 'react-native-get-random-values';
import React from "react";
import { AuthProvider } from "../context/AuthContext"; // Import AuthProvider
import Authenticated from "./authenticated"; // Corrected typo from "Auhthenticated"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2, // Retry failed queries twice
      staleTime: 5 * 60 * 1000, // Data is fresh for 5 minutes
    },
  },
});

const Layout = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Authenticated />
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default Layout;