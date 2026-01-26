# Scriptorium Nostr

An Obsidian plugin for creating, editing, and publishing Nostr document events directly from your vault.

**Author**: Silberengel  
**Homepage**: https://gitcitadel.com  
**Funding**: gitcitadel@getalby.com

## Features

- **Multiple Event Kinds**: Support for Markdown-formatted kinds (1, 11, 30023, 30817) and Asdciidoc-formatted kinds (30040, 30041, 30818).
- **Bookstr Support**: Automatic parsing and splitting of e-books/publications into nested 30040/30041 structures
- **Metadata Management**: YAML metadata files with validation per event kind
- **Structure Preview**: Visual preview of publication structure before creating events
- **Two-Step Workflow**: Create and sign events separately from publishing
- **Relay Management**: Automatic fetching of relay lists (kind 10002) with AUTH support
- **d-tag Normalization**: Automatic NIP-54 compliant d-tag generation from titles

## Installation

### Manual Installation

1. Clone this repository
2. Run `npm install`.obsidian/plugins/scriptorium-obsidian/
3. Run `npm run build`
4. Create the plugin directory in your Obsidian vault (if it doesn't exist):
   - Navigate to your vault's root directory
   - Create `.obsidian/plugins/scriptorium-obsidian/` directory
5. Copy the `main.js` and `manifest.json` files to `.obsidian/plugins/scriptorium-obsidian/`
6. Reload Obsidian and enable the plugin in Settings → Community Plugins

**Note**: The `.obsidian` folder is hidden by default. You may need to show hidden files in your file manager to see it.

## Setup

### Private Key Configuration

You have three options to set your private key:

**Option 1: Manual Entry (Easiest)**
1. Open Obsidian settings → Scriptorium Nostr
2. Enter your private key in the password field
3. Click "Set Key"

**Option 2: File in Vault (Most Reliable)**
1. Create a file named `.scriptorium_key` in your vault root
2. Put your private key on a single line (nsec1... or 64-char hex)
3. Open plugin settings and click "Refresh"

**Option 3: Environment Variable**
1. Set `SCRIPTORIUM_OBSIDIAN_KEY` in your terminal:
   ```bash
   export SCRIPTORIUM_OBSIDIAN_KEY="nsec1..."
   ```
2. **Important:** Launch Obsidian from the same terminal:
   ```bash
   obsidian
   ```
   (If Obsidian is already running, close it and restart from the terminal)
3. Open plugin settings → Scriptorium Nostr
4. Click "Refresh" to load your private key

**Note:** Environment variables are only available to processes launched from the terminal where they were set. If you launch Obsidian from a desktop shortcut or application menu, it won't have access to the environment variable. You must launch Obsidian from the terminal where you set the variable.

See [ENV_SETUP.md](ENV_SETUP.md) for detailed instructions on setting environment variables.

**Key Format:** `nsec1...` (bech32) or 64-character hex string

### Relay Configuration

1. Open Obsidian settings → Scriptorium Nostr
2. Click "Fetch" to get your relay list from Nostr relays
3. The plugin will automatically fetch from `wss://profiles.nostr1.com`, `wss://relay.damus.io`, and `wss://thecitadel.nostr1.com`

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

## Author

**Silberengel**  
- Homepage: https://gitcitadel.com
- Funding: gitcitadel@getalby.com