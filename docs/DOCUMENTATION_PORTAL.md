# Public documentation architecture

The canonical Vireo documentation entry point is <https://vireocode.com/docs/>.
It contains task-oriented onboarding, concepts, guides, CLI documentation,
operations, examples, versions, roadmap, and community routes.

The GitHub Pages artifact at <https://vireocodedev.github.io/vireo/> remains the
exact-release technical host for interactive Storybook, generated TypeScript exports,
aggregate Javadocs, and immutable machine snapshots. It is not the primary learning
experience.

## Main website surfaces

| Route                | Content                                                 |
| -------------------- | ------------------------------------------------------- |
| `/docs/`             | Current friendly documentation line                     |
| `/docs/0.3/`         | Version-specific copy of the current Vireo 0.3 guides   |
| `/examples/`         | End-to-end and interactive example paths                |
| `/storybook/`        | Curated Storybook entry and exact snapshot link         |
| `/reference/`        | TypeScript, Java, Storybook, and release reference map  |
| `/versions/`         | Friendly-to-exact release mapping                       |
| `/search-index.json` | Canonical guides plus exact TypeScript/JVM symbol links |
| `/versions.json`     | Machine-readable CLI/npm/JVM/Template mapping           |

`site/content/manifest.json` owns the information architecture and canonical page
metadata. `site/content/*.md` owns user-facing guide content. `site/app.mjs` renders
the React document shell, while `site/build.mjs` pre-renders every route, current
version aliases, search, sitemap, and machine metadata.

## Exact reference surfaces

| Stable GitHub Pages route | Content                                  |
| ------------------------- | ---------------------------------------- |
| `/`                       | Interactive Storybook host               |
| `/api/typescript/`        | Current exact TypeScript reference alias |
| `/api/jvm/`               | Current exact aggregate-Javadoc alias    |
| `/versions/`              | Exact machine-release snapshots          |
| `/versions.json`          | Exact package/JVM release index          |

The old `/docs/` and `/latest/` GitHub Pages routes redirect to the canonical main
website. Exact reference and Storybook routes remain on Pages.

Main-site search federates every checked TypeScript export and JVM public type into the same index as the task guides. A symbol result links directly to its immutable exact-release reference, so users do not need to discover or search a second portal first. The exhaustive reference portal retains its richer member and Storybook search.

## Version contract

The human-facing version is a Vireo minor line such as `0.3`. It maps to independent
artifact versions rather than replacing them. The current mapping includes:

- the exact `create-vireo` release;
- every published npm package version;
- the coordinated JVM family and modules;
- the exact starter-template commit; and
- the immutable GitHub Pages reference snapshot.

The machine release ID, currently `npm-0.8.7_jvm-0.4.0`, remains an internal exact
snapshot key. It is deliberately not the primary navigation label.

When a future documentation line becomes current, retain the prior friendly route as
a source-owned archive before moving `/docs/`. Exact reference archives continue to
follow the existing documentation-release policy.

## Content ownership

- Main website: explanation, decisions, tutorials, task guides, component usage.
- Storybook: interactive visual states and component authoring context.
- TypeScript/Javadocs: exhaustive generated signatures.
- Package READMEs: concise install and entry summaries linking to the website.
- Repository docs: contributor, release, evidence, and implementation detail.

Content must not be copied into several canonical locations. When a repository guide
is migrated, the README or source guide points to the corresponding website route.
The executable [documentation ownership model](DOCUMENTATION_OWNERSHIP.md) classifies
every checked-in document and rejects unclassified or conflicting duplicate ownership.

## Local builds

Build and verify the main website:

```bash
corepack npm run site:test
corepack npm run site:build
corepack npm run site:check:artifact
```

Build the exact Storybook/API reference artifact:

```bash
corepack npm run build-docs
```

The website deploys atomically to the Vireo VPS. GitHub Pages continues to deploy the
exact technical artifact after its own policy checks pass.
