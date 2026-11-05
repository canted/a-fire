import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  // Keep toasts above the BottomNav while accounting for safe areas
  const bottomOffset = "calc(var(--bottom-nav-height) + 14px + env(safe-area-inset-bottom))";

  return (
    <SonnerToaster
      position="bottom-center"
      richColors
      offset={{ bottom: bottomOffset }}
      mobileOffset={{ bottom: bottomOffset }}
      style={{ zIndex: "var(--z-toast)" }}
    />
  );
}
