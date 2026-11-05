import { contentFileHref } from "../lib/contentFile";
import useSWRMutation from "swr/mutation";
import { client } from "../lib/api";

export function useFileDownload(src: unknown, filename: string) {
  return useSWRMutation(["download-file", src], async () => {
    const href = contentFileHref(src);
    if (!href) throw new Error("This file is unavailable.");
    const blob = await client.getBlob(href, { cache: "no-store" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
