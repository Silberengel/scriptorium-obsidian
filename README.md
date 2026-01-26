# Scriptorium Obsidian Plugin

An Obsidian plugin for creating, editing, and publishing Nostr document events directly from your vault.

## Features

- **Multiple Event Kinds**: Support for kinds 1, 11, 30023, 30040, 30041, 30817, 30818
- **AsciiDoc Support**: Automatic parsing and splitting of AsciiDoc documents into nested 30040/30041 structures
- **Metadata Management**: YAML metadata files with validation per event kind
- **Structure Preview**: Visual preview of document structure before creating events
- **Two-Step Workflow**: Create and sign events separately from publishing
- **Relay Management**: Automatic fetching of relay lists (kind 10002) with AUTH support
- **d-tag Normalization**: Automatic NIP-54 compliant d-tag generation from titles

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run build`
4. Copy the `main.js`, `manifest.json`, and `styles.css` (if any) to your Obsidian vault's `.obsidian/plugins/scriptorium-obsidian/` directory

## Setup

1. Set your Nostr private key in the environment variable `SCRIPTORIUM_OBSIDIAN_KEY`:
   - Format: `nsec1...` (bech32) or 64-character hex string
2. Open Obsidian settings → Scriptorium Nostr
3. Click "Refresh from Env" to load your private key
4. Click "Fetch" to get your relay list from Nostr relays

## Usage

### Creating Events

1. Open a Markdown or AsciiDoc file
2. Run command: `Create Nostr Events`
3. If metadata doesn't exist, it will be created with defaults
4. For AsciiDoc documents with structure (`= Title`), a preview will be shown
5. Events are created, signed, and saved to `{filename}_events.jsonl`

### Editing Metadata

1. Open a file
2. Run command: `Edit Metadata`
3. Fill in the metadata form
4. Save

### Publishing Events

1. Ensure events have been created (check for `{filename}_events.jsonl`)
2. Run command: `Publish Events to Relays`
3. Events will be published to all configured write relays

### Previewing Structure

1. Open an AsciiDoc file with structure
2. Run command: `Preview Document Structure`
3. Review the event hierarchy before creating

## File Formats

- **Markdown** (`.md`): Kinds 1, 11, 30023, 30817
- **AsciiDoc** (`.adoc`, `.asciidoc`): Kinds 30041, 30818
- **AsciiDoc with Structure** (starts with `= Title`): Kind 30040 with nested 30041 events

## Metadata Files

Metadata is stored as `{filename}_metadata.yml` in the same directory as the document.

For 30040 events, the title is derived from the document header (`= Title`) but can be overridden in the metadata file.

## Commands

- `Create Nostr Events` - Create and sign events from current file
- `Preview Document Structure` - Show event hierarchy preview
- `Publish Events to Relays` - Publish from .jsonl file to relays
- `Edit Metadata` - Open metadata form for current file

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

## License

MIT
