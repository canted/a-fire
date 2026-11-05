import { useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  fetchMemberships,
  identityFormData,
  membershipFormData,
  updateIdentityRecord,
  updateMembershipRecord,
  disableMembership,
  enableMembership,
  type IdentityFields,
  type MembershipFields,
} from "../lib/api/profile";
import { assertImageFile } from "../lib/imageFile";
import { appendPickedFile } from "../lib/chatFiles";
import type { ChatAttachment } from "../lib/chatComposition";
import { client } from "../lib/api";

type ProfileAction =
  | { kind: "identity"; fields: IdentityFields; avatar?: ChatAttachment }
  | {
      kind: "membership";
      id: number;
      fields: MembershipFields;
      avatar?: ChatAttachment;
    }
  | { kind: "disable" | "enable"; id: number };
export function useProfiles() {
  const query = useSWR("memberships", () => fetchMemberships(client));
  const { mutate } = useSWRConfig();
  const flight = useRef<Promise<void> | null>(null);
  const mutation = useSWRMutation(
    "profile-update",
    async (_, { arg }: { arg: ProfileAction }) => {
      if (arg.kind === "identity" || arg.kind === "membership") {
        const form =
          arg.kind === "identity"
            ? identityFormData(arg.fields)
            : membershipFormData(arg.fields);
        if (arg.avatar) {
          assertImageFile(arg.avatar);
          appendPickedFile(
            form,
            arg.kind === "identity" ? "profile[avatar]" : "membership[avatar]",
            arg.avatar,
          );
        }
        if (arg.kind === "identity") await updateIdentityRecord(client, form);
        else await updateMembershipRecord(client, arg.id, form);
      } else if (arg.kind === "disable")
        await disableMembership(client, arg.id);
      else await enableMembership(client, arg.id);
      // Identity and membership changes affect retained Rooms and private content.
      // Revalidate through SWR rather than copying representations into each owner.
      await query.mutate();
      void mutate(
        (key) => key !== "memberships" && key !== "profile-update",
      ).catch(() => {});
    },
  );
  return {
    query,
    busy: mutation.isMutating,
    submit(action: ProfileAction) {
      if (flight.current)
        return Promise.reject(
          new Error("Wait for the current profile change to finish."),
        );
      const pending = mutation
        .trigger(action)
        .then(() => {})
        .finally(() => {
          flight.current = null;
        });
      flight.current = pending;
      return pending;
    },
  };
}
