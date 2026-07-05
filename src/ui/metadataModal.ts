import { Modal, App, Setting } from "obsidian";
import { KindTemplate, TemplateMetadata } from "../types";

export class MetadataModal extends Modal {
	private metadata: TemplateMetadata;
	private template: KindTemplate;
	private onSave: (metadata: TemplateMetadata) => void;

	constructor(
		app: App,
		metadata: TemplateMetadata,
		template: KindTemplate,
		onSave: (metadata: TemplateMetadata) => void
	) {
		super(app);
		this.metadata = { ...metadata };
		this.template = template;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Edit Event Metadata" });
		contentEl.createEl("p", { text: `Template: ${this.template.name} (${this.template.id})` });
		this.renderFieldsFromTemplate(contentEl, this.template, this.metadata);

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => {
			this.metadata.templateId = this.template.id;
			this.metadata.kind = this.template.kind;
			this.onSave(this.metadata);
			this.close();
		});
		buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	private renderFieldsFromTemplate(
		container: HTMLElement,
		template: KindTemplate,
		metadata: TemplateMetadata
	) {
		for (const field of template.fields) {
			const label = field.label || field.key;
			const desc = field.required ? `${field.description} (required)` : field.description;
			const meta = metadata as Record<string, unknown>;

			if (field.tagType === "topics") {
				new Setting(container)
					.setName(label)
					.setDesc(desc)
					.addText((text) => {
						const topics = meta[field.key];
						const value = Array.isArray(topics) ? topics.join(", ") : typeof topics === "string" ? topics : "";
						text.setValue(value).setPlaceholder("topic1, topic2").onChange((v) => {
							meta[field.key] = v.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
						});
					});
				continue;
			}

			const isLong = field.key === "summary";
			if (isLong) {
				new Setting(container)
					.setName(label)
					.setDesc(desc)
					.addTextArea((text) => {
						text.setValue(String(meta[field.key] || "")).onChange((v) => { meta[field.key] = v; });
						text.inputEl.rows = 3;
					});
			} else {
				new Setting(container)
					.setName(label)
					.setDesc(desc)
					.addText((text) => {
						text.setValue(String(meta[field.key] || "")).onChange((v) => { meta[field.key] = v; });
					});
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
