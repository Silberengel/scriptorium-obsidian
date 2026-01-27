#!/bin/bash

# Script to build, install, and start Obsidian with the Scriptorium plugin
# Usage: ./start-obsidian.sh [path-to-obsidian-vault]
# On first run, path is required. Subsequent runs will use the saved path.

set -e  # Exit on error

# Function to show help
show_help() {
    cat << EOF
Scriptorium Obsidian Plugin - Startup Script

USAGE:
    $0 [OPTIONS] [path-to-obsidian-vault]

OPTIONS:
    -h, --help      Show this help message and exit
    --generate-key  Generate a new Nostr private key
                    The key will be shown for you to save as an environment variable
                    (most secure option - hides key from GUI)

ARGUMENTS:
    path-to-obsidian-vault
                    Path to your Obsidian vault (the folder containing .obsidian)
                    Required on first run. Optional on subsequent runs.
                    Note: The .obsidian folder may be hidden in your file manager.

EXAMPLES:
    # First run (path required):
    $0 ~/Documents/MyVault

    # Subsequent runs (uses saved path):
    $0

    # Change to a different vault:
    $0 ~/Documents/NewVault

    # Generate a new Nostr private key:
    $0 --generate-key [vault-path]

    # Show help:
    $0 --help

DESCRIPTION:
    This script will:
    1. Install npm dependencies (if needed)
    2. Build the Scriptorium plugin
    3. Install it to your Obsidian vault's plugin folder
    4. Install and enable the obsidian-asciidoc plugin (required for .adoc files)
    5. Start Obsidian with console logging enabled
    
    Note: The obsidian-asciidoc plugin is required for this plugin to work properly
    with .adoc files. It will be installed and enabled automatically.

    On first run, you must provide the vault path. The path will be saved
    to .scriptorium-vault-path for future use.

    If the saved path becomes invalid (vault moved/deleted), you'll be
    prompted to provide a new path.

    The obsidian-asciidoc plugin is recommended for editing .adoc files
    in Obsidian without crashes. It provides proper syntax highlighting
    and editing support.

NOTES:
    - The vault path is the folder containing the .obsidian directory
    - The .obsidian folder may be hidden in your file manager (enable "Show hidden files")
    - Plugin logs will appear in this terminal
    - Press Ctrl+C to stop Obsidian
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
    # We'll use a temporary script to generate the key
    local temp_script=$(mktemp)
    cat > "$temp_script" << 'NODE_SCRIPT'
const { generatePrivateKey, getPublicKey } = require('nostr-tools');
const { nip19 } = require('nostr-tools');

try {
    // Generate a new private key (32 bytes, hex encoded)
    const privkey = generatePrivateKey();
    
    // Get the public key to verify
    const pubkey = getPublicKey(privkey);
    
    // Encode as nsec1 (bech32)
    const nsec = nip19.nsecEncode(privkey);
    const npub = nip19.npubEncode(pubkey);
    
    // Output both formats
    console.log(JSON.stringify({
        nsec: nsec,
        hex: privkey,
        npub: npub,
        pubkey: pubkey
    }));
} catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
}
NODE_SCRIPT
    
    # Run the script
    local key_data=$(node "$temp_script" 2>/dev/null)
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
    echo "To use this key, set it as an environment variable:"
    echo ""
    echo "  export SCRIPTORIUM_OBSIDIAN_KEY=\"$nsec\""
    echo ""
    echo "Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.) to make it permanent:"
    echo "  export SCRIPTORIUM_OBSIDIAN_KEY=\"$nsec\""
    echo ""
    echo "Then launch Obsidian from that terminal (or restart your shell) to use the key, by typing 'obsidian' or './start-obsidian.sh'."
    echo ""
    echo "Note: The private key is hidden from the GUI for security. Only the public key (npub) is shown."
    echo "To view the private key, you can use the following command:"
    echo ""
    echo "  echo $nsec"
    echo ""
    echo "This will show the private key in clear text."
    echo "Remember: The private key is only visible in the terminal and will not be available, unless you save it as an environment variable. Do not share it with anyone!"
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
    VAULT_PATH="$1"
    # Expand ~ and resolve relative paths
    VAULT_PATH=$(eval echo "$VAULT_PATH")
    # Try to resolve to absolute path
    if [ -d "$VAULT_PATH" ]; then
        VAULT_PATH=$(cd "$VAULT_PATH" && pwd)
    elif [ -d "$(dirname "$VAULT_PATH")" ]; then
        # Parent exists, resolve parent and append basename
        VAULT_PATH=$(cd "$(dirname "$VAULT_PATH")" && pwd)/$(basename "$VAULT_PATH")
    else
        # Can't resolve, use as-is
        VAULT_PATH="$VAULT_PATH"
    fi
    
    # Validate provided path
    if ! is_valid_vault_path "$VAULT_PATH"; then
        echo "Error: The provided path does not appear to be valid: $VAULT_PATH"
        echo "Please provide a valid path to your Obsidian vault"
        echo "Note: The .obsidian folder may be hidden in your file manager."
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
            echo "The vault may have been moved or deleted. Please provide a new vault path:"
            echo ""
            echo "Usage: $0 <path-to-obsidian-vault>"
            echo "Example: $0 ~/Documents/MyVault"
            echo ""
            echo "Note: The .obsidian folder may be hidden in your file manager."
            echo "For more information, run: $0 --help"
            exit 1
        fi
    else
        echo "Error: No vault path provided and no saved path found"
        echo ""
        echo "This appears to be your first run. Please provide the path to your Obsidian vault:"
        echo ""
        echo "Usage: $0 <path-to-obsidian-vault>"
        echo "Example: $0 ~/Documents/MyVault"
        echo ""
        echo "The vault path is the folder containing the .obsidian directory."
        echo "Note: The .obsidian folder may be hidden in your file manager (enable 'Show hidden files')."
        echo "After the first run, the path will be saved and you won't need to provide it again."
        echo ""
        echo "For more information, run: $0 --help"
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
    echo "[Scriptorium] Installing npm dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: npm install failed"
        exit 1
    fi
    echo "[Scriptorium] Dependencies installed successfully"
else
    echo "[Scriptorium] Dependencies are up to date"
fi

# Create .obsidian folder if it doesn't exist
if [ ! -d "$OBSIDIAN_FOLDER" ]; then
    echo "[Scriptorium] Creating .obsidian folder..."
    mkdir -p "$OBSIDIAN_FOLDER"
fi

# Create plugins folder if it doesn't exist
if [ ! -d "${OBSIDIAN_FOLDER}/plugins" ]; then
    echo "[Scriptorium] Creating plugins folder..."
    mkdir -p "${OBSIDIAN_FOLDER}/plugins"
fi

# Create plugin directory if it doesn't exist
if [ ! -d "$PLUGIN_FOLDER" ]; then
    echo "[Scriptorium] Creating plugin directory..."
    mkdir -p "$PLUGIN_FOLDER"
fi

# Build the plugin
echo "[Scriptorium] Building plugin..."
npm run build

# Check if build was successful
if [ ! -f "main.js" ] || [ ! -f "manifest.json" ]; then
    echo "Error: Build failed - main.js or manifest.json not found"
    exit 1
fi

# Function to check if file needs to be copied
needs_copy() {
    local source_file="$1"
    local dest_file="$2"
    
    # If destination doesn't exist, we need to copy
    if [ ! -f "$dest_file" ]; then
        return 0  # true - needs copy
    fi
    
    # If source is newer than destination, we need to copy
    if [ "$source_file" -nt "$dest_file" ]; then
        return 0  # true - needs copy
    fi
    
    return 1  # false - no copy needed
}

# Copy main.js if needed
if needs_copy "main.js" "${PLUGIN_FOLDER}/main.js"; then
    echo "[Scriptorium] Copying main.js to plugin folder..."
    cp "main.js" "${PLUGIN_FOLDER}/main.js"
else
    echo "[Scriptorium] main.js is up to date, skipping copy"
fi

# Copy manifest.json if needed
if needs_copy "manifest.json" "${PLUGIN_FOLDER}/manifest.json"; then
    echo "[Scriptorium] Copying manifest.json to plugin folder..."
    cp "manifest.json" "${PLUGIN_FOLDER}/manifest.json"
else
    echo "[Scriptorium] manifest.json is up to date, skipping copy"
fi

echo "[Scriptorium] Plugin installed successfully!"

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
        echo "[Scriptorium] Plugin $plugin_id is already enabled"
        return 0
    fi
    
    # Add plugin to enabled list using Node.js or Python
    if command -v node &> /dev/null; then
        # Use Node.js to update JSON
        node << NODE_SCRIPT
const fs = require('fs');
const pluginsJson = '${plugins_json}';
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
if (!plugins.includes('${plugin_id}')) {
    plugins.push('${plugin_id}');
    fs.writeFileSync(pluginsJson, JSON.stringify(plugins, null, 2));
    console.log('Enabled plugin: ${plugin_id}');
}
NODE_SCRIPT
        if [ $? -eq 0 ]; then
            echo "[Scriptorium] Enabled plugin: $plugin_id"
        else
            echo "[Scriptorium] Warning: Could not enable plugin $plugin_id automatically"
        fi
    elif command -v python3 &> /dev/null; then
        # Fallback to Python
        python3 << PYTHON_SCRIPT
import json
import os
plugins_json = '${plugins_json}'
plugin_id = '${plugin_id}'
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
        if [ $? -eq 0 ]; then
            echo "[Scriptorium] Enabled plugin: $plugin_id"
        else
            echo "[Scriptorium] Warning: Could not enable plugin $plugin_id automatically"
        fi
    else
        echo "[Scriptorium] Warning: Node.js or Python3 required to auto-enable plugins"
        echo "[Scriptorium] Please enable $plugin_id manually in Obsidian settings"
    fi
}

# Enable scriptorium-obsidian plugin
echo "[Scriptorium] Enabling scriptorium-obsidian plugin..."
enable_plugin "scriptorium-obsidian"

# Install obsidian-asciidoc plugin (required for .adoc file support)
ASCIIDOC_PLUGIN_DIR="${OBSIDIAN_FOLDER}/plugins/obsidian-asciidoc"
ASCIIDOC_PLUGIN_REPO="https://github.com/dzruyk/obsidian-asciidoc.git"

echo "[Scriptorium] Installing obsidian-asciidoc plugin (required for .adoc files)..."

if [ -d "$ASCIIDOC_PLUGIN_DIR" ]; then
    echo "[Scriptorium] obsidian-asciidoc plugin already exists, updating..."
    cd "$ASCIIDOC_PLUGIN_DIR"
    if [ -d ".git" ]; then
        git pull || echo "[Scriptorium] Warning: Could not update plugin (git pull failed)"
        # Rebuild after update
        if [ -f "package.json" ]; then
            echo "[Scriptorium] Rebuilding obsidian-asciidoc plugin..."
            npm install && npm run build || {
                echo "[Scriptorium] Warning: Could not rebuild obsidian-asciidoc plugin"
            }
        fi
    else
        echo "[Scriptorium] Warning: Plugin directory exists but is not a git repository"
    fi
    cd "$SCRIPT_DIR"
    
    # Ensure plugin is enabled
    ASCIIDOC_PLUGIN_ID=$(node -e "const m=require('${ASCIIDOC_PLUGIN_DIR}/manifest.json'); console.log(m.id)" 2>/dev/null || echo "obsidian-asciidoc")
    enable_plugin "$ASCIIDOC_PLUGIN_ID"
else
    echo "[Scriptorium] Cloning obsidian-asciidoc plugin..."
    if command -v git &> /dev/null; then
        git clone "$ASCIIDOC_PLUGIN_REPO" "$ASCIIDOC_PLUGIN_DIR" || {
            echo "[Scriptorium] Error: Could not clone obsidian-asciidoc plugin"
            echo "[Scriptorium] Make sure git is installed and you have internet access"
            exit 1
        }
        
        if [ -d "$ASCIIDOC_PLUGIN_DIR" ]; then
            echo "[Scriptorium] Building obsidian-asciidoc plugin..."
            cd "$ASCIIDOC_PLUGIN_DIR"
            if [ -f "package.json" ]; then
                npm install && npm run build || {
                    echo "[Scriptorium] Error: Could not build obsidian-asciidoc plugin"
                    echo "[Scriptorium] Check the error messages above"
                    exit 1
                }
            else
                echo "[Scriptorium] Warning: No package.json found in obsidian-asciidoc plugin"
            fi
            cd "$SCRIPT_DIR"
            
            # Verify installation
            if [ -f "${ASCIIDOC_PLUGIN_DIR}/main.js" ] && [ -f "${ASCIIDOC_PLUGIN_DIR}/manifest.json" ]; then
                echo "[Scriptorium] obsidian-asciidoc plugin installed successfully!"
                
                # Get plugin ID from manifest.json
                ASCIIDOC_PLUGIN_ID=$(node -e "const m=require('${ASCIIDOC_PLUGIN_DIR}/manifest.json'); console.log(m.id)" 2>/dev/null || echo "obsidian-asciidoc")
                
                # Enable the plugin
                echo "[Scriptorium] Enabling obsidian-asciidoc plugin..."
                enable_plugin "$ASCIIDOC_PLUGIN_ID"
            else
                echo "[Scriptorium] Error: Plugin files not found after installation"
                echo "[Scriptorium] main.js or manifest.json missing in ${ASCIIDOC_PLUGIN_DIR}"
                exit 1
            fi
        fi
    else
        echo "[Scriptorium] Error: git is not installed. Cannot install obsidian-asciidoc plugin"
        echo "[Scriptorium] Please install git or install the plugin manually"
        exit 1
    fi
fi

# Start Obsidian
echo "[Scriptorium] Starting Obsidian..."
echo "[Scriptorium] Note: Plugin logs will appear in this terminal"

# Try to find Obsidian command
if command -v obsidian &> /dev/null; then
    # Start Obsidian with the vault path
    obsidian "$VAULT_PATH" &
    echo "[Scriptorium] Obsidian started in background (PID: $!)"
    echo "[Scriptorium] You can close this terminal, but plugin logs will stop if you do"
    echo "[Scriptorium] Press Ctrl+C to stop Obsidian (or close the window)"
    echo ""
    echo "[Scriptorium] To use a different vault next time, run: $0 <new-vault-path>"
    
    # Wait for user interrupt
    wait
elif command -v flatpak &> /dev/null && flatpak list | grep -q "md.obsidian"; then
    # Try Flatpak version
    echo "[Scriptorium] Starting Obsidian via Flatpak..."
    flatpak run md.obsidian.Obsidian "$VAULT_PATH" &
    echo "[Scriptorium] Obsidian started in background (PID: $!)"
    echo "[Scriptorium] You can close this terminal, but plugin logs will stop if you do"
    echo "[Scriptorium] Press Ctrl+C to stop Obsidian (or close the window)"
    echo ""
    echo "[Scriptorium] To use a different vault next time, run: $0 <new-vault-path>"
    
    # Wait for user interrupt
    wait
else
    echo "Error: Could not find Obsidian command"
    echo "Please install Obsidian or add it to your PATH"
    echo "Or start Obsidian manually and open vault: $VAULT_PATH"
    exit 1
fi
