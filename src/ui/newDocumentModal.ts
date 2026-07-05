import { App, Modal, Setting } from "obsidian";
import { KindTemplate } from "../types";

export class NewDocumentModal extends Modal {
	private templates: KindTemplate[];
	private selectedTemplateId: string;
	private title: string;
	private onSubmit: (templateId: string, title: string) => void;

	constructor(
		app: App,
		templates: KindTemplate[],
		defaultTemplateId: string,
		onSubmit: (templateId: string, title: string) => void
	) {
		super(app);
		this.templates = templates;
		this.selectedTemplateId = defaultTemplateId;
		this.title = "";
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Create New Nostr Document" });

		new Setting(contentEl)
			.setName("Template")
			.setDesc("Select the event kind template for this document")
			.addDropdown((dropdown) => {
				for (const t of this.templates) {
					dropdown.addOption(t.id, `${t.name} (kind ${t.kind})`);
				}
				if (this.templates.some((t) => t.id === this.selectedTemplateId)) {
					dropdown.setValue(this.selectedTemplateId);
				} else if (this.templates.length > 0) {
					dropdown.setValue(this.templates[0].id);
					this.selectedTemplateId = this.templates[0].id;
				}
				dropdown.onChange((value) => {
					this.selectedTemplateId = value;
				});
			});

		new Setting(contentEl)
			.setName("Title / Filename")
			.setDesc("Enter a title for your document (will be used as filename)")
			.addText((text) => {
				text.setPlaceholder("My Document Title").setValue(this.title).onChange((value) => {
					this.title = value.trim();
				});
				text.inputEl.focus();
			});

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		buttonContainer.createEl("button", { text: "Create", cls: "mod-cta" }).addEventListener("click", () => {
			if (!this.title) this.title = "Untitled";
			this.onSubmit(this.selectedTemplateId, this.title);
			this.close();
		});
		buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
