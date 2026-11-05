import { colorToken } from "./colorTokens";
import { createTheme } from "@mui/material/styles";

const colors = {
  surface: colorToken("surface"),
  paper: colorToken("paper"),
  surfaceMuted: colorToken("surface-muted"),
  ink: colorToken("ink"),
  inkMuted: colorToken("ink-muted"),
  accent: colorToken("accent"),
  success: colorToken("success-strong"),
  danger: colorToken("danger"),
  warning: colorToken("warning"),
  cool: colorToken("cool"),
  border: "rgba(57, 47, 47, 0.12)",
};

// MUI needs literal palette colors; read them from the canonical CSS tokens.
export const muiTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: colors.accent,
      contrastText: colors.paper,
    },
    secondary: {
      main: colors.cool,
      contrastText: colors.ink,
    },
    success: {
      main: colors.success,
      contrastText: colors.paper,
    },
    warning: {
      main: colors.warning,
      contrastText: colors.ink,
    },
    error: {
      main: colors.danger,
      contrastText: colors.paper,
    },
    info: {
      main: colors.cool,
      contrastText: colors.ink,
    },
    background: {
      default: colors.surface,
      paper: colors.paper,
    },
    divider: colors.border,
    text: {
      primary: colors.ink,
      secondary: colors.inkMuted,
    },
  },
  shape: {
    borderRadius: 2,
  },
  typography: {
    fontFamily: "var(--font-body)",
    h1: { fontFamily: "var(--font-heading)" },
    h2: { fontFamily: "var(--font-heading)" },
    h3: { fontFamily: "var(--font-heading)" },
    h4: { fontFamily: "var(--font-heading)" },
    h5: { fontFamily: "var(--font-heading)" },
    h6: { fontFamily: "var(--font-heading)" },
  },
  zIndex: {
    mobileStepper: 1000,
    fab: 1050,
    speedDial: 1050,
    appBar: 1100,
    drawer: 5900,
    modal: 6000,
    snackbar: 5300,
    tooltip: 6200,
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-soft)",
        },
      },
    },
  },
});
