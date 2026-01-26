import { App, Modal, Setting } from "obsidian";
import { EventKind } from "../types";
import { createDefaultMetadata, writeMetadata } from "../metadataManager";

/**
 * Modal for creating a new Nostr document
 */
export class NewDocumentModal extends Modal {
	private selectedKind: EventKind;
	private title: string;
	private onSubmit: (kind: EventKind, title: string) => void;

	constructor(app: App, onSubmit: (kind: EventKind, title: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.selectedKind = 1;
		this.title = "";
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.createEl("h2", { text: "Create New Nostr Document" });

		// Event kind selection
		new Setting(contentEl)
			.setName("Event Kind")
			.setDesc("Select the type of Nostr event to create")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("1", "1 - Normal Note")
					.addOption("11", "11 - Discussion Thread OP")
					.addOption("30023", "30023 - Long-form Article")
					.addOption("30040", "30040 - Publication Index (AsciiDoc)")
					.addOption("30041", "30041 - Publication Content (AsciiDoc)")
					.addOption("30817", "30817 - Wiki Page (Markdown)")
					.addOption("30818", "30818 - Wiki Page (AsciiDoc)")
					.setValue(String(this.selectedKind))
					.onChange((value) => {
						this.selectedKind = parseInt(value) as EventKind;
					});
			});

		// Title input
		new Setting(contentEl)
			.setName("Title / Filename")
			.setDesc("Enter a title for your document (will be used as filename)")
			.addText((text) => {
				text.setPlaceholder("My Document Title")
					.setValue(this.title)
					.onChange((value) => {
						this.title = value.trim();
					});
				text.inputEl.focus();
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		const createButton = buttonContainer.createEl("button", {
			text: "Create",
			cls: "mod-cta",
		});
		createButton.addEventListener("click", () => {
			if (!this.title) {
				// Use default title if empty
				this.title = "Untitled";
			}
			this.onSubmit(this.selectedKind, this.title);
			this.close();
		});

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
