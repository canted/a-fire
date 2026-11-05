export type VisualViewportState = {
  height: number;
  offsetTop: number;
  keyboardInset: number;
  keyboardOpen: boolean;
};

export function getVisualViewportState(): VisualViewportState {
  if (typeof window === "undefined") {
    return {
      height: 0,
      offsetTop: 0,
      keyboardInset: 0,
      keyboardOpen: false,
    };
  }

  const innerHeight = window.innerHeight;
  const viewport = window.visualViewport;

  if (!viewport) {
    return {
      height: innerHeight,
      offsetTop: 0,
      keyboardInset: 0,
      keyboardOpen: false,
    };
  }

  const viewportHeight = viewport.height > 0 ? viewport.height : innerHeight;
  const keyboardInset = Math.max(0, innerHeight - viewportHeight);

  const focused = document.activeElement;
  const editableFocused = focused instanceof HTMLElement && !focused.closest("[inert], [hidden]") && (
    focused.isContentEditable || focused.closest('[contenteditable="true"]') !== null ||
    focused instanceof HTMLSelectElement && !focused.disabled ||
    focused instanceof HTMLTextAreaElement && !focused.readOnly && !focused.disabled ||
    focused instanceof HTMLInputElement && !focused.readOnly && !focused.disabled &&
      !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(focused.type)
  );
  // iOS can retain keyboard-sized viewport geometry after a locked/backgrounded
  // page returns. Without an editable focus target this is not a software
  // keyboard. Preserve genuinely smaller visual viewports caused by pinch zoom.
  if (keyboardInset > 120 && !editableFocused && Math.abs((viewport.scale ?? 1) - 1) < 0.01) {
    return { height: innerHeight, offsetTop: 0, keyboardInset: 0, keyboardOpen: false };
  }

  return {
    height: Math.max(0, Math.min(innerHeight, viewportHeight)),
    offsetTop: Math.max(0, viewport.offsetTop),
    keyboardInset,
    keyboardOpen: keyboardInset > 120,
  };
}

export function observeVisualViewport(onChange: (state: VisualViewportState) => void) {
  let currentState = getVisualViewportState();
  onChange(currentState);
  let settleTimer: number | null = null;
    let rafId = 0;
    const resumeTimers: number[] = [];
    const cancelFrame = window.cancelAnimationFrame?.bind(window);

    const clearSettleTimer = () => {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const applyState = (next: VisualViewportState) => {
      const current = currentState;
      const changed =
        Math.abs(next.height - current.height) >= 1 ||
        Math.abs(next.offsetTop - current.offsetTop) >= 1 ||
        Math.abs(next.keyboardInset - current.keyboardInset) >= 1 ||
        next.keyboardOpen !== current.keyboardOpen;

      if (!changed) return;

      currentState = next;
      onChange(next);
    };

    const update = () => {
      rafId = 0;
      const next = getVisualViewportState();
      const viewport = window.visualViewport;
      const pageTopDrift = viewport ? Math.abs(viewport.pageTop - window.scrollY) : 0;
      const unstable = window.scrollY < 0 || pageTopDrift > 2;

      if (next.keyboardOpen && unstable) {
        clearSettleTimer();
        settleTimer = window.setTimeout(() => {
          settleTimer = null;
          applyState(getVisualViewportState());
        }, 120);
        return;
      }

      applyState(next);
    };

    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(update);
      clearSettleTimer();
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        applyState(getVisualViewportState());
      }, 250);
    };

    const viewport = window.visualViewport;

    // App restoration may change geometry without delivering a resize event.
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      resumeTimers.splice(0).forEach(timer => window.clearTimeout(timer));
      if (rafId) cancelFrame?.(rafId);
      rafId = 0;
      applyState(getVisualViewportState());
      schedule();
      // WebKit may settle after the initial frame without another resize event.
      for (const delay of [500, 1000]) {
        resumeTimers.push(window.setTimeout(() => {
          if (document.visibilityState !== "hidden") applyState(getVisualViewportState());
        }, delay));
      }
    };

    resume();
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);

    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      if (rafId) cancelFrame?.(rafId);
      clearSettleTimer();
      resumeTimers.forEach(timer => window.clearTimeout(timer));
    };
}
