import { mkdir } from "node:fs/promises";
import { expect, test as setup } from "@playwright/test";
import { latestOtp } from "./fixtures/otp";
import { cleanupAllTestData } from "./fixtures/cleanup";
import { createUserCommunityFixture } from "./fixtures/factory";
import { E2E_MEMBER_EMAIL } from "./config";

setup("authenticate", async ({ page }) => {
  setup.setTimeout(30_000);

  await cleanupAllTestData();
  await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL });

  // Ensure no stale tokens trigger refresh loops in the login request.
  await page.context().clearCookies();
  await page.goto("/auth");
  await page.evaluate(() => {
    localStorage.removeItem("afire.preview.session");
  });

  await page.getByPlaceholder("you@example.com").fill(E2E_MEMBER_EMAIL);
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(E2E_MEMBER_EMAIL);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL(/\/auth\/verify.*/);
  await expect(page).toHaveURL(/\/auth\/verify\?email=/, { timeout: 8_000 });
  await expect(page.getByRole("heading", { name: /enter code/i })).toBeVisible({ timeout: 8_000 });

  const otp = await latestOtp(E2E_MEMBER_EMAIL, 30, 300);
  const otpInput = page.getByRole("textbox").first();
  await otpInput.fill("");
  await otpInput.type(otp);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 8_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () => {
          const session = JSON.parse(localStorage.getItem("afire.preview.session") || "null");
          return Boolean(session?.accessToken && session?.refreshToken);
        },
      ),
    )
    .toBe(true);
  await mkdir("tests/e2e/.auth", { recursive: true });
  await page.context().storageState({ path: "tests/e2e/.auth/state.json" });
});
