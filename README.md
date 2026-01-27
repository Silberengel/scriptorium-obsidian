# Scriptorium Nostr

An Obsidian plugin for creating, editing, and publishing Nostr document events directly from your vault.

**Author**: Silberengel  
**Homepage**: https://gitcitadel.com  
**Lightning tips**: gitcitadel@getalby.com

## Features

- **Multiple event kinds**: Markdown (1, 11, 30023, 30817) and AsciiDoc (30040, 30041, 30818)
- **Automatic structure parsing**: AsciiDoc documents with headers are parsed into nested 30040/30041 event hierarchies
- **Metadata in files**: Metadata stored directly in Markdown frontmatter or AsciiDoc header attributes
- **Two-step workflow**: Create/sign events separately from publishing to relays
- **Automatic relay management**: Fetch relay lists (kind 10002) with AUTH support

## Quick Start

### Installation

```bash
# First run (vault path required)
./start-obsidian.sh ~/Documents/MyVault

# Subsequent runs (path saved)
./start-obsidian.sh
```

The script automatically installs dependencies, builds the plugin, and starts Obsidian.

### Setup

1. **Generate a Nostr key** (if needed):
   ```bash
   ./start-obsidian.sh --generate-key
   ```
   Add the shown export command to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.).

2. **Set your private key**:
   ```bash
   export SCRIPTORIUM_OBSIDIAN_KEY="nsec1..."
   ```

3. **Configure relays**:
   - Open Obsidian Settings → Scriptorium Nostr
   - Click "Fetch" to get your relay list

## Usage

### Creating Events

1. Open a Markdown or AsciiDoc file
2. Run command: **Create Nostr Events**
3. A reminder modal will prompt you to update metadata
4. Update metadata in the file (see Metadata section below)
5. Click "OK" in the modal
6. Events are created, signed, and saved to `{filename}_events.jsonl`

### Publishing Events

1. Ensure events exist (`{filename}_events.jsonl`)
2. Run command: **Publish Events to Relays**
3. Events publish to all configured write relays

### Other Commands

- **Edit Metadata** - Open metadata editor for current file
- **Preview Document Structure** - Show event hierarchy (AsciiDoc structured documents only)
- **New Nostr Document** - Create a new document with metadata template

## File Formats

### Markdown Files (`.md`)

Supported event kinds: **1**, **11**, **30023**, **30817**

Metadata is stored in YAML frontmatter at the top of the file:

```yaml
---
kind: 30023
title: "My Article"
author: "Author Name"
summary: "Article summary"
image: "https://example.com/image.jpg"
topics: "bitcoin, nostr"
published_at: "1234567890"
---
```

### AsciiDoc Files (`.adoc`)

Supported event kinds: **30040**, **30041**, **30818**

**Simple AsciiDoc** (kind 30818):
```asciidoc
= Wiki Page Title

:kind: 30818
:author: Author Name
:summary: Page description
:image: https://example.com/image.jpg
:topics: bitcoin, nostr
```

**Structured AsciiDoc** (kind 30040 with nested 30041):
```asciidoc
= Book Title

:kind: 30040
:author: Author Name
:type: book
:summary: Book description
:collection_id: my-collection
:version_tag: v1

== Chapter 1

Chapter content here...

=== Section 1.1

Section content...
```

When publishing, metadata is automatically stripped from content before creating events.

## Event Kinds

| Kind | Format | Description | Title Required |
|------|--------|-------------|---------------|
| 1 | Markdown | Normal note | No |
| 11 | Markdown | Discussion thread OP | Yes |
| 30023 | Markdown | Long-form article | Yes |
| 30040 | AsciiDoc | Publication index | Yes |
| 30041 | AsciiDoc | Publication content | Yes |
| 30817 | Markdown | Wiki page | Yes |
| 30818 | AsciiDoc | Wiki page | Yes |

### Stand-alone vs Nested 30041

- **Stand-alone 30041**: Uses NKBIP-01 tags (d, title, image, summary, published_at, topics)
- **Nested 30041** (under 30040): Uses NKBIP-08 tags (inherits collection_id, version_tag from parent)

## Metadata Fields

All predefined metadata fields are shown in frontmatter/attributes with placeholder descriptions. Remove or update placeholders you don't need. Placeholder values are automatically skipped when creating events.

### Common Fields

- `kind` - Event kind (required)
- `title` - Document title (required for all except kind 1)
- `author` - Author name
- `summary` - Brief description
- `topics` - Comma-separated topics (available for all event kinds)
- `image` - Image URL (available for 30023, 30040, 30041, 30817, 30818)

### Kind-Specific Fields

**30023 (Article)**:
- `published_at` - Unix timestamp

**30040 (Publication Index)**:
- `type` - Publication type (book, illustrated, magazine, documentation, academic, blog)
- `version` - Version or edition
- `published_on` - Publication date
- `published_by` - Publisher
- `source` - Source URL
- `auto_update` - Auto-update behavior (yes, ask, no)
- `collection_id` - NKBIP-08 collection identifier
- `version_tag` - NKBIP-08 version identifier

**30041 (Publication Content)**:
- Stand-alone: Same as 30023 (image, summary, published_at, topics)
- Nested: NKBIP-08 tags (collection_id, title_id, chapter_id, section_id, version_tag)

## Manual Installation

1. Clone repository
2. Run `npm install && npm run build`
3. Copy `main.js` and `manifest.json` to `.obsidian/plugins/scriptorium-obsidian/`
4. Enable in Obsidian Settings → Community Plugins
5. Install [obsidian-asciidoc](https://github.com/dzruyk/obsidian-asciidoc) plugin (required for `.adoc` files)

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

## License

MIT
