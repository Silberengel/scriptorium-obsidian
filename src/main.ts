import { Plugin, TFile, Notice } from "obsidian";
import { ScriptoriumSettings, EventKind, EventMetadata, DEFAULT_SETTINGS } from "./types";
import { ScriptoriumSettingTab } from "./ui/settingsTab";
import { MetadataModal } from "./ui/metadataModal";
import { StructurePreviewModal } from "./ui/structurePreviewModal";
import { readMetadata, writeMetadata, createDefaultMetadata, validateMetadata, mergeWithHeaderTitle } from "./metadataManager";
import { buildEvents } from "./eventManager";
import { saveEvents, loadEvents, eventsFileExists } from "./eventStorage";
import { publishEventsWithRetry } from "./nostr/relayClient";
import { getWriteRelays } from "./relayManager";
import { parseAsciiDocStructure, isAsciiDocDocument } from "./asciidocParser";
import { normalizeSecretKey, getPubkeyFromPrivkey } from "./nostr/eventBuilder";
import { safeConsoleError, safeConsoleLog, verifyEventSecurity } from "./utils/security";

export default class ScriptoriumPlugin extends Plugin {
	settings!: ScriptoriumSettings;

	async onload() {
		await this.loadSettings();
		await this.loadPrivateKey();

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
}
