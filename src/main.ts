import { Plugin, TFile, TFolder, Notice } from "obsidian";
import { ScriptoriumSettings, EventKind, EventMetadata, DEFAULT_SETTINGS } from "./types";
import { ScriptoriumSettingTab } from "./ui/settingsTab";
import { MetadataModal } from "./ui/metadataModal";
import { StructurePreviewModal } from "./ui/structurePreviewModal";
import { NewDocumentModal } from "./ui/newDocumentModal";
import { readMetadata, writeMetadata, createDefaultMetadata, validateMetadata, mergeWithHeaderTitle } from "./metadataManager";
import { buildEvents } from "./eventManager";
import { saveEvents, loadEvents, eventsFileExists } from "./eventStorage";
import { publishEventsWithRetry } from "./nostr/relayClient";
import { getWriteRelays } from "./relayManager";
import { parseAsciiDocStructure, isAsciiDocDocument } from "./asciidocParser";
import { normalizeSecretKey, getPubkeyFromPrivkey } from "./nostr/eventBuilder";
import { safeConsoleError, safeConsoleLog, verifyEventSecurity } from "./utils/security";
// CodeMirror language packages for syntax highlighting
// These will be bundled with the plugin
import { yaml } from "@codemirror/lang-yaml";
import { asciidoc } from "codemirror-asciidoc";
import { StreamLanguage } from "@codemirror/language";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export default class ScriptoriumPlugin extends Plugin {
	settings!: ScriptoriumSettings;

	async onload() {
		await this.loadSettings();
		await this.loadPrivateKey();

		// Register AsciiDoc file extensions so Obsidian can open them
		// This tells Obsidian to treat .adoc and .asciidoc files as editable text files
		// Using "text" view type so they open as plain text editors in Obsidian
		this.registerExtensions(["adoc", "asciidoc"], "text");
		
		// Register YAML file extensions so Obsidian can open metadata files
		// This tells Obsidian to treat .yml and .yaml files as editable text files
		this.registerExtensions(["yml", "yaml"], "text");
		
		// Register editor extensions for syntax highlighting
		// Apply YAML and AsciiDoc language modes
		// Note: Markdown files (.md) use Obsidian's default "markdown" view type
		// which has built-in syntax highlighting, so they won't be affected by these extensions
		// These extensions only apply to files registered with "text" view type (.yml, .yaml, .adoc, .asciidoc)
		this.registerEditorExtension([
			yaml(),
			StreamLanguage.define(asciidoc)
		]);

		// Add settings tab
		this.addSettingTab(new ScriptoriumSettingTab(this.app, this));

		// Register commands
		this.addCommand({
			id: "create-nostr-events",
			name: "Create Nostr Events",
			callback: () => this.handleCreateEvents(),
		});

		this.addCommand({
			id: "preview-structure",
			name: "Preview Document Structure",
			callback: () => this.handlePreviewStructure(),
		});

		this.addCommand({
			id: "publish-events",
			name: "Publish Events to Relays",
			callback: () => this.handlePublishEvents(),
		});

		this.addCommand({
			id: "edit-metadata",
			name: "Edit Metadata",
			callback: () => this.handleEditMetadata(),
		});

		this.addCommand({
			id: "new-nostr-document",
			name: "New Nostr Document",
			callback: () => this.handleNewDocument(),
		});

		// Add ribbon icon for creating new documents
		this.addRibbonIcon("file-plus", "New Nostr Document", () => {
			this.handleNewDocument();
		});

		// Status bar
		this.addStatusBarItem().setText("Scriptorium");
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadPrivateKey(): Promise<boolean> {
		// Try multiple methods to load the private key
		
		// Method 1: Try environment variable (may not work in Obsidian's sandbox)
		try {
			// @ts-ignore - process.env may not be typed in Obsidian context
			if (typeof process !== "undefined" && process.env?.SCRIPTORIUM_OBSIDIAN_KEY) {
				const envKey = process.env.SCRIPTORIUM_OBSIDIAN_KEY.trim();
				if (envKey) {
					this.settings.privateKey = envKey;
					await this.saveSettings();
					return true;
				}
			}
		} catch (error) {
			// Environment variable access not available
		}
		
		// Method 2: Try reading from a file in the vault (.scriptorium_key)
		try {
			const keyFile = this.app.vault.getAbstractFileByPath(".scriptorium_key");
			if (keyFile && keyFile instanceof TFile) {
				const keyContent = await this.app.vault.read(keyFile);
				const key = keyContent.trim();
				if (key && (key.startsWith("nsec1") || /^[0-9a-f]{64}$/i.test(key))) {
					this.settings.privateKey = key;
					await this.saveSettings();
					return true;
				}
			}
		} catch (error) {
			// File doesn't exist or can't be read
		}
		
		// Method 3: Try reading from .obsidian/scriptorium_key (hidden file)
		try {
			const hiddenKeyFile = this.app.vault.getAbstractFileByPath(".obsidian/scriptorium_key");
			if (hiddenKeyFile && hiddenKeyFile instanceof TFile) {
				const keyContent = await this.app.vault.read(hiddenKeyFile);
				const key = keyContent.trim();
				if (key && (key.startsWith("nsec1") || /^[0-9a-f]{64}$/i.test(key))) {
					this.settings.privateKey = key;
					await this.saveSettings();
					return true;
				}
			}
		} catch (error) {
			// File doesn't exist or can't be read
		}
		
		return false;
	}

	/**
	 * Get folder name for an event kind
	 */
	private getFolderNameForKind(kind: EventKind): string {
		switch (kind) {
			case 1:
				return "kind-1-notes";
			case 11:
				return "kind-11-threads";
			case 30023:
				return "kind-30023-articles";
			case 30040:
				return "kind-30040-publications";
			case 30041:
				return "kind-30041-chapters";
			case 30817:
				return "kind-30817-wiki-md";
			case 30818:
				return "kind-30818-wiki-adoc";
		}
	}

	/**
	 * Ensure the Nostr notes folder structure exists
	 */
	private async ensureNostrNotesFolder(kind: EventKind): Promise<string> {
		const baseFolder = "Nostr notes";
		const kindFolder = this.getFolderNameForKind(kind);
		const fullPath = `${baseFolder}/${kindFolder}`;

		// Check if base folder exists
		const baseFolderObj = this.app.vault.getAbstractFileByPath(baseFolder);
		if (!baseFolderObj || !(baseFolderObj instanceof TFolder)) {
			await this.app.vault.createFolder(baseFolder);
		}

		// Check if kind folder exists
		const kindFolderObj = this.app.vault.getAbstractFileByPath(fullPath);
		if (!kindFolderObj || !(kindFolderObj instanceof TFolder)) {
			await this.app.vault.createFolder(fullPath);
		}

		return fullPath;
	}

	private async getCurrentFile(): Promise<TFile | null> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active file");
			return null;
		}
		return activeFile;
	}

	private async handleCreateEvents() {
		const file = await this.getCurrentFile();
		if (!file) return;

		if (!this.settings.privateKey) {
			new Notice("Please set your private key in settings");
			return;
		}

		try {
			const content = await this.app.vault.read(file);
			let metadata = await readMetadata(file, this.app);

			// Determine event kind from file extension or metadata
			let eventKind: EventKind = this.settings.defaultEventKind;
			if (file.extension === "adoc" || file.extension === "asciidoc") {
				if (isAsciiDocDocument(content)) {
					eventKind = 30040;
				} else {
					eventKind = 30818;
				}
			} else if (file.extension === "md") {
				eventKind = metadata?.kind || this.settings.defaultEventKind;
			}

			// Ensure folder structure exists before creating events
			await this.ensureNostrNotesFolder(eventKind);

			// Create default metadata if none exists
			if (!metadata) {
				metadata = createDefaultMetadata(eventKind);
			}

			// Merge with header title for 30040
			if (eventKind === 30040 && isAsciiDocDocument(content)) {
				const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
				metadata = mergeWithHeaderTitle(metadata, headerTitle);
			}

			// Validate metadata
			const validation = validateMetadata(metadata, eventKind);
			if (!validation.valid) {
				new Notice(`Metadata validation failed: ${validation.errors.join(", ")}`);
				return;
			}

			// Build events
			const result = await buildEvents(file, content, metadata, this.settings.privateKey, this.app);

			if (result.errors.length > 0) {
				new Notice(`Errors: ${result.errors.join(", ")}`);
				return;
			}

			// Security check: verify events don't contain private keys
			for (const event of result.events) {
				if (!verifyEventSecurity(event)) {
					new Notice("Security error: Event contains private key. Aborting.");
					safeConsoleError("Event security check failed - event may contain private key");
					return;
				}
			}

			// Show preview for structured documents
			if (result.structure.length > 0) {
				new StructurePreviewModal(this.app, result.structure, async () => {
					await saveEvents(file, result.events, this.app);
					new Notice(`Created ${result.events.length} event(s) and saved to ${file.basename}_events.jsonl`);
				}).open();
			} else {
				await saveEvents(file, result.events, this.app);
				new Notice(`Created ${result.events.length} event(s) and saved to ${file.basename}_events.jsonl`);
			}
		} catch (error: any) {
			const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
			new Notice(`Error creating events: ${safeMessage}`);
			safeConsoleError("Error creating events:", error);
		}
	}

	private async handlePreviewStructure() {
		const file = await this.getCurrentFile();
		if (!file) return;

		try {
			const content = await this.app.vault.read(file);
			if (!isAsciiDocDocument(content)) {
				new Notice("This file is not an AsciiDoc document with structure");
				return;
			}

			let metadata = await readMetadata(file, this.app);
			if (!metadata || metadata.kind !== 30040) {
				metadata = createDefaultMetadata(30040);
			}

			const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
			metadata = mergeWithHeaderTitle(metadata, headerTitle);

			const structure = parseAsciiDocStructure(content, metadata as any);
			new StructurePreviewModal(this.app, structure, () => {}).open();
		} catch (error: any) {
			const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
			new Notice(`Error previewing structure: ${safeMessage}`);
			safeConsoleError("Error previewing structure:", error);
		}
	}

	private async handlePublishEvents() {
		const file = await this.getCurrentFile();
		if (!file) return;

		if (!this.settings.privateKey) {
			new Notice("Please set your private key in settings");
			return;
		}

		const exists = await eventsFileExists(file, this.app);
		if (!exists) {
			new Notice("No events file found. Please create events first.");
			return;
		}

		try {
			const events = await loadEvents(file, this.app);
			if (events.length === 0) {
				new Notice("No events to publish");
				return;
			}

			const writeRelays = getWriteRelays(this.settings.relayList);
			if (writeRelays.length === 0) {
				new Notice("No write relays configured. Please fetch relay list in settings.");
				return;
			}

			// Relays are already normalized and deduplicated by getWriteRelays
			new Notice(`Publishing ${events.length} event(s) to ${writeRelays.length} relay(s)...`);

			const results = await publishEventsWithRetry(writeRelays, events, this.settings.privateKey);

			// Count successes
			let successCount = 0;
			let failureCount = 0;
			results.forEach((relayResults) => {
				relayResults.forEach((result) => {
					if (result.success) {
						successCount++;
					} else {
						failureCount++;
					}
				});
			});

			if (failureCount === 0) {
				new Notice(`Successfully published all ${successCount} event(s)`);
			} else {
				new Notice(`Published ${successCount} event(s), ${failureCount} failed`);
			}
		} catch (error: any) {
			const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
			new Notice(`Error publishing events: ${safeMessage}`);
			safeConsoleError("Error publishing events:", error);
		}
	}

	private async handleEditMetadata() {
		const file = await this.getCurrentFile();
		if (!file) return;

		try {
			let metadata = await readMetadata(file, this.app);
			if (!metadata) {
				// Determine kind from file extension
				let eventKind: EventKind = this.settings.defaultEventKind;
				if (file.extension === "adoc" || file.extension === "asciidoc") {
					const content = await this.app.vault.read(file);
					if (isAsciiDocDocument(content)) {
						eventKind = 30040;
					} else {
						eventKind = 30818;
					}
				}
				metadata = createDefaultMetadata(eventKind);
			}

			new MetadataModal(this.app, metadata, async (updatedMetadata) => {
				await writeMetadata(file, updatedMetadata, this.app);
				new Notice("Metadata saved");
			}).open();
		} catch (error: any) {
			const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
			new Notice(`Error editing metadata: ${safeMessage}`);
			safeConsoleError("Error editing metadata:", error);
		}
	}

	private async handleNewDocument() {
		new NewDocumentModal(this.app, async (kind: EventKind, title: string) => {
			try {
				// Ensure folder structure exists
				const folderPath = await this.ensureNostrNotesFolder(kind);

				// Sanitize filename from title
				const sanitizedTitle = this.sanitizeFilename(title);
				
				// Determine file extension based on kind
				let extension = "md";
				if (kind === 30040 || kind === 30041 || kind === 30818) {
					extension = "adoc";
				}

				// Create file path in the appropriate folder
				const filename = `${sanitizedTitle}.${extension}`;
				const filePath = `${folderPath}/${filename}`;

				// Check if file already exists
				const existingFile = this.app.vault.getAbstractFileByPath(filePath);
				if (existingFile) {
					new Notice(`File ${filename} already exists`);
					return;
				}

				// Create default content based on kind
				let content = "";
				if (kind === 30040) {
					// AsciiDoc document header for 30040
					content = `= ${title}\n\n`;
				} else if (kind === 30023 || kind === 30817 || kind === 30818) {
					// Add title as heading for other kinds that require title
					if (kind === 30817 || kind === 30818) {
						content = `# ${title}\n\n`;
					} else {
						content = `# ${title}\n\n`;
					}
				} else if (kind === 1 || kind === 11) {
					// For kind 1 and 11, add a simple placeholder
					content = `\n`;
				}

				// Create the file - ensure we have at least a newline for empty files
				if (!content) {
					content = "\n";
				}
				
				let file: TFile;
				try {
					file = await this.app.vault.create(filePath, content);
					
					// Verify file was actually created
					const verifyFile = this.app.vault.getAbstractFileByPath(filePath);
					if (!verifyFile || !(verifyFile instanceof TFile)) {
						new Notice(`Error: File ${filename} was not created properly`);
						safeConsoleError(`File creation verification failed for ${filePath}`);
						return;
					}
				} catch (error: any) {
					const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
					new Notice(`Error creating file: ${safeMessage}`);
					safeConsoleError("Error creating file:", error);
					safeConsoleError("File path was:", filePath);
					return;
				}

				// Create metadata
				const metadata = createDefaultMetadata(kind);
				if (metadata.title === "" && title) {
					(metadata as any).title = title;
				}
				
				try {
					await writeMetadata(file, metadata, this.app);
				} catch (error: any) {
					const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
					new Notice(`Error creating metadata: ${safeMessage}`);
					safeConsoleError("Error creating metadata:", error);
					// Continue anyway - file was created
				}

				// Open the new file in Obsidian workspace (use active leaf or create new)
				try {
					const leaf = this.app.workspace.getMostRecentLeaf();
					if (leaf) {
						await leaf.openFile(file);
					} else {
						// Fallback: open in new leaf
						const newLeaf = this.app.workspace.getLeaf("tab");
						await newLeaf.openFile(file);
					}
				} catch (error: any) {
					safeConsoleError("Error opening file:", error);
					// File was created, just couldn't open it
				}

				new Notice(`Created ${filename} in ${folderPath}`);
			} catch (error: any) {
				const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
				new Notice(`Error creating document: ${safeMessage}`);
				safeConsoleError("Error creating document:", error);
			}
		}).open();
	}

	/**
	 * Sanitize a string to be used as a filename
	 */
	private sanitizeFilename(title: string): string {
		// Remove or replace invalid filename characters
		let sanitized = title
			.replace(/[<>:"/\\|?*]/g, "-") // Replace invalid chars with dash
			.replace(/\s+/g, "-") // Replace spaces with dash
			.replace(/-+/g, "-") // Replace multiple dashes with single
			.replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes

		// Limit length
		if (sanitized.length > 100) {
			sanitized = sanitized.substring(0, 100);
		}

		// Ensure it's not empty
		if (!sanitized) {
			sanitized = "untitled";
		}

		return sanitized;
	}
}
