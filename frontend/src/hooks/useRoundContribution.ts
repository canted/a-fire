import { useProjectTimeline } from "./useProjectTimeline";
import { useRef } from "react";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { useEntryDraft } from "./useEntryDraft";
import {
  submitRoundArtifact,
  type RoundDetail,
} from "../lib/api/rounds";
import {
  shareProjectEntry,
  type ProjectEntry,
} from "../lib/api/projectEntries";
import { useProjects, useProject } from "./useProjects";
import { client } from "../lib/api";
export function useRoundContribution(
  detail: RoundDetail,
  kind: "cover" | "response" | "submission",
  existing: string,
) {
  const origin =
    kind === "cover"
      ? "round_activity_cover"
      : kind === "response"
        ? "round_activity_response"
        : undefined;
  const {
    draft,
    save,
    publish: publishEntry,
  } = useEntryDraft({
    round: detail.round.id,
    origin,
    existing,
    feedback: detail.round.feedbackRequest,
  });
  const publish = useRoundDraftCompletion(detail.round.id, kind, draft.data?.id, async () => publishEntry.trigger());
  const flight = useRef<Promise<unknown> | null>(null);
  return {
    draft,
    save,
    busy: publish.isMutating,
    submit(persist: () => Promise<unknown>) {
      if (flight.current) return flight.current;
      const request = Promise.resolve()
        .then(persist)
        .then(() => publish.trigger())
        .then(async result => {
          if (kind !== "submission") await draft.mutate(undefined, { revalidate: false });
          return result;
        })
        .finally(() => {
          flight.current = null;
        });
      flight.current = request;
      return request;
    },
  };
}
/** One typed completion boundary: Feedback publishes; phase artifacts stay drafts until release. */
export function useRoundDraftCompletion(
  activity: string | number | undefined,
  kind: "cover" | "response" | "submission",
  post: number | undefined,
  publish: () => Promise<unknown>,
) {
  const { mutate } = useSWRConfig();
  return useSWRMutation(["round-submit", activity, kind, post], async () => {
    if (!post) throw new Error("Draft is not ready.");
    const result = kind === "submission" ? await publish() : await submitRoundArtifact(client, activity!, { kind, entryId: post });
    await Promise.allSettled([
      ...(activity ? [mutate(["activity", String(activity)])] : []),
      mutate(value => Array.isArray(value) && ["board-activities", "board", "room-walls"].includes(String(value[0]))),
    ]);
    return result;
  });
}
export function useRoundProjectEntries(
  project: number | undefined,
  detail: RoundDetail,
  kind: "cover" | "response" | "submission",
) {
  const projects = useProjects();
  const metadata = useProject(project);
  const timeline = useProjectTimeline(String(project ?? ""), Boolean(metadata.data && !metadata.error && !metadata.data.invitation_only && metadata.data.viewer_participation !== "pending"));
  const entries = { ...timeline.query, data: metadata.data ? { entries: timeline.entries } : undefined };
  const share = useSWRMutation(
    ["round-project-copy", detail.round.id],
    (_, { arg }: { arg: ProjectEntry }) => {
      if (!project) throw new Error("Choose a project first.");
      return shareProjectEntry(client, project, arg.id, {
        room_id: Number(detail.round.roomId),
        round_id: Number(detail.round.id),
        request_key: `round-project-${detail.round.id}-${kind}-${project}-${arg.id}`,
        ...(kind === "cover"
          ? { creation_origin: "round_activity_cover" }
          : kind === "response"
            ? { creation_origin: "round_activity_response" }
            : {}),
      });
    },
  );
  return { projects, entries, share, hasMore: timeline.hasMore };
}
