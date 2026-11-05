import { contentFileHref } from "../lib/contentFile";
import useSWRMutation from "swr/mutation";
import {
  cacheDirectory,
  downloadAsync,
  deleteAsync,
  FileSystemSessionType,
} from "expo-file-system/legacy";
import { shareAsync } from "expo-sharing";
import { apiBaseUrl, client } from "../lib/api";

export function useFileDownload(src: unknown, filename: string) {
  return useSWRMutation(["download-file", src], async () => {
    const href = contentFileHref(src);
    if (!href) throw new Error("This file is unavailable.");
    const token = await client.getAccessToken();
    const safeName =
      filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "attachment";
    const path = `${cacheDirectory}share-${Date.now()}-${safeName}`;
    try {
      const result = await downloadAsync(
        new URL(href, new URL(apiBaseUrl).origin).href,
        path,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: false,
          sessionType: FileSystemSessionType.FOREGROUND,
        },
      );
      if (result.status !== 200)
        throw new Error("This file is no longer available.");
      await shareAsync(path, { dialogTitle: filename });
    } finally {
      await deleteAsync(path, { idempotent: true });
    }
  });
}
