import { Modal, App } from "obsidian";
import { EventKind } from "../types";

/**
 * Modal to remind users to update metadata before creating events
 */
export class MetadataReminderModal extends Modal {
	private onConfirm: () => void;
	private kind: EventKind;

	constructor(app: App, kind: EventKind, onConfirm: () => void) {
		super(app);
		this.kind = kind;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Update Metadata Before Creating Events" });

		const infoDiv = contentEl.createDiv({ cls: "scriptorium-reminder-info" });
		
		infoDiv.createEl("p", {
			text: "Please update the metadata in your file before creating events:",
		});

		const list = infoDiv.createEl("ul");
		
		// Get required fields for this kind (title is optional for kind 1, mandatory for all others)
		const requiresTitle = this.kind !== 1;
		
		if (requiresTitle) {
			const titleItem = list.createEl("li");
			titleItem.createEl("strong", { text: "Title is mandatory" });
			titleItem.createEl("span", { text: " - Update the title field in the frontmatter/attributes" });
		}

		list.createEl("li", {
			text: "Review all metadata fields in the frontmatter (Markdown) or header attributes (AsciiDoc)",
		});

		list.createEl("li", {
			text: "Remove or update any placeholder descriptions you don't want to use",
		});

		list.createEl("li", {
			text: "Add any custom tags you need",
		});

		const noteDiv = contentEl.createDiv({ cls: "scriptorium-reminder-note" });
		noteDiv.createEl("p", {
			text: "Note: Placeholder values (descriptions) will be automatically skipped when creating events.",
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		
		const okButton = buttonContainer.createEl("button", {
			text: "OK, I've Updated the Metadata",
			cls: "mod-cta",
		});
		okButton.addEventListener("click", () => {
			this.onConfirm();
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
