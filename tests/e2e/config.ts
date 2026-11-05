export const E2E_MEMBER_EMAIL = "member@example.com";

// Expo serves the app separately from the API; browser API checks must use its origin.
export const E2E_API_ORIGIN = process.env.TEST_API_ORIGIN ?? `http://127.0.0.1:${process.env.TEST_API_PORT ?? "4100"}`;
