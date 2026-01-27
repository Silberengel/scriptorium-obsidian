import { Plugin, TFile, Notice, Menu } from "obsidian";
import { ScriptoriumSettings, EventKind, DEFAULT_SETTINGS } from "./types";
import { ScriptoriumSettingTab } from "./ui/settingsTab";
import { NewDocumentModal } from "./ui/newDocumentModal";
import { writeMetadata, createDefaultMetadata } from "./metadataManager";
import { safeConsoleError } from "./utils/security";
import { showErrorNotice } from "./utils/errorHandling";
import { log, logError } from "./utils/console";
import { getFolderNameForKind } from "./utils/eventKind";
import {
	getCurrentFile,
	ensureNostrNotesFolder,
	handleCreateEvents,
	handlePreviewStructure,
	handlePublishEvents,
	handleEditMetadata,
} from "./commands/commandHandlers";

export default class ScriptoriumPlugin extends Plugin {
	settings!: ScriptoriumSettings;

	async onload() {
		log("Plugin loading...");
		
		try {
			await this.loadSettings();
			await this.loadPrivateKey();

			// Note: We don't register file extensions for .adoc or .asciidoc files
			// Users should install the obsidian-asciidoc plugin for .adoc file support
			log("Plugin loaded - file extensions not registered");
			log("Install obsidian-asciidoc plugin for .adoc file editing support");

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

			// Add ribbon icon with menu for Nostr actions
			const ribbonIcon = this.addRibbonIcon("zap", "Nostr", () => {
				// Create and show menu
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle("Write Nostr note")
						.setIcon("file-plus")
						.onClick(() => this.handleNewDocument());
				});
				menu.addItem((item) => {
					item.setTitle("Create Nostr events")
						.setIcon("file-check")
						.onClick(() => this.handleCreateEvents());
				});
				menu.addItem((item) => {
					item.setTitle("Publish events to relays")
						.setIcon("upload")
						.onClick(() => this.handlePublishEvents());
				});
				
				// Show menu at the ribbon icon position
				if (ribbonIcon) {
					const rect = ribbonIcon.getBoundingClientRect();
					menu.showAtPosition({ x: rect.left, y: rect.bottom + 5 });
				}
			});

			// Status bar
			this.addStatusBarItem().setText("Scriptorium");
			
			log("Plugin loaded successfully");
		} catch (error: any) {
			logError("Error loading plugin", error);
			safeConsoleError("Error loading plugin:", error);
		}
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadPrivateKey(): Promise<boolean> {
		// Load private key from environment variable only
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
		
		return false;
	}


	private async handleCreateEvents() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handleCreateEvents(this.app, file, this.settings);
	}

	private async handlePreviewStructure() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handlePreviewStructure(this.app, file);
	}

	private async handlePublishEvents() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handlePublishEvents(this.app, file, this.settings);
	}

	private async handleEditMetadata() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handleEditMetadata(this.app, file, this.settings.defaultEventKind);
	}

	private async handleNewDocument() {
		new NewDocumentModal(this.app, async (kind: EventKind, title: string) => {
			try {
				log(`Creating new document: kind=${kind}, title=${title}`);
				
				// Ensure folder structure exists
				const folderPath = await ensureNostrNotesFolder(this.app, kind);

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
				// Note: This content will be replaced by writeMetadata() which formats
				// the file properly with metadata. We just need minimal content here.
				let content = "";
				if (kind === 30040 || kind === 30041 || kind === 30818) {
					// AsciiDoc files - minimal content, writeMetadata will format properly
					content = `= ${title}\n\n`;
				} else if (kind === 30023 || kind === 30817) {
					// Markdown files - add title as heading
					content = `# ${title}\n\n`;
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
					log(`Creating file: ${filePath}`);
					file = await this.app.vault.create(filePath, content);
					log(`File created successfully: ${file.path}`);
					
					// Verify file was actually created
					const verifyFile = this.app.vault.getAbstractFileByPath(filePath);
					if (!verifyFile || !(verifyFile instanceof TFile)) {
						const msg = `Error: File ${filename} was not created properly`;
						log(msg);
						new Notice(msg);
						logError("File creation verification failed", { filePath });
						return;
					}
				} catch (error: any) {
					logError("Error creating file", error);
					showErrorNotice("Error creating file", error);
					return;
				}

				// Create metadata with title preset from the filename
				const metadata = createDefaultMetadata(kind);
				// Set title if provided (skip for kind 1 which doesn't have title)
				if (kind !== 1 && title && title.trim()) {
					(metadata as any).title = title.trim();
				}
				
				try {
					// Write metadata with all placeholders (title will be included if set)
					await writeMetadata(file, metadata, this.app);
				} catch (error: any) {
					showErrorNotice("Error creating metadata", error);
					safeConsoleError("Error creating metadata:", error);
					// Continue anyway - file was created
				}

				// For .adoc files, try to auto-open after a longer delay to allow obsidian-asciidoc plugin to initialize
				if (file.extension === "adoc" || file.extension === "asciidoc") {
					log(`AsciiDoc file created: ${file.path}`);
					
					// Wait longer for obsidian-asciidoc plugin to be ready
					await new Promise(resolve => setTimeout(resolve, 500));
					
					try {
						log(`Attempting to open AsciiDoc file: ${file.path}`);
						const leaf = this.app.workspace.getMostRecentLeaf();
						if (leaf && leaf.view) {
							await leaf.openFile(file, { active: true });
							log("AsciiDoc file opened successfully");
							new Notice(`Created and opened ${filename}`);
						} else {
							const newLeaf = this.app.workspace.getLeaf("tab");
							await newLeaf.openFile(file, { active: true });
							log("AsciiDoc file opened in new leaf");
							new Notice(`Created and opened ${filename}`);
						}
					} catch (error: any) {
						logError("Error opening AsciiDoc file", error);
						// Don't show error to user - file was created successfully
						new Notice(`Created ${filename} in ${folderPath}. You may need to open it manually.`);
					}
				} else {
					// Open the new file in Obsidian workspace (use active leaf or create new)
					// Use a small delay to ensure file is fully created before opening
					log("Waiting before opening file...");
					await new Promise(resolve => setTimeout(resolve, 200));
					
					try {
						log(`Attempting to open file: ${file.path} (extension: ${file.extension})`);
						
						const leaf = this.app.workspace.getMostRecentLeaf();
						if (leaf && leaf.view) {
							await leaf.openFile(file, { active: true });
							log("File opened successfully in existing leaf");
						} else {
							// Fallback: open in new leaf
							const newLeaf = this.app.workspace.getLeaf("tab");
							await newLeaf.openFile(file, { active: true });
							log("File opened successfully in new leaf");
						}
					} catch (error: any) {
						logError("Error opening file", error);
						safeConsoleError("Error opening file:", error);
						// File was created, just couldn't open it - show a notice
						new Notice(`File created but couldn't open: ${file.name}`);
					}
				}

				new Notice(`Created ${filename} in ${folderPath}`);
			} catch (error: any) {
				showErrorNotice("Error creating document", error);
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
