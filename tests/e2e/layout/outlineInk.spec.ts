import { expect, test } from "@playwright/test";

// Exercise the shared variant on a production form with synthetic API data.
test("outline ink borders remain opaque at rest, hover and keyboard focus", async ({ page }, info) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" }));
  });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ json: path.endsWith("/memberships")
      ? { user: { id: 1, username: "Rowan", avatar_url: null }, memberships: [] }
      : path.endsWith("/unseen/count") ? { total: 0, entries: 0, replies: 0 } : {} });
  });
  await page.goto("/app/projects/new");
  const button = page.getByRole("button", { name: "Choose banner", exact: true });
  await expect(button).toBeVisible();
  const read = () => button.evaluate(element => {
    const css = getComputedStyle(element);
    const surface = [element, ...element.querySelectorAll("div")].map(node => getComputedStyle(node)).find(style => style.borderTopWidth === "1px" && style.borderTopStyle === "solid");
    if (!surface) throw new Error("Outline button must have a bordered visual surface");
    return { border: surface.borderTopColor, color: getComputedStyle(element.querySelector('[dir="auto"]')!).color, opacity: css.opacity,
      style: surface.borderTopStyle, width: surface.borderTopWidth,
      outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth,
      outlineOffset: css.outlineOffset, focused: element.matches(":focus-visible") };
  });
  const states = [];
  for (const state of ["rest", "hover", "focus"] as const) {
    if (state === "hover") await button.hover();
    if (state === "focus") {
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab");
      await button.focus();
      await expect(button).toBeFocused();
    }
    await expect.poll(async () => (await read()).border).toBe("rgb(26, 37, 39)");
    const geometry = await read();
    expect(geometry.color).toBe("rgb(26, 37, 39)");
    expect(geometry.opacity).toBe("1");
    expect(geometry.style).toBe("solid");
    expect(geometry.width).toBe("1px");
    if (state === "focus") {
      expect(geometry.focused).toBe(true);
      expect(geometry.outlineStyle).toBe("solid");
      expect(parseFloat(geometry.outlineWidth)).toBeGreaterThan(0);
      expect(parseFloat(geometry.outlineOffset)).toBeGreaterThan(0);
    }
    states.push({ state, ...geometry });
  }
  await info.attach("opaque outline states", { body: JSON.stringify(states, null, 2), contentType: "application/json" });
});
