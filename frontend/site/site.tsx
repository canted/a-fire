import React from "react";
import ReactDOM from "react-dom/client";
import { StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import { RouterProvider } from "react-router-dom";
import { SWRConfig } from "swr";
import { PostHogErrorBoundary, PostHogProvider } from "@posthog/react";
import { StaticErrorPage } from "./features/errors/StaticErrorPage";
import { initPosthog } from "./lib/posthog";
import { router } from "./routes/router";
import { apiClient } from "./lib/api/client";
import { registerPrivateMediaCache } from "../src/lib/privateMediaCache";
import { muiTheme } from "./styles/muiTheme";
import "./styles/index.css";

const posthog = initPosthog();
void registerPrivateMediaCache();

ReactDOM.createRoot(document.getElementById("site-root") as HTMLElement).render(
  <React.StrictMode>
    <PostHogProvider client={posthog}>
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={muiTheme}>
          <PostHogErrorBoundary
            fallback={
              <StaticErrorPage
                statusCode={500}
                title="Something went wrong"
                message="Reload the app and try again."
              />
            }
          >
            <SWRConfig
              value={{
                fetcher: (key: unknown) => {
                  const path = Array.isArray(key) ? String(key[0]) : String(key);
                  return apiClient.get(path);
                },
                revalidateOnFocus: false,
                revalidateOnReconnect: false,
                revalidateIfStale: false,
              }}
            >
              <RouterProvider router={router} />
            </SWRConfig>
          </PostHogErrorBoundary>
        </ThemeProvider>
      </StyledEngineProvider>
    </PostHogProvider>
  </React.StrictMode>,
);
