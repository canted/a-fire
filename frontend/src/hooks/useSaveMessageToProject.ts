import { useRef, useState } from "react";
import { useProjectCreation } from "./useProjectCreation";
import { useChatSave, useChatSaveFeedback } from "./useChatActions";
import { useDraftNavigation } from "./useDraftNavigation";
import type { ProjectSummary } from "../lib/api/projects";

/** Retains a created destination across retries of the message-copy step. */
export function useSaveMessageToProject({ roomId, messageId, request, name, leave }: {
  roomId: string; messageId: string; request?: string; name: string; leave: () => void;
}) {
  const action = useChatSave(messageId);
  const creation = useProjectCreation(undefined, request);
  const [createdProject, setCreatedProject] = useState<ProjectSummary>();
  const pending = useRef(false);
  const [working, setWorking] = useState(false);
  const busy = working || action.save.isMutating || creation.isMutating;
  const feedback = useChatSaveFeedback(roomId);
  const [error, setError] = useState<string>();
  const guard = useDraftNavigation({
    dirty: false,
    busy,
    busyMessage: "Please wait for this message to finish saving.",
    save: async () => {},
    onError: setError,
  });
  async function save(project?: ProjectSummary) {
    if (pending.current || (!project && !request)) return;
    pending.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const destination = project ?? createdProject ?? await creation.submit({ name: name.trim() || "Untitled" });
      if (!project) setCreatedProject(destination);
      await action.submit(destination.id);
      await feedback.mutate(`Saved to ${destination.name}.`, { revalidate: false });
      guard.release();
      leave();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this message. Please try again.");
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }
  return { action, creation, createdProject, busy, error, save };
}
