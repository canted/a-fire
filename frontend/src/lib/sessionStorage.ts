import * as SecureStore from "expo-secure-store";
import type { SessionStorage, Tokens } from "./api/transport";
const key = "afire.preview.session";
export const sessionStorage: SessionStorage = {
  async read() {
    const value = await SecureStore.getItemAsync(key);
    return value ? (JSON.parse(value) as Tokens) : null;
  },
  async write(tokens) {
    if (tokens) await SecureStore.setItemAsync(key, JSON.stringify(tokens));
    else await SecureStore.deleteItemAsync(key);
  },
};
