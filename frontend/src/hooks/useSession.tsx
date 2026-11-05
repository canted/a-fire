import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { SWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import type { Tokens } from "../lib/api/transport";
import { client, onSessionChange } from "../lib/api";
import { sessionStorage } from "../lib/sessionStorage";
import { cable } from "../lib/cable";
import { acceptInvite } from "../lib/api/authInvite";
import { sessionSubject } from "../lib/api/transport";
import { syncAnalyticsIdentity, trackScreen } from "../lib/analytics";
import { sessionReturnPath } from "../lib/roomLinks";

type Session = {
  ready: boolean;
  signedIn: boolean;
  error: string | null;
  epoch: number;
  draftScope: object;
  returnTo?: string;
};
// Expo can remount the root layout during browser Forward. Cache and ephemeral
// drafts belong to the authenticated session, not to a layout instance.
let sessionCache = new Map();
let draftScope = {};
const Context = createContext<Session>({
  ready: false,
  signedIn: false,
  error: null,
  epoch: 0,
  draftScope,
});
export function SessionProvider({ children }: { children: ReactNode }) {
  // This owner survives the private cache/navigator reset. Capture the active
  // destination before that reset can normalize a nested route back to /app.
  const path = usePathname();
  const params = useGlobalSearchParams();
  const destination = useRef('/app');
  if (path.startsWith('/app')) destination.current = sessionReturnPath(path, params);
  // Each mounted SWR provider needs its own registration; a remount copies data
  // rather than racing the previous provider’s global-state cleanup.
  const [cache, setCache] = useState(
    () => (sessionCache = new Map(sessionCache)),
  );
  const [session, setSession] = useState<Session>({
    ready: false,
    signedIn: false,
    error: null,
    epoch: 0,
    draftScope,
  });
  useEffect(() => {
    let active = true;
    const read = async (changed = false, returnTo?: string) => {
      try {
        const stored = await sessionStorage.read();
        if (active) syncAnalyticsIdentity(sessionSubject(stored));
        if (active)
          setSession((previous) => ({
            ready: true,
            signedIn: Boolean(stored),
            error: null,
            epoch: previous.epoch + (changed ? 1 : 0),
            draftScope,
            returnTo,
          }));
      } catch {
        if (active)
          setSession((previous) => ({
            ...previous,
            ready: true,
            error:
              "Could not read your saved session. Restart the app to try again.",
          }));
      }
    };
    const stop = onSessionChange((reset) => {
      const returnTo = reset ? destination.current : undefined;
      if (reset) {
        syncAnalyticsIdentity(null);
        cable.disconnect();
        draftScope = {};
        setCache((sessionCache = new Map()));
      }
      void read(reset, returnTo);
    });
    void read();
    return () => {
      active = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (session.ready && !session.error) trackScreen(path);
  }, [path, session.ready, session.error, session.epoch]);
  return (
    <Context.Provider value={session}>
      <SWRConfig
        key={session.epoch}
        value={{
          provider: () => cache,
          shouldRetryOnError: false,
          isVisible: () =>
            AppState.currentState === "active" || AppState.currentState == null,
          initFocus(callback) {
            const subscription = AppState.addEventListener(
              "change",
              (state) => {
                if (state === "active") callback();
              },
            );
            return () => subscription.remove();
          },
        }}
      >
        {children}
      </SWRConfig>
    </Context.Provider>
  );
}
export function useSession() {
  return useContext(Context);
}
export function useAuthentication() {
  const request = useSWRMutation(
    "request-otp",
    (_, { arg }: { arg: { email: string } }) =>
      client.post<void>("/v1/auth/request_otp", arg),
  );
  const verify = useSWRMutation(
    "verify-otp",
    async (_, { arg }: { arg: { email: string; token: string } }) => {
      const tokens = await client.post<Tokens>("/v1/auth/verify_otp", arg);
      if (!tokens.accessToken || !tokens.refreshToken)
        throw new Error("Sign-in failed. Please try again.");
      await client.setSession(tokens);
    },
  );
  const logout = useSWRMutation("logout", () => client.setSession(null));
  const invite = useSWRMutation(
    "accept-invite",
    async (_, { arg }: { arg: string }) => {
      const result = await acceptInvite(client, arg);
      if (!result.success || !result.accessToken || !result.refreshToken)
        throw new Error("Could not accept this invitation. Please try again.");
      await client.setSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      return result;
    },
  );
  return { request, verify, logout, invite };
}
