
type PageSurface = { background?: string; foreground?: string };
const owners = new Map<symbol, PageSurface>();
let saved: { background: string; foreground: string; surface: string; ink: string; theme: HTMLMetaElement; themeContent: string | null; createdTheme: boolean } | undefined;

/** One owner for document, safe-area, app-bar and Safari theme colors. Nested pages override the shell. */
export function registerPageSurface(background?: string, foreground?: string) {
    const root = document.documentElement;
    if (!saved) {
      const computed = getComputedStyle(root);
      const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      const theme = existing ?? document.createElement("meta");
      if (!existing) { theme.name = "theme-color"; document.head.append(theme); }
      saved = {
        background: computed.getPropertyValue("--color-surface").trim(),
        foreground: computed.getPropertyValue("--color-ink").trim(),
        surface: root.style.getPropertyValue("--color-surface"),
        ink: root.style.getPropertyValue("--color-ink"),
        theme, themeContent: theme.getAttribute("content"), createdTheme: !existing,
      };
    }
    const id = Symbol("page-surface");
    owners.set(id, { background, foreground });
    const apply = () => {
      if (!saved) return;
      const custom = [...owners.values()].filter(owner => owner.background || owner.foreground).at(-1);
      root.style.setProperty("--color-surface", custom?.background ?? saved.background);
      root.style.setProperty("--color-ink", custom?.foreground ?? saved.foreground);
      // Resolve CSS token references before handing a literal color to the browser.
      const probe = document.createElement("span");
      probe.style.backgroundColor = custom?.background ?? saved.background;
      document.body.append(probe);
      saved.theme.content = getComputedStyle(probe).backgroundColor;
      probe.remove();
    };
    apply();
    return () => {
      owners.delete(id);
      if (owners.size) { apply(); return; }
      if (!saved) return;
      if (saved.surface) root.style.setProperty("--color-surface", saved.surface);
      else root.style.removeProperty("--color-surface");
      if (saved.ink) root.style.setProperty("--color-ink", saved.ink);
      else root.style.removeProperty("--color-ink");
      if (saved.createdTheme) saved.theme.remove();
      else if (saved.themeContent === null) saved.theme.removeAttribute("content");
      else saved.theme.content = saved.themeContent;
      saved = undefined;
    };
}
