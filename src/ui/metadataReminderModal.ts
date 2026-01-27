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
			text: "Before creating events, update the metadata in your file:",
		});

		const list = infoDiv.createEl("ul");
		
		// Get required fields for this kind (title is optional for kind 1, mandatory for all others)
		const requiresTitle = this.kind !== 1;
		
		if (requiresTitle) {
			const titleItem = list.createEl("li");
			titleItem.createEl("strong", { text: "Title is required" });
			titleItem.createEl("span", { text: " - Set the title field in frontmatter/attributes" });
		}

		list.createEl("li", {
			text: "Review all metadata fields (shown with placeholder descriptions)",
		});

		list.createEl("li", {
			text: "Remove placeholders you don't need, or replace them with actual values",
		});

		list.createEl("li", {
			text: "Add custom tags if needed",
		});

		const noteDiv = contentEl.createDiv({ cls: "scriptorium-reminder-note" });
		noteDiv.createEl("p", {
			text: "Note: Placeholder descriptions are automatically skipped when creating events.",
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
