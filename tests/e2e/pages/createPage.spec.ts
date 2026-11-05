import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { faker } from "@faker-js/faker";
import { createUserCommunityFixture } from "../fixtures/factory";
import { E2E_MEMBER_EMAIL } from "../config";
import { factories, prisma } from "../factories";
import { waitForPageContent } from "../utils";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("pages (Playwright)", () => {
  test.use({ storageState: storageStatePath });

  async function openCircleNotes(page: Page, targetRoomId: number) {
    // Room Notes use the shared Note tree and editor.
    await page.goto(`/app/rooms/${targetRoomId}/notes`);
    await expect(createPageButton(page)).toBeVisible();
  }

  function createPageButton(page: Page) {
    return page.getByRole("button", { name: "New note" });
  }

  const pageDoc = (paragraphs: string[]) => ({
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });

  async function expectEditorToHaveActiveFocus(editor: Locator) {
    await expect
      .poll(() => editor.evaluate((root) => root === document.activeElement || root.contains(document.activeElement)))
      .toBe(true);
  }

  async function selectEditorTextRange(page: Page, firstText: string, lastText: string) {
    const editor = page.locator(".ProseMirror[contenteditable=true]").first();
    await editor.focus();
    await editor.evaluate((root, { firstText, lastText }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = []; let node: Node | null;
      while ((node = walker.nextNode())) nodes.push(node as Text);
      const first = nodes.find(node => node.data.includes(firstText));
      const last = nodes.find(node => node.data.includes(lastText));
      if (!first || !last) throw new Error("Selection text not found");
      const range = document.createRange();
      range.setStart(first, first.data.indexOf(firstText));
      range.setEnd(last, last.data.indexOf(lastText) + lastText.length);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }, { firstText, lastText });
  }

  async function expectEditorTextFormats(
    page: Page,
    containerSelector: string,
    text: string,
    formats: Array<"bold" | "highlight">,
  ) {
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ containerSelector, formats, text }) => {
              const container = document.querySelector<HTMLElement>(containerSelector);
              const root =
                container?.querySelector<HTMLElement>(".ProseMirror[contenteditable='true']") ??
                container?.querySelector<HTMLElement>("[contenteditable='true']") ??
                container;
              if (!root) return false;

              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              let node: Text | null = null;
              while ((node = walker.nextNode() as Text | null)) {
                if (!node.data.includes(text)) continue;

                let hasBold = false;
                let hasHighlight = false;
                let element: HTMLElement | null = node.parentElement;
                while (element && root.contains(element)) {
                  const tagName = element.tagName.toLowerCase();
                  if (tagName === "strong" || tagName === "b") {
                    hasBold = true;
                  }
                  if (tagName === "mark") {
                    hasHighlight = true;
                  }

                  const styles = window.getComputedStyle(element);
                  const fontWeight = styles.fontWeight;
                  if (fontWeight === "bold") {
                    hasBold = true;
                  }

                  const numericWeight = Number.parseInt(fontWeight || "0", 10);
                  if (!Number.isNaN(numericWeight) && numericWeight >= 600) {
                    hasBold = true;
                  }

                  const background = styles.backgroundColor;
                  if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") {
                    hasHighlight = true;
                  }

                  element = element.parentElement;
                }

                return (!formats.includes("bold") || hasBold) && (!formats.includes("highlight") || hasHighlight);
              }

              return false;
            },
            { containerSelector, formats, text },
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
  }

  async function openMoveToNotePicker(page: Page, firstText: string, lastText: string, blockCount: number) {
    await selectEditorTextRange(page, firstText, lastText);
    await page.getByRole("button", { name: "Note actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move selected blocks to another Note", exact: true }).click();
    const picker = page.getByRole("dialog", { name: `Move ${blockCount} ${blockCount === 1 ? "block" : "blocks"} to` });
    await expect(picker).toBeVisible();
    return picker;
  }

  test("creates a page from the page tree and persists rich content", async ({ page }) => {
    test.slow();
    test.setTimeout(45_000);

    const fixtureSuffix = faker.string.alphanumeric(8);
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Pages Community ${fixtureSuffix}`,
      boardName: `E2E Pages Board ${fixtureSuffix}`,
      squareName: `E2E Pages Square ${fixtureSuffix}`,
      skipEmailCleanup: true,
    });

    const pageTitle = faker.lorem.words({ min: 2, max: 4 });
    const boldWord = `bold-${faker.lorem.word()}`;
    const bodyText = `${boldWord} ${faker.lorem.words(7)}`;
    const listItems = [faker.lorem.words(2), faker.lorem.words(3), faker.lorem.words(2)];

    await page.goto(`/app/rooms/${fixture.roomId}`);
    await page.waitForURL(new RegExp(`/app/rooms/${fixture.roomId}`));

    await openCircleNotes(page, fixture.roomId);
    const addPageButton = createPageButton(page);
    await expect(addPageButton).toBeVisible();
    await expect(addPageButton).toBeEnabled();
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/v2/notes") && response.request().method() === "POST",
      ),
      addPageButton.click(),
    ]);
    await page.waitForURL(/\/app\/note\/\d+$/, { waitUntil: "commit" });

    const pageIdMatch = page.url().match(/\/app\/note\/(\d+)$/);
    expect(pageIdMatch).not.toBeNull();
    const pageId = pageIdMatch?.[1] ?? "";

    const titleSavePromise = page.waitForResponse(
      (response) => response.url().includes(`/v2/notes/${pageId}`) && response.request().method() === "PATCH",
    );
    await page.getByPlaceholder("Untitled note").fill(pageTitle);
    await titleSavePromise;

    const editorContainerSelector = ".ProseMirror[contenteditable=true]";
    const editorSelector = ".ProseMirror[contenteditable=true]";
    const editor = page.locator(editorSelector).first();
    await page.locator(editorContainerSelector).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type(bodyText);
    await expect(editor).toContainText(boldWord);

    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page.getByRole("menuitem", { name: "Bulleted list", exact: true }).click();
    await expect(editor.locator("ul")).toBeVisible();
    await expectEditorToHaveActiveFocus(editor);

    await page.keyboard.type(listItems[0]);
    await page.keyboard.press("Enter");
    await page.keyboard.type(listItems[1]);
    await page.keyboard.press("Enter");
    await page.keyboard.type(listItems[2]);
    await page.keyboard.press("Enter");
    await expect(editor.locator("li", { hasText: listItems[2] })).toBeVisible();

    await selectEditorTextRange(page, boldWord, boldWord);
    await page.getByRole("button", { name: "Bold" }).click();

    await expectEditorTextFormats(page, editorContainerSelector, boldWord, ["bold"]);

    await selectEditorTextRange(page, boldWord, boldWord);
    await page.getByRole("button", { name: "Highlight" }).click();
    await expect(editor.locator("mark")).toHaveCount(1);
    await expectEditorTextFormats(page, editorContainerSelector, boldWord, ["bold", "highlight"]);
    await waitForPageContent(prisma, Number(pageId), `"type":"bold"`);
    await waitForPageContent(prisma, Number(pageId), `"type":"highlight"`);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByPlaceholder("Untitled note")).toBeVisible();
    const editorReloaded = page.locator(editorSelector).first();
    await expect(editorReloaded).toContainText(boldWord);

    await expect(page.getByPlaceholder("Untitled note")).toHaveValue(pageTitle);

    await expectEditorTextFormats(page, editorContainerSelector, boldWord, ["bold", "highlight"]);
    await expect(editorReloaded.locator("li", { hasText: listItems[0] })).toBeVisible();
    await expect(editorReloaded.locator("li", { hasText: listItems[1] })).toBeVisible();
    await expect(editorReloaded.locator("li", { hasText: listItems[2] })).toBeVisible();
  });

  test("inserts and persists a numbered list through the shared editor toolbar", async ({ page }) => {
    test.slow();

    const fixtureSuffix = faker.string.alphanumeric(8);
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Pages Community ${fixtureSuffix}`,
      boardName: `E2E Pages Board ${fixtureSuffix}`,
      squareName: `E2E Pages Square ${fixtureSuffix}`,
      skipEmailCleanup: true,
    });

    await page.goto(`/app/rooms/${fixture.roomId}`);
    await page.waitForURL(new RegExp(`/app/rooms/${fixture.roomId}`));

    await openCircleNotes(page, fixture.roomId);
    const addPageButton = createPageButton(page);
    await expect(addPageButton).toBeEnabled();
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/v2/notes") && response.request().method() === "POST",
      ),
      addPageButton.click(),
    ]);
    await page.waitForURL(/\/app\/note\/\d+$/, { waitUntil: "commit" });

    const pageIdMatch = page.url().match(/\/app\/note\/(\d+)$/);
    expect(pageIdMatch).not.toBeNull();
    const pageId = pageIdMatch?.[1] ?? "";

    const editorContainerSelector = ".ProseMirror[contenteditable=true]";
    const editorSelector = ".ProseMirror[contenteditable=true]";
    const editor = page.locator(editorSelector).first();
    await page.locator(editorContainerSelector).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type("numbered list coverage");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page.getByRole("menuitem", { name: "Numbered list", exact: true }).click();
    await expect(editor.locator("ol")).toBeVisible();
    await expectEditorToHaveActiveFocus(editor);
    await expect
      .poll(() =>
        editor.evaluate((root) => {
          const children = Array.from(root.children);
          const orderedListIndex = children.findIndex((child) => child.tagName.toLowerCase() === "ol");
          return children
            .slice(0, orderedListIndex)
            .map((child) => `${child.tagName.toLowerCase()}:${child.textContent?.trim() ?? ""}`);
        }),
      )
      .toEqual(["p:numbered list coverage"]);

    await page.keyboard.type("first ordered item");
    await page.keyboard.press("Enter");
    await expect(editor.locator("ol li", { hasText: "first ordered item" })).toBeVisible();
    await waitForPageContent(prisma, Number(pageId), "first ordered item");
  });

  test("moves selected blocks to another page", async ({ page }) => {
    test.slow();

    const fixtureSuffix = faker.string.alphanumeric(8);
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Move Blocks Community ${fixtureSuffix}`,
      boardName: `E2E Move Blocks Board ${fixtureSuffix}`,
      squareName: `E2E Move Blocks Square ${fixtureSuffix}`,
      skipEmailCleanup: true,
    });

    const now = new Date();
    const sourceTitle = `Move source ${faker.string.alphanumeric(6)}`;
    const destinationTitle = `Move destination ${faker.string.alphanumeric(6)}`;
    const sourceKeptText = `kept ${faker.lorem.words(3)}`;
    const movedFirstText = `first moved ${faker.lorem.words(3)}`;
    const movedSecondText = `second moved ${faker.lorem.words(3)}`;
    const destinationExistingText = `destination existing ${faker.lorem.words(3)}`;

    const sourcePage = await factories.page
      .props({
        room_id: () => fixture.roomId,
        title: () => sourceTitle,
        icon: () => "📄",
        created_at: () => now,
        updated_at: () => now,
      })
      .create();
    const destinationPage = await factories.page
      .props({
        room_id: () => fixture.roomId,
        title: () => destinationTitle,
        icon: () => "📄",
        created_at: () => now,
        updated_at: () => now,
      })
      .create();

    await factories.document
      .props({
        docable_type: () => "Note",
        docable_id: () => sourcePage.id,
        content: () => pageDoc([sourceKeptText, movedFirstText, movedSecondText]),
        version: () => 1,
        created_at: () => now,
        updated_at: () => now,
      })
      .create();
    await factories.document
      .props({
        docable_type: () => "Note",
        docable_id: () => destinationPage.id,
        content: () => pageDoc([destinationExistingText]),
        version: () => 1,
        created_at: () => now,
        updated_at: () => now,
      })
      .create();

    await page.goto(`/app/note/${sourcePage.id}`);
    await page.waitForURL(new RegExp(`/app/note/${sourcePage.id}$`));

    const editor = page.locator(".ProseMirror[contenteditable=true]").first();
    await expect(editor).toContainText(sourceKeptText);
    await expect(editor).toContainText(movedFirstText);
    await expect(editor).toContainText(movedSecondText);

    const picker = await openMoveToNotePicker(page, movedFirstText, movedSecondText, 2);
    await expect(picker.getByText(destinationTitle)).toBeVisible();
    await expect(picker.getByRole("button", { name: sourceTitle, exact: true })).toBeDisabled();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v2/notes/${destinationPage.id}/content/blocks`) &&
          response.request().method() === "POST",
      ),
      picker.getByText(destinationTitle).click(),
    ]);

    await expect(editor).toContainText(sourceKeptText);
    await expect(editor).not.toContainText(movedFirstText);
    await expect(editor).not.toContainText(movedSecondText);
    await expect(page.getByText("Blocks moved.")).toBeVisible();

    await page.goto(`/app/note/${destinationPage.id}`);
    await page.waitForURL(new RegExp(`/app/note/${destinationPage.id}$`));

    const destinationEditor = page.locator(".ProseMirror[contenteditable=true]").first();
    await expect(destinationEditor).toContainText(movedFirstText);
    await expect(destinationEditor).toContainText(movedSecondText);
    await expect(destinationEditor).toContainText(destinationExistingText);
    await expect(
      destinationEditor.locator("p").evaluateAll((paragraphs) =>
        paragraphs.map((paragraph) => paragraph.textContent?.trim() ?? "").filter(Boolean).slice(0, 3),
      ),
    ).resolves.toEqual([movedFirstText, movedSecondText, destinationExistingText]);
  });
});
