# Scriptorium Nostr

An Obsidian plugin for creating, editing, and publishing Nostr document events directly from your vault.

**Author**: Silberengel  
**Homepage of our development project**: https://gitcitadel.com  
**Happy to receive Bitcoin-tips to our Lightning wallet**: gitcitadel@getalby.com

## Features

- Multiple event kinds: Markdown (1, 11, 30023, 30817) and AsciiDoc (30040, 30041, 30818) formats
- Automatic book/publication parsing into nested 30040/30041 structures
- YAML metadata management with validation
- Structure preview before creating events
- Two-step workflow: create/sign events separately from publishing
- Automatic relay list fetching (kind 10002) with AUTH support
- NIP-54 compliant d-tag normalization

## Installation

### Quick Start

Use the startup script to build, install, and launch Obsidian:

```bash
# First run (path required)
./start-obsidian.sh ~/Documents/MyVault

# Subsequent runs (path is saved)
./start-obsidian.sh
```

The script automatically:
- Installs npm dependencies
- Builds and installs the plugin
- Installs and enables obsidian-asciidoc (required for `.adoc` files)
- Starts Obsidian with console logging

**Generate a new Nostr key:**
```bash
./start-obsidian.sh --generate-key
```
Add the shown export command to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.).

### Manual Installation

1. Clone repo → `npm install` → `npm run build`
2. Copy `main.js` and `manifest.json` to `.obsidian/plugins/scriptorium-obsidian/`
3. Enable in Obsidian Settings → Community Plugins
4. Install [obsidian-asciidoc](https://github.com/dzruyk/obsidian-asciidoc) plugin (required for `.adoc` files)

## Setup

### Private Key

The plugin only loads keys from the `SCRIPTORIUM_OBSIDIAN_KEY` environment variable:

```bash
# Set in terminal
export SCRIPTORIUM_OBSIDIAN_KEY="nsec1..."

# Make permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export SCRIPTORIUM_OBSIDIAN_KEY="nsec1..."' >> ~/.bashrc
```

**Important:** Launch Obsidian from the terminal where the variable is set, or use the startup script. Desktop shortcuts won't have access to the variable.

### Relays

1. Open Settings → Scriptorium Nostr
2. Click "Fetch" to get your relay list from Nostr relays
3. Relays are automatically fetched from default relays

## Usage

### Creating Events

1. Open a Markdown or AsciiDoc file
2. Run: `Create Nostr Events`
3. Events are created, signed, and saved to `{filename}_events.jsonl`

### Publishing

1. Ensure events exist (`{filename}_events.jsonl`)
2. Run: `Publish Events to Relays`
3. Events publish to all configured write relays

### Other Commands

- `Edit Metadata` - Open metadata form for current file
- `Preview Document Structure` - Show event hierarchy (AsciiDoc only)

## File Formats

- **Markdown** (`.md`): Kinds 1, 11, 30023, 30817
- **AsciiDoc** (`.adoc`): Kinds 30040, 30041, 30818
- **Structured AsciiDoc** (starts with `= Title`): Kind 30040 with nested 30041 events

Metadata is stored as `{filename}_metadata.yml` in the same directory.

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

## License

MIT
