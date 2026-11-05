import { revalidateProjectLists } from "./projectListCache";
import { randomUuid } from "../lib/randomId";
import { useRef } from "react";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  createProjectRecord,
  updateProjectRecord,
  projectFields,
  type ProjectFields,
  type ProjectSummary,
} from "../lib/api/projects";
import { assertImageFile } from "../lib/imageFile";
import { appendPickedFile } from "../lib/chatFiles";
import type { ChatAttachment } from "../lib/chatComposition";
import { client } from "../lib/api";

export function useProjectCreation(projectId?: string, creationRequest?: string) {
  const { mutate, cache } = useSWRConfig();
  const requestKey = useRef(randomUuid());
  const flight = useRef<Promise<ProjectSummary> | null>(null);
  const creation = useSWRMutation(
    ["project-form", projectId],
    async (
      _,
      { arg }: { arg: ProjectFields & { banner?: ChatAttachment } },
    ) => {
      const form = projectFields({ ...arg, ...(!projectId ? { requestKey: creationRequest ?? requestKey.current } : {}) });
      if (arg.banner) {
        assertImageFile(arg.banner);
        appendPickedFile(form, "project[banner]", arg.banner);
      }
      const project = await (projectId
        ? updateProjectRecord(client, projectId, form)
        : createProjectRecord(client, form));
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(
        (key) =>
          key === "projects" ||
          (Array.isArray(key) &&
            (key[0] === "home" ||
              (key[0] === "project" && String(key[1]) === projectId))),
      ).catch(() => {});
      return project;
    },
  );
  return {
    ...creation,
    submit(input: ProjectFields & { banner?: ChatAttachment }) {
      if (flight.current) return flight.current;
      const pending = creation.trigger(input).finally(() => {
        flight.current = null;
      });
      flight.current = pending;
      return pending;
    },
  };
}
