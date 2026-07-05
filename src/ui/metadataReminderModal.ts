import { Modal, App } from "obsidian";
import { KindTemplate } from "../types";
import { getRequiredFields } from "../templateRegistry";
import { TemplateMetadata } from "../types";
import { isMetadataPlaceholder } from "../metadataManager";

export class MetadataReminderModal extends Modal {
	private template: KindTemplate;
	private metadata: TemplateMetadata;
	private onConfirm: () => void;

	constructor(
		app: App,
		template: KindTemplate,
		metadata: TemplateMetadata,
		onConfirm: () => void
	) {
		super(app);
		this.template = template;
		this.metadata = metadata;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Metadata Reminder" });

		const required = getRequiredFields(this.template);
		const missing = required.filter((f) => isMetadataPlaceholder(this.metadata[f.key], f));

		if (missing.length > 0) {
			contentEl.createEl("p", {
				text: `Please fill in required metadata before creating events: ${missing.map((f) => f.label || f.key).join(", ")}`,
			});
		} else {
			contentEl.createEl("p", { text: "Review your metadata before creating events." });
		}

		contentEl.createEl("p", { text: `Template: ${this.template.name} (kind ${this.template.kind})` });

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		buttonContainer.createEl("button", { text: "Continue", cls: "mod-cta" }).addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
		buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
