# Internationalization and Localization

## Rules

1. The application owns supported locales, preferences, resources, namespaces, and its single i18next instance.
2. Use semantic keys and complete messages; never concatenate translated fragments.
3. Keep API, model, enum, date, and numeric values canonical and untranslated.
4. Map validated server error codes to translations; never show raw server errors.
5. Localize visible copy and its accessible name, description, or announcement together.

## Generated localization

Vireo supplies reusable resources and temporal localization; the application owns the product language policy:

```text
app/
  app.localization.ts                         # namespaces and resource registry
  ui/localization/
    app-locales.ts                            # supported and default locales
    app-i18n.ts                               # the application i18next instance
    app-localization-provider.tsx             # runtime locale synchronization
    use-app-translation.ts                    # app namespace hook
    validated-schema.ts                       # typed validation-schema factory
    resources/app.{locale}.ts                 # application-shell copy
@types/i18next.d.ts                           # typed namespace registry
features/<feature>/localization/
  resources/<feature>.{locale}.ts             # reusable domain copy
  use-<feature>-translation.ts                 # bound feature hook
pages/<page>/localization/resources/           # route-only copy
generated/<capability>/localization/            # generated capability copy
```

## Runtime setup

Define supported locales once and derive the type from them:

```ts
export const APP_LOCALES = ["en", "hr"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_APP_LOCALE: AppLocale = "en";
```

Register application and Vireo resources, then initialize one isolated i18next instance:

```ts
const starterResources = createStarterResources({ locales: APP_LOCALES });

export const APP_LOCALIZATION_RESOURCES = {
  en: { app: appEn, item: itemEn, items: itemsEn, ...starterResources.en },
  hr: { app: appHr, item: itemHr, items: itemsHr, ...starterResources.hr },
} satisfies Record<AppLocale, AppLocaleResources>;

export const APP_TRANSLATION_NAMESPACES = ["app", "item", "items", ...STARTER_TRANSLATION_NAMESPACES];

export const appI18n = createInstance();

void appI18n.use(initReactI18next).init({
  defaultNS: "app",
  fallbackLng: DEFAULT_APP_LOCALE,
  initAsync: false,
  interpolation: { escapeValue: false },
  lng: DEFAULT_APP_LOCALE,
  ns: APP_TRANSLATION_NAMESPACES,
  react: { useSuspense: false },
  resources: APP_LOCALIZATION_RESOURCES,
  supportedLngs: Object.keys(APP_LOCALIZATION_RESOURCES),
});
```

Apply the validated preference to translations, document language, and temporal controls:

```tsx
export function AppLocalizationProvider({ children }: React.PropsWithChildren) {
  const {
    preferences: { locale },
  } = useAppPreferences();

  React.useEffect(() => {
    document.documentElement.lang = locale;
    if (appI18n.resolvedLanguage !== locale) void appI18n.changeLanguage(locale);
  }, [locale]);

  return (
    <I18nextProvider i18n={appI18n}>
      <VireoTemporalLocalizationProvider locale={locale}>{children}</VireoTemporalLocalizationProvider>
    </I18nextProvider>
  );
}
```

Temporal localization changes picker presentation only; it does not change submitted values or assign a timezone.

## Author resources

Own each namespace at the narrowest stable boundary: shell copy in `app`, reusable domain copy in a feature, and route-only copy in a page.

Canonical English and shape-checked Croatian resources:

```ts
// item.en.ts
export const itemEn = {
  fields: { name: "Name", status: "Status" },
  status: { DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived" },
  validation: { name: { min: "Enter at least {{minimum}} characters." } },
  messages: { created: "{{name}} created" },
} as const;

// item.hr.ts
export const itemHr = {
  fields: { name: "Naziv", status: "Status" },
  status: { DRAFT: "Skica", ACTIVE: "Aktivno", ARCHIVED: "Arhivirano" },
  validation: { name: { min: "Unesite najmanje {{minimum}} znaka." } },
  messages: { created: "Stavka {{name}} je kreirana" },
} satisfies WidenLeaves<typeof itemEn>;
```

Register namespace types and bind feature code to its namespace:

```ts
// @types/i18next.d.ts
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "app";
    strictKeyChecks: true;
    resources: {
      app: AppTranslationResources;
      item: ItemTranslationResources;
    };
  }
}

// use-item-translation.ts
import { ITEM_TRANSLATION_NAMESPACE } from "@/app/app.localization";
import { useTranslation } from "react-i18next";

export function useItemTranslation() {
  return useTranslation(ITEM_TRANSLATION_NAMESPACE);
}
```

Translate Vireo component copy at composition time:

```tsx
const { t } = useItemTranslation();

<VireoResponsiveFormOverlay title={t("form.updateTitle")} closeLabel={t("form.close")}>
  <ItemFormFields />
</VireoResponsiveFormOverlay>;
```

Use named interpolation, i18next plural keys, numeric `count`, and canonical enum values:

```ts
const itemsEn = {
  results_one: "{{formattedCount}} result",
  results_other: "{{formattedCount}} results",
  delete: { message: "This permanently removes {{name}} from the active workspace." },
  filterFields: {
    statusValues: { DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived" },
  },
} as const;

t("delete.message", { name: item.name });
t("results", { count, formattedCount: new Intl.NumberFormat(locale).format(count) });
t(`filterFields.statusValues.${item.status}`);
```

## Localized validation

Build editable schemas from a typed translator and rebuild them when the language changes:

```ts
export const buildValidatedItemSchema: ValidatedSchemaFactory<Item, "item", ItemValidationContext> = (t, context) =>
  Item.extend({
    name: Item.shape.name
      .trim()
      .min(context.nameMinimumLength, t("validation.name.min", { minimum: context.nameMinimumLength })),
  });

const schema = React.useMemo(() => buildValidatedItemSchema(t, { nameMinimumLength }), [nameMinimumLength, t]);
```

## Format values

Format canonical values at the presentation boundary with an explicit locale and product-owned currency or timezone:

```ts
export function formatSummary(value: number, instant: Date, locale: string, currency: string, timeZone: string) {
  return {
    number: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value),
    money: new Intl.NumberFormat(locale, { style: "currency", currency }).format(value),
    date: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(instant),
  };
}
```

## Add a locale

1. Add the locale to `APP_LOCALES` and choose whether the default changes.
2. Add every application, feature, page, and generated resource file.
3. Register and type every namespace for the new locale.
4. Import/configure its Day.js locale and MUI picker text when Vireo does not bundle them.
5. Review the complete UI in that locale, including long copy, validation, formatting, and accessible text.
