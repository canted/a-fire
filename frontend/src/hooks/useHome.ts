import useSWR from "swr";
import { fetchHome } from "../lib/api/home";
import { client } from "../lib/api";
export function useHome() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useSWR(["home", timezone], () => fetchHome(client, timezone), {
    refreshInterval: 30000,
  });
}
