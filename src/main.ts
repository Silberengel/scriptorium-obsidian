import { Plugin, TFile, Notice, Menu } from "obsidian";
import { ScriptoriumSettings, DEFAULT_SETTINGS } from "./types";
import { ScriptoriumSettingTab } from "./ui/settingsTab";
import { NewDocumentModal } from "./ui/newDocumentModal";
import { writeMetadata, createDefaultMetadata } from "./metadataManager";
import { safeConsoleError } from "./utils/security";
import { showErrorNotice } from "./utils/errorHandling";
import { log, logError } from "./utils/console";
import { ensureKindTemplates, getTemplateById, getSelectableTemplates, getFileExtension } from "./templateRegistry";
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
		} catch (error: unknown) {
			logError("Error loading plugin", error);
			safeConsoleError("Error loading plugin:", error);
		}
	}

	onunload() {
		log("Plugin unloading");
	}

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

		let removedLegacySettings = false;
		if (saved && "privateKey" in saved) {
			delete (this.settings as unknown as Record<string, unknown>).privateKey;
			removedLegacySettings = true;
			log("Removed legacy private key from saved settings");
		}

		if (saved && "autoAuth" in saved) {
			delete (this.settings as unknown as Record<string, unknown>).autoAuth;
			removedLegacySettings = true;
		}

		if (removedLegacySettings) {
			await this.saveData(this.settings);
		}

		ensureKindTemplates(this.settings);
		await this.saveData(this.settings);
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
		await handlePreviewStructure(this.app, file, this.settings);
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
		await handleEditMetadata(this.app, file, this.settings);
	}

	private async handleNewDocument() {
		const templates = getSelectableTemplates(this.settings);
		new NewDocumentModal(
			this.app,
			templates,
			this.settings.defaultTemplateId,
			async (templateId: string, title: string) => {
				try {
					const template = getTemplateById(templateId, this.settings);
					if (!template) {
						new Notice(`Unknown template: ${templateId}`);
						return;
					}

					log(`Creating new document: template=${templateId}, title=${title}`);

					const folderPath = await ensureNostrNotesFolder(this.app, template);
					const sanitizedTitle = this.sanitizeFilename(title);
					const extension = getFileExtension(template);
					const filename = `${sanitizedTitle}.${extension}`;
					const filePath = `${folderPath}/${filename}`;

					if (this.app.vault.getAbstractFileByPath(filePath)) {
						new Notice(`File ${filename} already exists`);
						return;
					}

					let content = "";
					if (template.markup === "asciidoc") {
						content = `= ${title}\n\n`;
					} else if (template.kind !== 1) {
						content = `# ${title}\n\n`;
					} else {
						content = "\n";
					}

					let file: TFile;
					try {
						file = await this.app.vault.create(filePath, content);
						const verifyFile = this.app.vault.getAbstractFileByPath(filePath);
						if (!verifyFile || !(verifyFile instanceof TFile)) {
							new Notice(`Error: File ${filename} was not created properly`);
							return;
						}
					} catch (error: unknown) {
						showErrorNotice("Error creating file", error);
						return;
					}

					const metadata = createDefaultMetadata(template, title);
					try {
						await writeMetadata(file, metadata, this.app, template);
					} catch (error: unknown) {
						showErrorNotice("Error creating metadata", error);
					}

					const opened = await this.openNewFile(file);
					new Notice(
						opened
							? `Created and opened ${filename}`
							: `Created ${filename} in ${folderPath}. You may need to open it manually.`
					);
				} catch (error: unknown) {
					showErrorNotice("Error creating document", error);
				}
			}
		).open();
	}

	private async openNewFile(file: TFile): Promise<boolean> {
		const isAsciiDoc = file.extension === "adoc" || file.extension === "asciidoc";
		const delay = isAsciiDoc ? 500 : 200;
		await new Promise((resolve) => setTimeout(resolve, delay));

		try {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf?.view) {
				await leaf.openFile(file, { active: true });
			} else {
				await this.app.workspace.getLeaf(true).openFile(file, { active: true });
			}
			return true;
		} catch (error: unknown) {
			logError("Error opening file", error);
			return false;
		}
	}

	private sanitizeFilename(title: string): string {
		let sanitized = title
			.replace(/[<>:"/\\|?*]/g, "-")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");

		if (sanitized.length > 100) sanitized = sanitized.substring(0, 100);
		return sanitized || "untitled";
	}
}
