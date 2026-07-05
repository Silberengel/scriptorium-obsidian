# Scriptorium Nostr

Create, sign, and publish Nostr document events from Obsidian.

**Author:** [Silberengel](https://jumble.imwald.eu/users/npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z)

**Repos:** [Gitea](https://git.imwald.eu/silberengel/scriptorium-obsidian) · [GitHub](https://github.com/Silberengel/scriptorium-obsidian)

## Features

- Markdown and AsciiDoc documents mapped to Nostr event kinds (notes, articles, wikis, publications)
- AsciiDoc header structure → nested 30040/30041 event trees
- Metadata in file frontmatter or AsciiDoc attributes; signed events saved to `{filename}_events.jsonl`
- Two-step workflow: create/sign locally, then publish to relays
- Kind 10002 relay list fetch with NIP-42 AUTH

## Quick Start

Requires [Obsidian](https://obsidian.md) (desktop) and a vault.

### Private key

The key is read **only** from `SCRIPTORIUM_OBSIDIAN_KEY` — never from plugin settings. Export it in the **same terminal** you use to start Obsidian.

```bash
# Generate a new key (optional)
./start-obsidian.sh --generate-key

# Load your key
export SCRIPTORIUM_OBSIDIAN_KEY="nsec1..."
```

To persist, add that `export` line to `~/.bashrc` or `~/.zshrc`, run `source` on it, and restrict permissions: `chmod 600 ~/.bashrc`. Desktop shortcuts do not inherit shell env — use `./start-obsidian.sh`.

### Install and run

```bash
./start-obsidian.sh ~/Documents/MyVault   # first run
./start-obsidian.sh                         # later runs (path saved)
```

Builds the plugin, installs [obsidian-asciidoc](https://github.com/dzruyk/obsidian-asciidoc), and launches Obsidian. Enable **Scriptorium Nostr** under **Settings → Community plugins**:

![Enable Scriptorium Nostr in Community plugins](./assets/Settings.png)

### Relays

Open **Settings → Scriptorium Nostr** (gear icon). Confirm your npub appears, set a **Default Relay**, then **Fetch** your kind 10002 list:

![Scriptorium Nostr settings — identity and relays](./assets/AppSettings.png)

If signing fails after install: close Obsidian, `export SCRIPTORIUM_OBSIDIAN_KEY=...`, run `./start-obsidian.sh` again.

## Usage

Use the **lightning bolt** ribbon menu or command palette:

![Nostr ribbon menu — write, create events, publish](./assets/Main_menu.png)

| Step | Command | Result |
| ---- | ------- | ------ |
| 1 | **Create Nostr Events** | Review metadata → sign → save `{filename}_events.jsonl` |
| 2 | **Publish Events to Relays** | Send batch to all write relays; notice shows per-relay `published/total` |

Other commands: **New Nostr Document**, **Edit Metadata**, **Preview Document Structure** (structured AsciiDoc), **Delete Nostr Events**.

Failed publishes leave events in the sidecar file — adjust relays in settings and publish again.

## File formats

### Markdown (`.md`)

Kinds **1**, **11**, **30023**, **30817**. YAML frontmatter:

```yaml
---
templateId: kind-30023-default
kind: 30023
title: "My Article"
author: "Author Name"
summary: "Article summary"
topics: "bitcoin, nostr"
---
```

### AsciiDoc (`.adoc`)

Kinds **30040**, **30041**, **30818**. Attributes after the title line:

```asciidoc
= Wiki Page Title

:templateId: kind-30818-default
:kind: 30818
:author: Jane Doe
:summary: Brief description

Body content here...
```

**Structured publications** (kind 30040): document title (`=`), then `==` chapters and optional `===` sections. Each header becomes an event; d-tags follow the tree path (`book-chapter-section`) so you can insert new sections without shifting existing ones. Re-create updates parent index `a` tags; publish to push changes to relays.

## Event kinds (default templates)

| Kind | Template id | Format | Description | Title |
| ---- | ----------- | ------ | ----------- | ----- |
| 1 | kind-1-default | Markdown | Normal note | — |
| 11 | kind-11-default | Markdown | Discussion thread OP | required |
| 30023 | kind-30023-default | Markdown | Long-form article | required |
| 30040 | kind-30040-default | AsciiDoc | Publication index | required |
| 30041 | kind-30041-default | AsciiDoc | Publication content | required |
| 30817 | kind-30817-default | Markdown | Wiki page | required |
| 30818 | kind-30818-default | AsciiDoc | Wiki page | required |

Templates are JSON presets in **Settings → Event Kind Templates**. Defaults (`type: "default"`, id ends in `-default`) can be reset but not deleted; custom templates (`type: "custom"`) can be added or removed. Multiple templates may share one kind — disambiguate with `templateId` in document metadata.

Shipped presets: [`src/shippedKindTemplates.json`](src/shippedKindTemplates.json) · loader: [`src/defaultKindTemplates.ts`](src/defaultKindTemplates.ts)

### Auto-generated tags

For replaceable/addressable kinds (NIP-01): `published_at` and stable `d`. Simple documents use a normalized title; structured publications use a **hierarchical path** from the header tree (e.g. `my-book-chapter-1-intro`) so inserting a chapter or section does not change existing d-tags. Re-creating and re-publishing replaces prior events when kind, pubkey, and `d` match. Index tags `T` and `N` normalize title and author. Do not put `published_at` in metadata.

### Metadata fields

Placeholders in templates are skipped at event creation — replace them with real values.

| Field | Notes |
| ----- | ----- |
| `templateId`, `kind` | Set automatically; keep in sync with your template |
| `title`, `author`, `summary`, `topics`, `image` | Common across most kinds |
| `type`, `version`, `published_on`, `published_by`, `source`, `auto_update` | 30040 publication index |

Nested 30041 events inherit `author` from the root publication for the `N` index tag.

## Manual installation

```bash
git clone <repo-url> && cd scriptorium-obsidian
npm install && npm run build
cp main.js manifest.json /path/to/vault/.obsidian/plugins/scriptorium-obsidian/
```

Enable the plugin, install [obsidian-asciidoc](https://github.com/dzruyk/obsidian-asciidoc), set `SCRIPTORIUM_OBSIDIAN_KEY`, start Obsidian from a terminal that has it exported.

## Development

Desktop Obsidian only (`isDesktopOnly` in manifest).

```bash
npm install
npm run dev      # watch build
npm run build    # production
npm run lint     # ESLint
```

## License

MIT
