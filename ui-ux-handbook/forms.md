# Forms

## Rules

- Keep one canonical model, a fresh-default factory, and a translated validation-schema factory.
- TanStack Form owns the draft; the query or mutation layer owns server state; fields never call the API.
- Validate on submit first, then revalidate while the user corrects the submitted form.
- Keep visible labels and programmatic control labels together.
- Preserve the form while submitting or showing recoverable errors; submission is not a skeleton state.

## State ownership

| State                           | Owner                                    |
| ------------------------------- | ---------------------------------------- |
| Editable form draft             | TanStack Form through `useVireoForm`     |
| Server data and mutations       | TanStack Query or the feature data layer |
| Shareable filters and paging    | URL state                                |
| Temporary presentation state    | Local React state                        |
| Persistent presentation choices | Application preferences                  |

## Public API

Import form behavior from the forms entry point and shared visual components from the package root.

```tsx
import { VireoContainerGrid, VireoLabelBox } from "@vireocodedev/ui";
import { useVireoForm, VireoResponsiveFormOverlay } from "@vireocodedev/ui/forms";
```

`useVireoForm` exposes the components used by one form instance.

```text
form.Form
form.Field
form.Actions
form.ErrorSummary
form.SubmitButton
```

## Feature structure

Keep the model, form hook, fields, actions, and host separate.

```text
features/item/
├── models/Item.ts
├── hooks/useItemForm.ts
└── components/
    ├── forms/
    │   ├── ItemFormFields.tsx
    │   └── ItemFormActions.tsx
    └── overlays/
        └── ItemFormOverlay.tsx
```

## Model and validation

Use one model for parsed data, default values, editing, and validation.

```ts
import { z } from "zod";

export const ItemStatus = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const Item = z.object({
  id: z.number(),
  name: z.string(),
  description: z
    .string()
    .nullable()
    .transform(value => value ?? ""),
  quantity: z.number().int().nonnegative(),
  status: ItemStatus,
});
export type Item = z.infer<typeof Item>;

export function getDefaultItem(): Item {
  return {
    id: 0,
    name: "",
    description: "",
    quantity: 0,
    status: "DRAFT",
  };
}

export type ItemValidatedSchemaContext = Readonly<{
  mode: AppFormMode;
  nameMinimumLength: number;
}>;

export const buildValidatedItemSchema: ValidatedSchemaFactory<Item, "item", ItemValidatedSchemaContext> = (
  t,
  context,
) => {
  if (context.mode === AppFormMode.enum.READ) {
    return Item as z.ZodType<Item, Item>;
  }

  return Item.extend({
    name: Item.shape.name.trim().min(
      context.nameMinimumLength,
      t("validation.name.min", {
        minimum: context.nameMinimumLength,
      }),
    ),
  }) as z.ZodType<Item, Item>;
};
```

Frontend validation improves feedback; the backend remains authoritative.

## Modes

Use the shared modes for entity forms.

```ts
import { z } from "zod";

export const AppFormMode = z.enum(["CREATE", "UPDATE", "READ"]);
export type AppFormMode = z.infer<typeof AppFormMode>;
```

| Mode     | Initial value   | Behavior                   |
| -------- | --------------- | -------------------------- |
| `CREATE` | Fresh defaults  | Editable; creates a record |
| `UPDATE` | Existing record | Editable; updates a record |
| `READ`   | Existing record | Read-only; does not submit |

## Form hook

Build the translated schema in the feature hook and return the submission promise.

```tsx
export function useItemForm({ initialValue, mode, onSubmit, validationContext }: UseItemFormOptions) {
  const { t } = useItemTranslation();

  const defaultValues = React.useMemo(() => initialValue ?? getDefaultItem(), [initialValue]);

  const schema = React.useMemo(
    () =>
      buildValidatedItemSchema(t, {
        mode,
        nameMinimumLength: validationContext.nameMinimumLength,
      }),
    [mode, t, validationContext.nameMinimumLength],
  );

  const form = useVireoForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  React.useEffect(() => {
    if (form.state.submissionAttempts === 0) return;
    void form.validate("submit");
  }, [form, schema]);

  return form;
}

export type ItemFormApi = ReturnType<typeof useItemForm>;
```

## Fields and layout

Choose the bound field by the value and interaction.

| Field                             | Use it for                                                        |
| --------------------------------- | ----------------------------------------------------------------- |
| `TextField`                       | Text                                                              |
| `NumberField`                     | `number \| null`                                                  |
| `CheckboxField` / `SwitchField`   | Acknowledgement / immediate on-off setting                        |
| `SelectField` / `RadioGroupField` | Short fixed choices                                               |
| `AutocompleteField`               | Searchable choices; store scalar IDs                              |
| Temporal / file fields            | Canonical timezone-free strings / transient browser `File` values |

Use `VireoContainerGrid` for responsive form layout and `VireoLabelBox` for visible labels.

```tsx
export function ItemFormFields({ form, mode }: ItemFormFieldsProps) {
  const { t } = useItemTranslation();
  const readOnly = mode === AppFormMode.enum.READ;

  return (
    <VireoContainerGrid container spacing={1}>
      <VireoContainerGrid size={{ xs: 12, sm: 6 }}>
        <form.Field name="name">
          {field => (
            <VireoLabelBox label={t("fields.name")} required={!readOnly}>
              <field.TextField
                label={null}
                autoFocus={mode === AppFormMode.enum.CREATE}
                placeholder={t("form.namePlaceholder")}
                slotProps={{
                  htmlInput: { "aria-label": t("fields.name") },
                }}
              />
            </VireoLabelBox>
          )}
        </form.Field>
      </VireoContainerGrid>

      <VireoContainerGrid size={{ xs: 12, sm: 6 }}>
        <form.Field name="status">
          {field => (
            <VireoLabelBox label={t("fields.status")} required={!readOnly}>
              <field.SelectField
                label={null}
                disableClearable
                options={ItemStatus.options}
                getOptionValue={option => option}
                renderOption={option => t(`status.${option}`)}
                slotProps={{
                  htmlInput: { "aria-label": t("fields.status") },
                }}
              />
            </VireoLabelBox>
          )}
        </form.Field>
      </VireoContainerGrid>
    </VireoContainerGrid>
  );
}
```

## Validation errors

Bound fields show inline errors automatically; add a summary when scanning the whole form would be difficult.

```tsx
<form.Form>
  <form.ErrorSummary scope="all" localeText={errorSummaryLocaleText} />
  <ItemFormFields form={form} mode={mode} />
</form.Form>
```

## Read-only mode

Keep the same fields and switch the form boundary to read-only presentation.

```tsx
<form.Form readOnly={mode === AppFormMode.enum.READ} readOnlyEmptyValue={t("form.notProvided")}>
  <ItemFormFields form={form} mode={mode} />
</form.Form>
```

## Actions and submission

Keep Cancel before Submit and disable unsafe exits while the mutation is pending.

```tsx
export function ItemFormActions({ editing, form, onCancel, pending = false }: ItemFormActionsProps) {
  const { t } = usePlatformTranslation();
  const { t: tItem } = useItemTranslation();

  return (
    <form.Actions>
      <Button type="button" disabled={pending} onClick={onCancel}>
        {t("common.cancel")}
      </Button>
      <form.SubmitButton variant="contained">{editing ? tItem("form.update") : tItem("form.create")}</form.SubmitButton>
    </form.Actions>
  );
}
```

`SubmitButton` follows the form submission promise; extra mutation state can still disable closing.

## Responsive overlay

Compose the hook, mutation, form boundary, actions, and fields in the overlay host.

```tsx
export function ItemFormOverlay({ item, open, onClose, onExited }: ItemFormOverlayProps) {
  const { t } = useItemTranslation();
  const createItem = useItemCreateMutation();
  const updateItem = useItemUpdateMutation();
  const mode = item ? AppFormMode.enum.UPDATE : AppFormMode.enum.CREATE;

  const submit = async (value: Item) => {
    if (item) {
      await updateItem.mutateAsync({ id: item.id, value });
    } else {
      await createItem.mutateAsync(value);
    }
    onClose();
  };

  const form = useItemForm({
    initialValue: item,
    mode,
    onSubmit: submit,
    validationContext: DEFAULT_ITEM_FORM_VALIDATION_CONTEXT,
  });

  const savePending = createItem.isPending || updateItem.isPending;

  return (
    <VireoResponsiveFormOverlay
      open={open}
      onClose={onClose}
      onExited={onExited}
      closeDisabled={savePending}
      title={item ? t("form.updateTitle") : t("form.createTitle")}
      closeLabel={t("form.close")}
      renderForm={children => (
        <form.Form
          layoutWidth="full"
          readOnly={mode === AppFormMode.enum.READ}
          readOnlyEmptyValue={t("form.notProvided")}
          unsavedChangesGuard
        >
          {children}
        </form.Form>
      )}
      actions={({ requestClose }) => (
        <ItemFormActions
          form={form}
          editing={mode === AppFormMode.enum.UPDATE}
          onCancel={requestClose}
          pending={savePending}
        />
      )}
    >
      <ItemFormFields form={form} mode={mode} />
    </VireoResponsiveFormOverlay>
  );
}
```

`unsavedChangesGuard` and the overlay's `requestClose` keep Cancel, the close button, Escape, and backdrop exits under the same guard.
