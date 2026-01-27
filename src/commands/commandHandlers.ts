import { TFile, TFolder, App, Notice } from "obsidian";
import { EventKind, EventMetadata, ScriptoriumSettings } from "../types";
import { readMetadata, writeMetadata, createDefaultMetadata, validateMetadata, mergeWithHeaderTitle } from "../metadataManager";
import { buildEvents } from "../eventManager";
import { saveEvents, loadEvents, eventsFileExists, getEventsFilePath } from "../eventStorage";
import { publishEventsWithRetry } from "../nostr/relayClient";
import { getWriteRelays } from "../relayManager";
import { parseAsciiDocStructure, isAsciiDocDocument } from "../asciidocParser";
import { validateAsciiDocDocument } from "../asciidocValidator";
import { verifyEventSecurity } from "../utils/security";
import { showErrorNotice } from "../utils/errorHandling";
import { log, logError } from "../utils/console";
import { determineEventKind, getFolderNameForKind } from "../utils/eventKind";
import { StructurePreviewModal } from "../ui/structurePreviewModal";
import { MetadataReminderModal } from "../ui/metadataReminderModal";
import { MetadataModal } from "../ui/metadataModal";
import { isAsciiDocFile } from "../utils/fileExtensions";

/**
 * Get the current active file
 */
export async function getCurrentFile(app: App): Promise<TFile | null> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice("No active file");
		return null;
	}
	return activeFile;
}

/**
 * Ensure the Nostr notes folder structure exists
 */
export async function ensureNostrNotesFolder(
	app: App,
	kind: EventKind
): Promise<string> {
	const baseFolder = "Nostr notes";
	const kindFolder = getFolderNameForKind(kind);
	const fullPath = `${baseFolder}/${kindFolder}`;

	// Check if base folder exists
	const baseFolderObj = app.vault.getAbstractFileByPath(baseFolder);
	if (!baseFolderObj || !(baseFolderObj instanceof TFolder)) {
		await app.vault.createFolder(baseFolder);
	}

	// Check if kind folder exists
	const kindFolderObj = app.vault.getAbstractFileByPath(fullPath);
	if (!kindFolderObj || !(kindFolderObj instanceof TFolder)) {
		await app.vault.createFolder(fullPath);
	}

	return fullPath;
}

/**
 * Handle creating Nostr events from current file
 */
export async function handleCreateEvents(
	app: App,
	file: TFile,
	settings: ScriptoriumSettings
): Promise<void> {
	if (!settings.privateKey) {
		new Notice("Please set your private key in settings");
		return;
	}

	try {
		const content = await app.vault.read(file);
		let metadata = await readMetadata(file, app);

		// Determine event kind from file extension or metadata
		const eventKind = determineEventKind(
			file,
			content,
			settings.defaultEventKind,
			metadata?.kind
		);

		// Ensure folder structure exists before creating events
		await ensureNostrNotesFolder(app, eventKind);

		// Create default metadata if none exists and write it with placeholders
		if (!metadata) {
			metadata = createDefaultMetadata(eventKind);
			await writeMetadata(file, metadata, app);
			// Re-read to get the formatted version with placeholders
			metadata = await readMetadata(file, app) || metadata;
		}

		// Merge with header title for 30040
		if (eventKind === 30040 && isAsciiDocDocument(content)) {
			const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
			metadata = mergeWithHeaderTitle(metadata, headerTitle);
		}

		// Show reminder modal before proceeding
		new MetadataReminderModal(app, eventKind, async () => {
			try {
				log("Metadata reminder modal confirmed, starting event creation");
				// Re-read metadata after user confirms (they may have updated it)
				const updatedContent = await app.vault.read(file);
			let updatedMetadata: EventMetadata = await readMetadata(file, app) || metadata || createDefaultMetadata(eventKind);
			
			// Ensure we have valid metadata
			if (!updatedMetadata) {
				updatedMetadata = createDefaultMetadata(eventKind);
			}

			// Merge with header title for 30040
			if (eventKind === 30040 && isAsciiDocDocument(updatedContent)) {
				const headerTitle = updatedContent.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
				updatedMetadata = mergeWithHeaderTitle(updatedMetadata, headerTitle);
			}

			// Validate metadata
			const validation = validateMetadata(updatedMetadata, eventKind);
			if (!validation.valid) {
				new Notice(`Metadata validation failed: ${validation.errors.join(", ")}`);
				return;
			}

			// Validate AsciiDoc structure if this is a structured AsciiDoc document
			if (isAsciiDocFile(file) && eventKind === 30040 && isAsciiDocDocument(updatedContent)) {
				const asciiDocValidation = validateAsciiDocDocument(updatedContent);
				if (!asciiDocValidation.valid) {
					const errorMsg = `AsciiDoc validation failed:\n${asciiDocValidation.errors.join("\n")}`;
					if (asciiDocValidation.warnings.length > 0) {
						new Notice(`${errorMsg}\n\nWarnings:\n${asciiDocValidation.warnings.join("\n")}`);
					} else {
						new Notice(errorMsg);
					}
					return;
				}
				if (asciiDocValidation.warnings.length > 0) {
					log(`AsciiDoc validation warnings: ${asciiDocValidation.warnings.join("; ")}`);
				}
			}

			// Build events
			if (!settings.privateKey) {
				new Notice("Please set your private key in settings");
				return;
			}
			
			log(`Building events for file: ${file.path}, kind: ${eventKind}`);
			const result = await buildEvents(file, updatedContent, updatedMetadata, settings.privateKey, app);
			log(`buildEvents returned: ${result.events.length} events, ${result.errors.length} errors`);

			if (result.errors.length > 0) {
				new Notice(`Errors: ${result.errors.join(", ")}`);
				logError("buildEvents returned errors", result.errors);
				return;
			}

			// Check if any events were created
			if (result.events.length === 0) {
				new Notice("No events were created. Check metadata and content.");
				logError("buildEvents returned 0 events", { file: file.path, metadata: updatedMetadata });
				return;
			}

			// Security check: verify events don't contain private keys
			for (const event of result.events) {
				if (!verifyEventSecurity(event)) {
					new Notice("Security error: Event contains private key. Aborting.");
					logError("Event security check failed - event may contain private key");
					return;
				}
			}

			// Show preview for structured documents
			if (result.structure.length > 0) {
				new StructurePreviewModal(app, result.structure, async () => {
					try {
						const eventsPath = getEventsFilePath(file);
						await saveEvents(file, result.events, app);
						
						// Try to open the events file in Obsidian
						const eventsFile = app.vault.getAbstractFileByPath(eventsPath);
						if (eventsFile && eventsFile instanceof TFile) {
							try {
								const leaf = app.workspace.getMostRecentLeaf();
								if (leaf && leaf.view) {
									await leaf.openFile(eventsFile, { active: true });
								} else {
									const newLeaf = app.workspace.getLeaf("tab");
									await newLeaf.openFile(eventsFile, { active: true });
								}
							} catch (openError: any) {
								// If opening fails, just show the notice - file was saved successfully
								logError("Error opening events file", openError);
							}
						}
						
						new Notice(`Created ${result.events.length} event(s) and saved to ${eventsPath}`);
						log(`Events saved to: ${eventsPath}`);
					} catch (error: any) {
						showErrorNotice("Error saving events", error);
						logError("Error saving events", error);
					}
				}).open();
			} else {
				try {
					const eventsPath = getEventsFilePath(file);
					await saveEvents(file, result.events, app);
					
					// Try to open the events file in Obsidian
					const eventsFile = app.vault.getAbstractFileByPath(eventsPath);
					if (eventsFile && eventsFile instanceof TFile) {
						try {
							const leaf = app.workspace.getMostRecentLeaf();
							if (leaf && leaf.view) {
								await leaf.openFile(eventsFile, { active: true });
							} else {
								const newLeaf = app.workspace.getLeaf("tab");
								await newLeaf.openFile(eventsFile, { active: true });
							}
						} catch (openError: any) {
							// If opening fails, just show the notice - file was saved successfully
							logError("Error opening events file", openError);
						}
					}
					
					new Notice(`Created ${result.events.length} event(s) and saved to ${eventsPath}`);
					log(`Events saved to: ${eventsPath}`);
				} catch (error: any) {
					showErrorNotice("Error saving events", error);
					logError("Error saving events", error);
				}
			}
			} catch (error: any) {
				showErrorNotice("Error creating events", error);
				logError("Error in event creation callback", error);
			}
		}).open();
	} catch (error: any) {
		showErrorNotice("Error creating events", error);
		logError("Error creating events", error);
	}
}

/**
 * Handle previewing document structure
 */
export async function handlePreviewStructure(
	app: App,
	file: TFile
): Promise<void> {
	try {
		const content = await app.vault.read(file);
		if (!isAsciiDocDocument(content)) {
			new Notice("This file is not an AsciiDoc document with structure");
			return;
		}

		let metadata = await readMetadata(file, app);
		if (!metadata || metadata.kind !== 30040) {
			metadata = createDefaultMetadata(30040);
		}

		const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
		metadata = mergeWithHeaderTitle(metadata, headerTitle);

		const structure = parseAsciiDocStructure(content, metadata as any);
		new StructurePreviewModal(app, structure, () => {}).open();
	} catch (error: any) {
		showErrorNotice("Error previewing structure", error);
		logError("Error previewing structure", error);
	}
}

/**
 * Handle publishing events to relays
 */
export async function handlePublishEvents(
	app: App,
	file: TFile,
	settings: ScriptoriumSettings
): Promise<void> {
	if (!settings.privateKey) {
		new Notice("Please set your private key in settings");
		return;
	}

	const exists = await eventsFileExists(file, app);
	if (!exists) {
		new Notice("No events file found. Please create events first.");
		return;
	}

	try {
		const events = await loadEvents(file, app);
		if (events.length === 0) {
			new Notice("No events to publish");
			return;
		}

		const writeRelays = getWriteRelays(settings.relayList);
		if (writeRelays.length === 0) {
			new Notice("No write relays configured. Please fetch relay list in settings.");
			return;
		}

		// Relays are already normalized and deduplicated by getWriteRelays
		new Notice(`Publishing ${events.length} event(s) to ${writeRelays.length} relay(s)...`);

		const results = await publishEventsWithRetry(writeRelays, events, settings.privateKey);

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
		showErrorNotice("Error publishing events", error);
		logError("Error publishing events", error);
	}
}

/**
 * Handle editing metadata
 */
export async function handleEditMetadata(
	app: App,
	file: TFile,
	defaultEventKind: EventKind
): Promise<void> {
	try {
		let metadata = await readMetadata(file, app);
		if (!metadata) {
			// Determine kind from file extension
			const content = await app.vault.read(file);
			const eventKind = determineEventKind(file, content, defaultEventKind);
			metadata = createDefaultMetadata(eventKind);
		}

		new MetadataModal(app, metadata, async (updatedMetadata) => {
			await writeMetadata(file, updatedMetadata, app);
			new Notice("Metadata saved");
		}).open();
	} catch (error: any) {
		showErrorNotice("Error editing metadata", error);
		logError("Error editing metadata", error);
	}
}
