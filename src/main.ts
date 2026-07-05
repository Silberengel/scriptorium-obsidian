import { Plugin, TFile, Notice, Menu } from "obsidian";
import { ScriptoriumSettings, EventKind, DEFAULT_SETTINGS } from "./types";
import { ScriptoriumSettingTab } from "./ui/settingsTab";
import { NewDocumentModal } from "./ui/newDocumentModal";
import { writeMetadata, createDefaultMetadata } from "./metadataManager";
import { safeConsoleError } from "./utils/security";
import { showErrorNotice } from "./utils/errorHandling";
import { log, logError } from "./utils/console";
import {
	getCurrentFile,
	ensureNostrNotesFolder,
	handleCreateEvents,
	handlePreviewStructure,
	handlePublishEvents,
	handleEditMetadata,
	handleDeleteEvents,
} from "./commands/commandHandlers";

export default class ScriptoriumPlugin extends Plugin {
	settings!: ScriptoriumSettings;

	async onload() {
		log("Plugin loading...");
		
		try {
			await this.loadSettings();

			log("Plugin loaded - file extensions not registered");
			log("Install obsidian-asciidoc plugin for .adoc file editing support");

			this.addSettingTab(new ScriptoriumSettingTab(this.app, this));

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
				id: "delete-nostr-events",
				name: "Delete Nostr Events",
				callback: () => this.handleDeleteEvents(),
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

			const ribbonIcon = this.addRibbonIcon("zap", "Nostr", () => {
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
				
				if (ribbonIcon) {
					const rect = ribbonIcon.getBoundingClientRect();
					menu.showAtPosition({ x: rect.left, y: rect.bottom + 5 });
				}
			});

			this.addStatusBarItem().setText("Scriptorium");
			
			log("Plugin loaded successfully");
		} catch (error: any) {
			logError("Error loading plugin", error);
			safeConsoleError("Error loading plugin:", error);
		}
	}

	onunload() {
		log("Plugin unloading");
	}

	/**
	 * Read private key from environment variable only (never persisted)
	 */
	getPrivateKey(): string | null {
		try {
			if (typeof process !== "undefined" && process.env?.SCRIPTORIUM_OBSIDIAN_KEY) {
				const envKey = process.env.SCRIPTORIUM_OBSIDIAN_KEY.trim();
				return envKey || null;
			}
		} catch {
			// Environment variable access not available
		}
		return null;
	}

	async loadSettings() {
		const saved = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

		// One-time migration: remove legacy persisted private key
		if (saved && "privateKey" in saved) {
			delete (this.settings as any).privateKey;
			delete (saved as any).privateKey;
			await this.saveData(this.settings);
			log("Removed legacy private key from saved settings");
		}

		// Remove legacy autoAuth if present
		if (saved && "autoAuth" in saved) {
			delete (this.settings as any).autoAuth;
			await this.saveData(this.settings);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async handleCreateEvents() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handleCreateEvents(this.app, file, this.settings, this.getPrivateKey());
	}

	private async handlePreviewStructure() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handlePreviewStructure(this.app, file);
	}

	private async handlePublishEvents() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handlePublishEvents(this.app, file, this.settings, this.getPrivateKey());
	}

	private async handleDeleteEvents() {
		const file = await getCurrentFile(this.app);
		if (!file) return;
		await handleDeleteEvents(this.app, file);
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
				
				const folderPath = await ensureNostrNotesFolder(this.app, kind);
				const sanitizedTitle = this.sanitizeFilename(title);
				
				let extension = "md";
				if (kind === 30040 || kind === 30041 || kind === 30818) {
					extension = "adoc";
				}

				const filename = `${sanitizedTitle}.${extension}`;
				const filePath = `${folderPath}/${filename}`;

				const existingFile = this.app.vault.getAbstractFileByPath(filePath);
				if (existingFile) {
					new Notice(`File ${filename} already exists`);
					return;
				}

				let content = "";
				if (kind === 30040 || kind === 30041 || kind === 30818) {
					content = `= ${title}\n\n`;
				} else if (kind === 30023 || kind === 30817) {
					content = `# ${title}\n\n`;
				} else if (kind === 1 || kind === 11) {
					content = `\n`;
				}

				if (!content) {
					content = "\n";
				}
				
				let file: TFile;
				try {
					log(`Creating file: ${filePath}`);
					file = await this.app.vault.create(filePath, content);
					log(`File created successfully: ${file.path}`);
					
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

				const metadata = createDefaultMetadata(kind);
				if (kind !== 1 && title && title.trim()) {
					(metadata as any).title = title.trim();
				}
				
				try {
					await writeMetadata(file, metadata, this.app);
				} catch (error: any) {
					showErrorNotice("Error creating metadata", error);
					safeConsoleError("Error creating metadata:", error);
				}

				const opened = await this.openNewFile(file);
				if (opened) {
					new Notice(`Created and opened ${filename}`);
				} else {
					new Notice(`Created ${filename} in ${folderPath}. You may need to open it manually.`);
				}
			} catch (error: any) {
				showErrorNotice("Error creating document", error);
				safeConsoleError("Error creating document:", error);
			}
		}).open();
	}

	private async openNewFile(file: TFile): Promise<boolean> {
		const isAsciiDoc = file.extension === "adoc" || file.extension === "asciidoc";
		const delay = isAsciiDoc ? 500 : 200;
		await new Promise((resolve) => setTimeout(resolve, delay));

		try {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf && leaf.view) {
				await leaf.openFile(file, { active: true });
			} else {
				const newLeaf = this.app.workspace.getLeaf(true);
				await newLeaf.openFile(file, { active: true });
			}
			return true;
		} catch (error: any) {
			logError("Error opening file", error);
			safeConsoleError("Error opening file:", error);
			return false;
		}
	}

	private sanitizeFilename(title: string): string {
		let sanitized = title
			.replace(/[<>:"/\\|?*]/g, "-")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");

		if (sanitized.length > 100) {
			sanitized = sanitized.substring(0, 100);
		}

		if (!sanitized) {
			sanitized = "untitled";
		}

		return sanitized;
	}
}
