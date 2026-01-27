# Scriptorium Nostr

An Obsidian plugin for creating, editing, and publishing Nostr document events directly from your vault.

**Author**: Silberengel  
**Homepage**: https://gitcitadel.com  
**Lightning tips**: gitcitadel@getalby.com

## Features

- **Multiple event kinds**: Markdown (1, 11, 30023, 30817) and AsciiDoc (30040, 30041, 30818)
- **Automatic structure parsing**: AsciiDoc documents with headers are parsed into nested 30040/30041 event hierarchies
- **NKBIP-08 support**: Hierarchical book wikilinks with optional collection tags for compendiums, digests, and libraries
- **Flexible structure**: Supports both two-level (book + chapters) and three-level (book + chapters + sections) hierarchies
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
---
```

**Note**: The `published_at` tag is automatically generated with the current UNIX timestamp during event creation for all replaceable event kinds. It should not be included in metadata and will be ignored if present.

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
:collection_id: bible
:version_tag: kjv

== Chapter 1

Chapter content here...

=== Section 1.1

Section content...
```

**Two-level structure** (book + chapters, no sections):
```asciidoc
= Book Title

:kind: 30040
:author: Author Name
:type: book
:summary: Book description

== Chapter 1

Chapter content here...

== Chapter 2

Chapter content here...
```

In two-level structures, chapters are created as 30041 events directly under the root 30040.

When publishing, metadata is automatically stripped from content before creating events.

### NKBIP-08 Tag Inheritance

For structured AsciiDoc documents (kind 30040), NKBIP-08 tags are automatically assigned based on the document hierarchy:

- **C tag (collection_id)**: Optional, set in root 30040 metadata. If set, inherited by all events in the hierarchy. Use for compendiums, digests, or libraries of related books (e.g., "bible", "goethe-complete-works", "encyclopedia-britannica").
- **T tag (title_id)**: Always set from root 30040 book title, inherited by all nested events.
- **c tag (chapter_id)**: 
  - Two-level structure: from 30041 chapter title (chapters are 30041 events)
  - Three-level structure: from parent 30040 chapter title
- **s tag (section_id)**: Only in three-level structures, from 30041 section title
- **v tag (version_tag)**: If set in root 30040, inherited by all events in the hierarchy

All tag values are normalized per NKBIP-08 spec (lowercase, hyphens, numbers only).

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

- **Stand-alone 30041**: Uses NKBIP-01 tags (d, title, image, summary, topics) plus automatically-generated `published_at`
- **Nested 30041** (under 30040): Uses NKBIP-08 tags plus automatically-generated `published_at`
  - **Two-level structure** (book + chapters): 30041 events are chapters (c tag from chapter title, no s tag)
  - **Three-level structure** (book + chapters + sections): 30041 events are sections (c tag from parent chapter, s tag from section title)
  - All nested 30041 events inherit C tag (collection_id) and v tag (version_tag) from root 30040
  - All nested 30041 events get T tag (title_id) from root 30040 book title

## Metadata Fields

All predefined metadata fields are shown in frontmatter/attributes with placeholder descriptions. Remove or update placeholders you don't need. Placeholder values are automatically skipped when creating events.

**Important**: The `published_at` tag is automatically generated with the current UNIX timestamp during event creation for all replaceable event kinds (all event kinds supported by this plugin). Do not include `published_at` in your metadata - it will be automatically added and any existing `published_at` values in metadata will be ignored.

### Common Fields

- `kind` - Event kind (required)
- `title` - Document title (required for all except kind 1)
- `author` - Author name
- `summary` - Brief description
- `topics` - Comma-separated topics (available for all event kinds)
- `image` - Image URL (available for 30023, 30040, 30041, 30817, 30818)

### Kind-Specific Fields

**30023 (Article)**:
- No additional fields beyond common ones

**30040 (Publication Index)**:
- `type` - Publication type (book, illustrated, magazine, documentation, academic, blog)
- `version` - Version or edition
- `published_on` - Publication date
- `published_by` - Publisher
- `source` - Source URL
- `auto_update` - Auto-update behavior (yes, ask, no)
- `collection_id` - NKBIP-08 collection identifier (C tag) - **Optional**: compendium, digest, or library of related books (e.g., "bible", "goethe-complete-works", "encyclopedia-britannica"). If set in root 30040, inherited by all events in the hierarchy.
- `version_tag` - NKBIP-08 version identifier (v tag) - If set in root 30040, inherited by all events in the hierarchy

**30041 (Publication Content)**:
- **Stand-alone**: Same as 30023 (image, summary, topics)
- **Nested** (under 30040): NKBIP-08 tags
  - `collection_id` - Inherited from root 30040 (C tag)
  - `title_id` - From root 30040 book title (T tag)
  - `chapter_id` - From chapter title (c tag)
    - Two-level: from 30041's own title (it is the chapter)
    - Three-level: from parent 30040's title
  - `section_id` - From 30041's title (s tag) - Only in three-level structures
  - `version_tag` - Inherited from root 30040 (v tag)

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
