import { App, Modal, Setting } from "obsidian";
import { KindTemplate, PublicationSectionKind, ScriptoriumSettings } from "../types";
import {
	getPublicationContentKinds,
	formatPublicationSectionLabel,
	sectionKindKey,
	parseSectionKindKey,
} from "../templateRegistry";

export class NewDocumentModal extends Modal {
	private templates: KindTemplate[];
	private settings: ScriptoriumSettings;
	private selectedTemplateId: string;
	private selectedSectionKey: string;
	private title: string;
	private sectionSetting: Setting | null = null;
	private onSubmit: (templateId: string, title: string, section?: PublicationSectionKind) => void;

	constructor(
		app: App,
		templates: KindTemplate[],
		settings: ScriptoriumSettings,
		defaultTemplateId: string,
		onSubmit: (templateId: string, title: string, section?: PublicationSectionKind) => void
	) {
		super(app);
		this.templates = templates;
		this.settings = settings;
		this.selectedTemplateId = defaultTemplateId;
		this.selectedSectionKey = "";
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
					this.updateSectionSetting();
				});
			});

		this.sectionSetting = new Setting(contentEl)
			.setName("Section kind")
			.setDesc("Content kind and markup for leaf sections in this publication");

		new Setting(contentEl)
			.setName("Title / Filename")
			.setDesc("Enter a title for your document (will be used as filename)")
			.addText((text) => {
				text.setPlaceholder("My Document Title").setValue(this.title).onChange((value) => {
					this.title = value.trim();
				});
				text.inputEl.focus();
			});

		this.updateSectionSetting();

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		buttonContainer.createEl("button", { text: "Create", cls: "mod-cta" }).addEventListener("click", () => {
			if (!this.title) this.title = "Untitled";
			const section = parseSectionKindKey(this.selectedSectionKey) ?? undefined;
			this.onSubmit(this.selectedTemplateId, this.title, section);
			this.close();
		});
		buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	private updateSectionSetting(): void {
		if (!this.sectionSetting) return;

		const template = this.templates.find((t) => t.id === this.selectedTemplateId);
		const sections = template?.structured
			? getPublicationContentKinds(template, this.settings)
			: [];

		this.sectionSetting.settingEl.style.display = sections.length > 1 ? "" : "none";

		this.sectionSetting.clear();

		if (sections.length <= 1) {
			this.selectedSectionKey = sections[0] ? sectionKindKey(sections[0]) : "";
			return;
		}

		this.sectionSetting
			.setName("Section kind")
			.setDesc("Which allowed section kind and markup to use for this publication file")
			.addDropdown((dropdown) => {
				for (const s of sections) {
					dropdown.addOption(sectionKindKey(s), formatPublicationSectionLabel(s));
				}
				this.selectedSectionKey = sectionKindKey(sections[0]);
				dropdown.setValue(this.selectedSectionKey);
				dropdown.onChange((value) => {
					this.selectedSectionKey = value;
				});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
