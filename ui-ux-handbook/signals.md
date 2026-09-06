# Signals

## Rules

- Use Signals only for shared client state that must react outside one component tree.
- Name every signal `sigThing` and keep it in a file whose name starts with `sig`.
- Signal files export signals only; put actions, effects, types, and services elsewhere.
- Replace object and array values instead of mutating them in place.
- Initialize global effects once before React renders.

## State ownership

| State                                  | Owner          |
| -------------------------------------- | -------------- |
| Shared client state                    | Preact Signals |
| Server data and mutations              | TanStack Query |
| Shareable filters, sorting, and paging | URL state      |
| Form drafts                            | TanStack Form  |
| Component-local presentation state     | React state    |

Do not mirror query data into Signals, and never store credentials or authentication tokens in local storage.

## File structure

Keep each signal beside the application or feature state it represents.

```text
app/
├── init-signal-effects.ts
└── ui/preferences/
    ├── models/AppPreferences.ts
    ├── signals/sigAppPreferences.ts
    ├── actions/app-preferences-actions.ts
    └── services/app-preferences-storage.ts
```

A signal file exports only writable or computed signals.

```ts
import { computed, signal } from "@preact/signals-react";

export const sigItems = signal<Item[]>([]);

export const sigActiveItems = computed(() => sigItems.value.filter(item => item.status === "ACTIVE"));
```

## Reading

Read `.value` directly inside a component; the configured transform subscribes the component.

```tsx
import { sigAppPreferences } from "@/app/ui/preferences/signals/sigAppPreferences";

export function AppPageLayout({ children }: React.PropsWithChildren) {
  const preferences = sigAppPreferences.value;
  const maxWidth = preferences.pageWidth === "full" ? false : preferences.pageWidth;

  return <VireoPageBody maxWidth={maxWidth}>{children}</VireoPageBody>;
}
```

Read a signal directly outside React when reactive rendering is not needed.

```ts
const currentLocale = sigAppPreferences.value.locale;
```

## Writing

Replace the value so subscribers receive the change.

```ts
sigItems.value = [...sigItems.value, createdItem];

sigItems.value = sigItems.value.map(item => (item.id === updatedItem.id ? updatedItem : item));
```

Put reusable writes in an action module, not in the signal file.

```ts
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from "../models/AppPreferences";
import { createAppPreferencesStorage } from "../services/app-preferences-storage";
import { sigAppPreferences } from "../signals/sigAppPreferences";

const preferencesStorage = createAppPreferencesStorage();

export function updateAppPreference<TKey extends keyof AppPreferences>(key: TKey, value: AppPreferences[TKey]): void {
  sigAppPreferences.value = {
    ...sigAppPreferences.value,
    [key]: value,
  };
}

export function resetAppPreferences(): void {
  sigAppPreferences.value = DEFAULT_APP_PREFERENCES;
  preferencesStorage.remove();
}
```

Call the action from the UI.

```tsx
<Switch checked={sigAppPreferences.value.darkMode} onChange={(_, value) => updateAppPreference("darkMode", value)} />
```

## Computed state

Use `computed` instead of storing a second value that can be derived.

```ts
export const sigCompactNavigation = computed(() => sigAppPreferences.value.navigationMode === "compact");
```

Update the source signal; computed signals are read-only.

```ts
updateAppPreference("navigationMode", "compact");

console.log(sigCompactNavigation.value); // true
```

## Local-storage-backed state

Parse stored data before using it as the initial value.

```ts
const preferencesStorage = createAppPreferencesStorage();

function readInitialPreferences(): AppPreferences {
  const result = AppPreferencesSchema.safeParse(preferencesStorage.read());
  return result.success ? result.data : DEFAULT_APP_PREFERENCES;
}
```

Create the signal from that validated value.

```ts
import { signal } from "@preact/signals-react";

export const sigAppPreferences = signal<AppPreferences>(readInitialPreferences());
```

Persist it through one global effect outside the signal file.

```ts
import { sigAppPreferences } from "@/app/ui/preferences/signals/sigAppPreferences";
import { createAppPreferencesStorage } from "@/app/ui/preferences/services/app-preferences-storage";
import { effect } from "@preact/signals-react";

let disposeSignalEffects: (() => void) | undefined;

export function initSignalEffects(): void {
  disposeSignalEffects?.();

  const preferencesStorage = createAppPreferencesStorage();
  disposeSignalEffects = effect(() => {
    preferencesStorage.write(sigAppPreferences.value);
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeSignalEffects?.());
}
```

Start global effects before mounting React.

```tsx
import { initSignalEffects } from "@/app/init-signal-effects";

initSignalEffects();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Component-local effects use `useSignalEffect`; application-lifetime effects belong in `initSignalEffects`.

## Transform setup

The Template applies the Signals transform through Rolldown and Babel.

```ts
import babel from "@rolldown/plugin-babel";

export function signalsReactTransform() {
  return babel({
    plugins: [["module:@preact/signals-react-transform"]],
  });
}
```

Apply the same transform to the app, Vitest, and Storybook configurations.

```ts
export default defineConfig({
  plugins: [react(), signalsReactTransform()],
});
```
