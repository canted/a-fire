import { useState } from "react";
import { AppImagePresentation } from "./AppImagePresentation";
import { imagePresentation } from "../lib/imagePresentation";
import { useMediaSource } from "../hooks/useMediaSource";
import { contentLink } from "../lib/contentLinks";

/** Uploaded document images share the browser/server variant and dimension policy. */
export function AppImage({
  src,
  alt,
  width,
  height,
  tiled = false,
  localPreview,
  interactive = true,
}: {
  interactive?: boolean;
  src: string;
  alt: string;
  width?: number;
  height?: number;
  tiled?: boolean;
  localPreview?: { uri: string };
}) {
  const presentation = imagePresentation({
    src,
    width,
    height,
    purpose: "content",
  });
  const query = useMediaSource(presentation.src);
  const [failedSource, setFailedSource] = useState<string>();
  const failed = failedSource === presentation.src;
  // Only selection adapters supply localPreview; document-provided URLs still
  // pass through the authenticated HTTP source boundary.
  const source = localPreview ?? query.data;
  const ratio =
    presentation.width && presentation.height
      ? presentation.width / presentation.height
      : 1;
  return (
    <AppImagePresentation
      source={source ? { ...source, cache: "reload" } : undefined}
      alt={alt}
      ratio={ratio}
      tiled={tiled}
      failed={
        (!contentLink(src) && !localPreview) || failed || Boolean(query.error)
      }
      onError={() => setFailedSource(presentation.src)}
      retry={
        interactive
          ? () => {
              setFailedSource(undefined);
              void query.mutate();
            }
          : undefined
      }
    />
  );
}
