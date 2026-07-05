#!/bin/bash

# Script to build, install, and start Obsidian with the Scriptorium plugin
# Usage: ./start-obsidian.sh [path-to-obsidian-vault]
# On first run, path is required. Subsequent runs will use the saved path.

set -e  # Exit on error

# Function to show help
show_help() {
    cat << EOF
Scriptorium Nostr - Obsidian Plugin Startup Script

USAGE:
    $0 [OPTIONS] [vault-path]

OPTIONS:
    -h, --help          Show this help message
    --generate-key      Generate a new Nostr private key

ARGUMENTS:
    vault-path          Path to your Obsidian vault folder
                        Required on first run, optional afterwards

EXAMPLES:
    $0 ~/Documents/MyVault          # First run
    $0                              # Use saved vault path
    $0 --generate-key               # Generate new Nostr key
    $0 --help                       # Show this help

WHAT THIS SCRIPT DOES:
    1. Installs npm dependencies (if needed)
    2. Builds the Scriptorium plugin
    3. Installs plugin to your vault
    4. Installs obsidian-asciidoc plugin (for .adoc files)
    5. Starts Obsidian with console logging

NOTES:
    • Vault path is saved after first run
    • obsidian-asciidoc is installed automatically
    • Plugin logs appear in this terminal
    • Press Ctrl+C to stop Obsidian
EOF
    exit 0
}

# Check for help flag
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
fi

# Check for generate-key flag
GENERATE_KEY=false
if [ "$1" = "--generate-key" ]; then
    GENERATE_KEY=true
    # Remove the flag from arguments
    shift
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT_CONFIG_FILE="${SCRIPT_DIR}/.scriptorium-vault-path"

# Function to check if a vault path is valid
is_valid_vault_path() {
    local path="$1"
    # Empty path is invalid
    if [ -z "$path" ]; then
        return 1
    fi
    # Check if path exists as a directory, or if parent directory exists (so we can create it)
    if [ -d "$path" ]; then
        return 0
    elif [ -d "$(dirname "$path" 2>/dev/null)" ]; then
        # Parent exists, so we can create the vault directory
        return 0
    fi
    return 1
}

# Function to load saved vault path
load_vault_path() {
    if [ -f "$VAULT_CONFIG_FILE" ]; then
        local saved_path=$(cat "$VAULT_CONFIG_FILE" | head -n 1 | tr -d '\n\r')
        if [ -n "$saved_path" ] && is_valid_vault_path "$saved_path"; then
            echo "$saved_path"
            return 0
        fi
    fi
    return 1
}

# Function to save vault path
save_vault_path() {
    local path="$1"
    echo "$path" > "$VAULT_CONFIG_FILE"
    echo "[Scriptorium] Saved vault path to $VAULT_CONFIG_FILE"
}

# Function to expand and resolve a vault path safely (no eval)
expand_vault_path() {
    local path="$1"
    if [[ "$path" == "~/"* ]]; then
        path="${HOME}/${path:2}"
    elif [[ "$path" == "~" ]]; then
        path="$HOME"
    fi
    if [ -d "$path" ]; then
        (cd "$path" && pwd)
    elif [ -d "$(dirname "$path")" ]; then
        echo "$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
    else
        echo "$path"
    fi
}

# Function to generate a new Nostr private key
generate_nostr_key() {
    echo "[Scriptorium] Generating new Nostr private key..."
    
    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        echo "Error: Node.js is required to generate a Nostr key"
        echo "Please install Node.js and try again"
        exit 1
    fi
    
    # Generate key using Node.js and nostr-tools
    local temp_script
    temp_script=$(mktemp)
    cat > "$temp_script" << 'NODE_SCRIPT'
const { generateSecretKey, getPublicKey, nip19 } = require('nostr-tools');

try {
    const privkeyBytes = generateSecretKey();
    const pubkey = getPublicKey(privkeyBytes);
    const nsec = nip19.nsecEncode(privkeyBytes);
    const npub = nip19.npubEncode(pubkey);
    const hex = Array.from(privkeyBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    console.log(JSON.stringify({
        nsec: nsec,
        hex: hex,
        npub: npub,
        pubkey: pubkey
    }));
} catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
}
NODE_SCRIPT
    
    # Run the script from the repo directory so nostr-tools resolves
    local key_data
    key_data=$(cd "$SCRIPT_DIR" && node "$temp_script" 2>/dev/null)
    rm -f "$temp_script"
    
    if [ -z "$key_data" ] || echo "$key_data" | grep -q '"error"'; then
        echo "Error: Failed to generate Nostr key"
        echo "Make sure nostr-tools is installed: npm install"
        exit 1
    fi
    
    # Parse the JSON output
    local nsec=$(echo "$key_data" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.nsec)")
    local npub=$(echo "$key_data" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.npub)")
    
    echo ""
    echo "Generated new Nostr key:"
    echo "  Public key (npub): $npub"
    echo ""
    echo "To use this key, add to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo "  export SCRIPTORIUM_OBSIDIAN_KEY=\"$nsec\""
    echo ""
    echo "Then restart your shell or run: source ~/.bashrc"
    echo ""
    echo "⚠️  Keep your private key secure! Do not share it with anyone."
}

# If generating key, handle it separately (no vault path needed)
if [ "$GENERATE_KEY" = true ]; then
    cd "$SCRIPT_DIR"
    generate_nostr_key
    exit 0
fi

# Determine vault path
VAULT_PATH=""

# If path is provided as argument, use it
if [ -n "$1" ]; then
    VAULT_PATH="$(expand_vault_path "$1")"
    
    # Validate provided path
    if ! is_valid_vault_path "$VAULT_PATH"; then
        echo "Error: Invalid vault path: $VAULT_PATH"
        echo "Please provide a valid path to your Obsidian vault folder"
        exit 1
    fi
    
    # Save the path for next time
    save_vault_path "$VAULT_PATH"
    echo "[Scriptorium] Using vault path: $VAULT_PATH"
else
    # Try to load saved path
    # Use || true to prevent set -e from exiting if load_vault_path fails
    SAVED_PATH=$(load_vault_path || true)
    if [ -n "$SAVED_PATH" ]; then
        # Re-validate the saved path
        if is_valid_vault_path "$SAVED_PATH"; then
            VAULT_PATH="$SAVED_PATH"
            echo "[Scriptorium] Using saved vault path: $VAULT_PATH"
        else
            echo "Error: Saved vault path is no longer valid: $SAVED_PATH"
            echo ""
            echo "Please provide a new vault path:"
            echo "  $0 ~/Documents/MyVault"
            echo ""
            echo "Run '$0 --help' for more information"
            exit 1
        fi
    else
        echo "Error: No vault path provided"
        echo ""
        echo "First run requires a vault path:"
        echo "  $0 ~/Documents/MyVault"
        echo ""
        echo "The path will be saved for future runs."
        echo "Run '$0 --help' for more information"
        exit 1
    fi
fi

# Final validation
if [ -z "$VAULT_PATH" ]; then
    echo "Error: Could not determine vault path"
    exit 1
fi
OBSIDIAN_FOLDER="${VAULT_PATH}/.obsidian"
PLUGIN_FOLDER="${OBSIDIAN_FOLDER}/plugins/scriptorium-obsidian"

# Change to script directory
cd "$SCRIPT_DIR"

echo "[Scriptorium] Starting build and install process..."
echo "[Scriptorium] Vault path: $VAULT_PATH"
echo "[Scriptorium] Plugin folder: $PLUGIN_FOLDER"

# Check if npm dependencies need to be installed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --silent
    if [ $? -ne 0 ]; then
        echo "Error: npm install failed"
        exit 1
    fi
    echo "✓ Dependencies installed"
else
    echo "✓ Dependencies up to date"
fi

# Create necessary directories
mkdir -p "$PLUGIN_FOLDER"

# Build the plugin
echo "Building plugin..."
npm run build --silent 2>&1 | grep -v "^$" || true

# Check if build was successful
if [ ! -f "main.js" ] || [ ! -f "manifest.json" ]; then
    echo "Error: Build failed - main.js or manifest.json not found"
    exit 1
fi

# Copy plugin files
cp "main.js" "${PLUGIN_FOLDER}/main.js"
cp "manifest.json" "${PLUGIN_FOLDER}/manifest.json"
echo "✓ Plugin installed"

# Function to enable a plugin in Obsidian
enable_plugin() {
    local plugin_id="$1"
    local plugins_json="${OBSIDIAN_FOLDER}/community-plugins.json"
    
    # Create plugins JSON file if it doesn't exist
    if [ ! -f "$plugins_json" ]; then
        echo "[]" > "$plugins_json"
    fi
    
    # Check if plugin is already enabled
    if grep -q "\"$plugin_id\"" "$plugins_json" 2>/dev/null; then
        return 0
    fi
    
    # Add plugin to enabled list using Node.js or Python
    if command -v node &> /dev/null; then
        ENABLE_PLUGINS_JSON="$plugins_json" ENABLE_PLUGIN_ID="$plugin_id" node <<'NODE_SCRIPT'
const fs = require('fs');
const pluginsJson = process.env.ENABLE_PLUGINS_JSON;
const pluginId = process.env.ENABLE_PLUGIN_ID;
let plugins = [];
try {
    const content = fs.readFileSync(pluginsJson, 'utf8');
    plugins = JSON.parse(content);
} catch (e) {
    plugins = [];
}
if (!Array.isArray(plugins)) {
    plugins = [];
}
if (!plugins.includes(pluginId)) {
    plugins.push(pluginId);
    fs.writeFileSync(pluginsJson, JSON.stringify(plugins, null, 2));
    console.log('Enabled plugin: ' + pluginId);
}
NODE_SCRIPT
        if [ $? -ne 0 ]; then
            echo "Warning: Could not enable plugin $plugin_id automatically"
        fi
    elif command -v python3 &> /dev/null; then
        ENABLE_PLUGINS_JSON="$plugins_json" ENABLE_PLUGIN_ID="$plugin_id" python3 <<'PYTHON_SCRIPT'
import json
import os
plugins_json = os.environ['ENABLE_PLUGINS_JSON']
plugin_id = os.environ['ENABLE_PLUGIN_ID']
try:
    with open(plugins_json, 'r') as f:
        plugins = json.load(f)
except:
    plugins = []
if not isinstance(plugins, list):
    plugins = []
if plugin_id not in plugins:
    plugins.append(plugin_id)
    with open(plugins_json, 'w') as f:
        json.dump(plugins, f, indent=2)
    print(f'Enabled plugin: {plugin_id}')
PYTHON_SCRIPT
        if [ $? -ne 0 ]; then
            echo "Warning: Could not enable plugin $plugin_id automatically"
        fi
    else
        echo "Warning: Node.js or Python3 required to auto-enable plugins"
        echo "Please enable $plugin_id manually in Obsidian settings"
    fi
}

# Enable scriptorium-obsidian plugin
enable_plugin "scriptorium-obsidian" > /dev/null 2>&1

# Install obsidian-asciidoc plugin (required for .adoc file support)
ASCIIDOC_PLUGIN_DIR="${OBSIDIAN_FOLDER}/plugins/obsidian-asciidoc"
ASCIIDOC_PLUGIN_REPO="https://github.com/dzruyk/obsidian-asciidoc.git"

echo "Installing obsidian-asciidoc plugin..."

if [ -d "$ASCIIDOC_PLUGIN_DIR" ]; then
    cd "$ASCIIDOC_PLUGIN_DIR"
    if [ -d ".git" ]; then
        git pull --quiet 2>/dev/null || true
        if [ -f "package.json" ]; then
            npm install --silent > /dev/null 2>&1 && npm run build --silent > /dev/null 2>&1 || true
        fi
    fi
    cd "$SCRIPT_DIR"
    ASCIIDOC_PLUGIN_ID=$(node -e "const m=require('${ASCIIDOC_PLUGIN_DIR}/manifest.json'); console.log(m.id)" 2>/dev/null || echo "obsidian-asciidoc")
    enable_plugin "$ASCIIDOC_PLUGIN_ID" > /dev/null 2>&1
    echo "✓ obsidian-asciidoc plugin ready"
else
    if command -v git &> /dev/null; then
        git clone --quiet "$ASCIIDOC_PLUGIN_REPO" "$ASCIIDOC_PLUGIN_DIR" 2>/dev/null || {
            echo "Error: Could not clone obsidian-asciidoc plugin"
            echo "Make sure git is installed and you have internet access"
            exit 1
        }
        
        if [ -d "$ASCIIDOC_PLUGIN_DIR" ]; then
            cd "$ASCIIDOC_PLUGIN_DIR"
            if [ -f "package.json" ]; then
                npm install --silent > /dev/null 2>&1 && npm run build --silent > /dev/null 2>&1 || {
                    echo "Error: Could not build obsidian-asciidoc plugin"
                    exit 1
                }
            fi
            cd "$SCRIPT_DIR"
            
            if [ -f "${ASCIIDOC_PLUGIN_DIR}/main.js" ] && [ -f "${ASCIIDOC_PLUGIN_DIR}/manifest.json" ]; then
                ASCIIDOC_PLUGIN_ID=$(node -e "const m=require('${ASCIIDOC_PLUGIN_DIR}/manifest.json'); console.log(m.id)" 2>/dev/null || echo "obsidian-asciidoc")
                enable_plugin "$ASCIIDOC_PLUGIN_ID" > /dev/null 2>&1
                echo "✓ obsidian-asciidoc plugin installed"
            else
                echo "Error: Plugin files not found after installation"
                exit 1
            fi
        fi
    else
        echo "Error: git is required to install obsidian-asciidoc plugin"
        exit 1
    fi
fi

# Start Obsidian
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Obsidian..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Try to find Obsidian command
if command -v obsidian &> /dev/null; then
    obsidian "$VAULT_PATH" &
    echo "Obsidian started (PID: $!)"
    echo "Plugin logs will appear in this terminal"
    echo "Press Ctrl+C to stop"
    wait
elif command -v flatpak &> /dev/null && flatpak list | grep -q "md.obsidian"; then
    flatpak run md.obsidian.Obsidian "$VAULT_PATH" &
    echo "Obsidian started via Flatpak (PID: $!)"
    echo "Plugin logs will appear in this terminal"
    echo "Press Ctrl+C to stop"
    wait
else
    echo "Error: Could not find Obsidian"
    echo "Please install Obsidian or start manually:"
    echo "  obsidian \"$VAULT_PATH\""
    exit 1
fi
