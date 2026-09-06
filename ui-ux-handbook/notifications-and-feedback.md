# Notifications and Feedback

## Rules

1. Render feedback at the smallest boundary that owns the event and its recovery.
2. Distinguish pending, queued, saved, synchronized, and failed states truthfully.
3. Preserve usable content and user input during pending work and recoverable failures.
4. Give each event one primary live announcement.
5. Show safe, localized product copy; never expose raw server errors.

## Choose the surface

Use the feedback surface that matches the scope and lifetime of the message:

| Situation                                                   | Surface                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| One field is invalid                                        | Bound field error                                          |
| A form has invalid fields                                   | `form.ErrorSummary` plus inline errors                     |
| A completed/background event needs brief global feedback    | Toast                                                      |
| Information or recovery must remain beside affected content | MUI `Alert`                                                |
| An action is pending                                        | Busy state on the initiating action                        |
| A region is loading or refreshing                           | `VireoLoadingRegion`; skeletons for initial unknown leaves |
| A query resolved with no data                               | Empty state, not an error                                  |
| The user must decide before continuing                      | Confirmation dialog                                        |

Import each API from its public boundary:

```tsx
import { Alert, Button, LinearProgress } from "@mui/material";
import { VireoLoadingRegion, VireoSkeleton } from "@vireocodedev/ui";
import { VireoToaster, toast } from "@vireocodedev/ui/sonner";
import { useVireoMutation } from "@vireocodedev/ui/tanstack-query";
```

## Toasts

Mount one notification region beneath the application providers:

```tsx
export function AppProviders({ children }: React.PropsWithChildren) {
  return (
    <VireoProviderComposer providers={providers}>
      {children}
      <VireoToaster />
    </VireoProviderComposer>
  );
}
```

Use semantic calls and a stable, non-sensitive ID for repeated copies of one event:

```ts
toast.success(t("messages.created", { name: item.name }));
toast.error(t("messages.createFailed"));

toast.error(t("session.expired"), {
  id: "app-session-expired",
});
```

If the confirmed result is already obvious in the visible interface, do not add a duplicate success toast.

## Message copy

Name the outcome and affected object; keep diagnostics out of user-facing messages:

```text
Useful:      “Quarterly forecast” created
Useful:      Could not delete “Quarterly forecast”
Useful:      Your session expired. Sign in again.
Not useful:  Success
Not useful:  Request failed with HTTP 500
Not useful:  TypeError: Cannot read properties of undefined
```

## Mutation feedback

Use `useVireoMutation` when a TanStack Query mutation should produce standardized outcome toasts:

```ts
export function useItemCreateMutation() {
  const { t } = useItemTranslation();
  const queryClient = useQueryClient();

  return useVireoMutation<Item, Error, Item>({
    mutationKey: ItemMutationKeys.create,
    mutationFn: itemApi.create.bind(itemApi),
    successMessage: item => t("messages.created", { name: item.name }),
    errorMessage: t("messages.createFailed"),
    onSuccess: item => {
      insertItemIntoUnfilteredSearchQueries(queryClient, item);
      void queryClient.invalidateQueries({ queryKey: ItemQueryKeys.all });
    },
  });
}
```

The initiating control still owns pending state and duplicate-submission prevention:

```tsx
const savePending = createItem.isPending || updateItem.isPending;

<VireoResponsiveFormOverlay closeDisabled={savePending} {...overlayProps}>
  <ItemFormActions pending={savePending} />
</VireoResponsiveFormOverlay>;
```

## Persistent feedback

Keep a recoverable refresh failure beside the stale content it affects:

```tsx
function RefreshFailureAlert({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation(ITEMS_TRANSLATION_NAMESPACE);

  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" onClick={onRetry}>
          {t("error.retry")}
        </Button>
      }
    >
      {t("error.refreshMessage")}
    </Alert>
  );
}
```

## Query and loading states

Handle initial loading, initial failure, empty data, content, and refresh failure separately:

```tsx
const hasData = result.data !== undefined;
const items = result.data?.content ?? [];

if (result.isError && !hasData) {
  return (
    <Alert severity="error" action={<Button onClick={result.onRetry}>{t("error.retry")}</Button>}>
      {t("error.message")}
    </Alert>
  );
}

if (!hasData) {
  return (
    <ItemsTableFrame>
      <VireoSkeleton>
        <Typography>Item name</Typography>
      </VireoSkeleton>
    </ItemsTableFrame>
  );
}

if (items.length === 0) {
  return <ItemsEmptyState onCreate={onOpenCreate} />;
}

return (
  <VireoLoadingRegion loading={result.isRefreshing} loadingLabel={t("table.refreshing")}>
    {({ loadingVisible }) => (
      <>
        {loadingVisible ? <LinearProgress aria-hidden /> : null}
        {result.isError ? <RefreshFailureAlert onRetry={result.onRetry} /> : null}
        <ItemsTable items={items} />
      </>
    )}
  </VireoLoadingRegion>
);
```

Skeletons replace only unknown leaves inside stable layout; never replace stale usable content during refresh.

## Announcements

Choose one primary live owner for each transition:

| Event                     | Primary announcement owner        |
| ------------------------- | --------------------------------- |
| Field validation          | Bound field error or form summary |
| Pending action            | Initiating action                 |
| Region loading            | `VireoLoadingRegion`              |
| Local recoverable failure | Contextual `Alert`                |
| Brief global outcome      | `VireoToaster`                    |

Toasts do not steal focus. Move focus only when a new surface replaces the task or requires an immediate decision.
