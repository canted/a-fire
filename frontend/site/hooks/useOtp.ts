import { useMutation } from "../lib/swrQuery";
import { useApiClient } from "./useApiClient";

type RequestPayload = { email: string };
type VerifyPayload = { email: string; token: string };
type VerifyResponse = { success: boolean; redirect?: string | null; accessToken?: string; refreshToken?: string };

export function useRequestOtpMutation() {
  const client = useApiClient();

  return useMutation<void, unknown, RequestPayload>({
    mutationFn: ({ email }) => client.post("/v1/auth/request_otp", { email }),
  });
}

export function useVerifyOtpMutation() {
  const client = useApiClient();

  return useMutation<VerifyResponse, unknown, VerifyPayload>({
    mutationFn: async ({ email, token }) => {
      const response = await client.post<VerifyResponse>("/v1/auth/verify_otp", { email, token });
      if (!response.accessToken || !response.refreshToken) throw new Error("Incomplete sign-in response. Please try again.");
      await client.setSession({ accessToken: response.accessToken, refreshToken: response.refreshToken });
      return response;
    },
  });
}
