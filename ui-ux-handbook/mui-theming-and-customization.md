# MUI Theming and Customization

## Rules

1. The Vireo CLI generates the initial theme; the application owns it.
2. Use semantic theme tokens instead of product colors in feature code.
3. Put application-wide component policy in `theme.components`.
4. Never target generated Emotion classes or private component structure.

## Generated theme

Edit the generated file that owns the decision:

```text
app/ui/theme/
  AppThemeProvider.tsx       # installs the theme and applies the saved mode
  config/
    theme.ts                 # assembles the theme
    theme.light.ts           # light semantic colors
    theme.dark.ts            # dark semantic colors
    theme.surfaces.ts        # application surface roles
    theme.tokens.ts          # typography, shape, layout, and motion
    theme.types.ts           # MUI type extensions
    theme.components.ts      # global MUI and Vireo component policy
```

## Global customization

Extend MUI when adding application-specific theme values:

```ts
// theme.types.ts
import type { AppSurfacePalette } from "./theme.surfaces";
import type { APP_THEME_TOKENS } from "./theme.tokens";

type AppMotionTokens = (typeof APP_THEME_TOKENS)["motion"];

declare module "@mui/material/styles" {
  interface Palette {
    appSurface: AppSurfacePalette;
  }
  interface PaletteOptions {
    appSurface?: AppSurfacePalette;
  }
  interface Theme {
    appMotion: AppMotionTokens;
  }
  interface ThemeOptions {
    appMotion?: AppMotionTokens;
  }
}
```

Override MUI and Vireo components through the same `components` object:

```ts
import type { Theme } from "@mui/material";
import type {} from "@vireocodedev/ui";

export const APP_THEME_COMPONENTS: Theme["components"] = {
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: ({ theme }) => ({ borderRadius: theme.shape.borderRadius }),
    },
  },
  VireoPageHeader: {
    defaultProps: { title: "Page title" },
    styleOverrides: {
      root: ({ ownerState, theme }) => ({
        backgroundColor: theme.palette.appSurface.chrome,
        paddingInline: theme.spacing(ownerState.mode === "compact" ? 1 : 3),
      }),
    },
  },
};
```

Define the six surface roles used directly by the Template UI:

```ts
export const APP_SURFACES_LIGHT = {
  canvas: "#f6f7f9", // wide application environment
  screen: "#ffffff", // compact continuous screen
  recessed: "#f0f2f4", // inset groups
  content: "#ffffff", // primary working surface
  elevated: "#f0f2f4", // raised nested content
  chrome: "#ffffff", // headers and navigation
};

export const APP_SURFACES_DARK = {
  canvas: "#0b0c0e",
  screen: "#111315",
  recessed: "#0b0c0e",
  content: "#111315",
  elevated: "#1a1c20",
  chrome: "#1a1c20",
};
```

Keep product typography, shape, and motion together; use `theme.spacing()` for spacing:

```ts
export const APP_THEME_TOKENS = {
  motion: {
    duration: { micro: 110, standard: 180, enter: 210, exit: 150 },
    easing: {
      standard: "cubic-bezier(0.2, 0, 0, 1)",
      enter: "cubic-bezier(0, 0, 0, 1)",
      exit: "cubic-bezier(0.3, 0, 1, 1)",
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: "InterVariable, Inter, system-ui, sans-serif",
    h1: { fontWeight: 850, letterSpacing: "-0.035em" },
    button: { fontWeight: 750, letterSpacing: "0.01em" },
  },
} as const;
```

Give light and dark schemes the same semantic structure:

```ts
export const APP_THEME_LIGHT_COLOR_SCHEME: ColorSystemOptions = {
  palette: {
    mode: "light",
    primary: { main: "#006c98", light: "#30c5fb", dark: "#00577c", contrastText: "#ffffff" },
    background: { default: APP_SURFACES_LIGHT.canvas, paper: "#ffffff" },
    appSurface: APP_SURFACES_LIGHT,
    text: { primary: "#172335", secondary: "#606872", disabled: "#9298a1" },
    divider: "#d5d8dd",
  },
};

export const APP_THEME_DARK_COLOR_SCHEME: ColorSystemOptions = {
  palette: {
    mode: "dark",
    primary: { main: "#69d9ff", light: "#a8ecff", dark: "#30c5fb", contrastText: "#07111f" },
    background: { default: APP_SURFACES_DARK.canvas, paper: "#111315" },
    appSurface: APP_SURFACES_DARK,
    text: { primary: "#f4f5f6", secondary: "#a9adb5", disabled: "#70757d" },
    divider: "#303238",
  },
};
```

## Theme assembly

Compose the generated pieces once:

```ts
export const APP_THEME = createTheme({
  appMotion: APP_THEME_TOKENS.motion,
  cssVariables: { colorSchemeSelector: "data" },
  colorSchemes: {
    light: APP_THEME_LIGHT_COLOR_SCHEME,
    dark: APP_THEME_DARK_COLOR_SCHEME,
  },
  components: APP_THEME_COMPONENTS,
  motion: { reducedMotion: "system" },
  shape: APP_THEME_TOKENS.shape,
  typography: APP_THEME_TOKENS.typography,
});
```

Let application preferences own light/dark mode:

```tsx
function AppThemeMode({ children, mode }: React.PropsWithChildren<{ mode: "light" | "dark" }>) {
  const { setMode } = useColorScheme();
  React.useEffect(() => setMode(mode), [mode, setMode]);
  return children;
}

export function AppThemeProvider({ children }: React.PropsWithChildren) {
  const { preferences } = useAppPreferences();
  const mode = preferences.darkMode ? "dark" : "light";

  return (
    <ThemeProvider theme={APP_THEME} defaultMode={mode} storageManager={null}>
      <AppThemeMode mode={mode}>
        <CssBaseline />
        <VireoThemeColorMeta />
        {children}
      </AppThemeMode>
    </ThemeProvider>
  );
}
```

## Instance customization

Use the narrowest public API: semantic prop → `sx` → `slotProps` → `slots` → global theme override.

Choose an existing semantic prop first:

```tsx
<Button color="error" variant="contained" />
<VireoFormSection variant="divided" />
```

Style the root with `sx`:

```tsx
<VireoPageHeader title={t("header.title")} sx={{ mb: 2 }} />
```

Style or configure a public slot with `slotProps`:

```tsx
<VireoPageHeader title={t("header.title")} slotProps={{ title: { sx: { maxInlineSize: "42rem" } } }} />
```

Replace a public slot only when styling is insufficient:

```tsx
<VireoPageHeader title={t("header.title")} slots={{ title: ProductHeading }} />
```
