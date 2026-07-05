import { App, Modal, Notice } from "obsidian";
import { KindTemplate, ScriptoriumSettings } from "../types";
import { parseKindTemplateJson, validateTemplate } from "../templateRegistry";

export class KindTemplateEditorModal extends Modal {
	private template: KindTemplate;
	private allTemplates: KindTemplate[];
	private onSave: (template: KindTemplate) => void;
	private errorEl: HTMLElement | null = null;
	private textareaEl: HTMLTextAreaElement | null = null;

	constructor(
		app: App,
		template: KindTemplate,
		allTemplates: KindTemplate[],
		onSave: (template: KindTemplate) => void
	) {
		super(app);
		this.template = template;
		this.allTemplates = allTemplates;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.template.id ? `Edit Template: ${this.template.id}` : "New Template" });

		this.renderHelp(contentEl);

		this.errorEl = contentEl.createEl("div");
		this.errorEl.style.marginBottom = "1em";

		this.textareaEl = contentEl.createEl("textarea");
		this.textareaEl.style.width = "100%";
		this.textareaEl.style.minHeight = "400px";
		this.textareaEl.style.fontFamily = "monospace";
		this.textareaEl.value = JSON.stringify(this.template, null, 2);

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });

		buttonContainer.createEl("button", { text: "Validate", cls: "mod-cta" }).addEventListener("click", () => {
			this.runValidation(false);
		});

		buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => {
			const template = this.runValidation(true);
			if (template) {
				this.onSave(template);
				this.close();
			}
		});

		buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	private renderHelp(container: HTMLElement): void {
		const help = container.createEl("details", { cls: "scriptorium-template-editor-help" });
		help.style.marginBottom = "1em";
		help.style.fontSize = "var(--font-ui-small)";
		help.style.color = "var(--text-muted)";

		help.createEl("summary", { text: "Template guide" });

		const body = help.createDiv();
		body.style.marginTop = "0.5em";

		body.createEl("p", {
			text: "Templates define how documents are published as Nostr events. Edit the JSON below, then Validate or Save.",
		});

		body.createEl("p", { text: "Simple template (single document):" }).style.fontWeight = "600";
		const simpleList = body.createEl("ul");
		simpleList.style.marginTop = "0.25rem";
		simpleList.createEl("li", { text: '"structured": false' });
		simpleList.createEl("li", { text: '"markup": "markdown" or "asciidoc" (required for content templates)' });
		simpleList.createEl("li", { text: '"kind": NIP-01 event kind, e.g. 30023 for long-form articles' });

		body.createEl("p", { text: "Publication (hierarchical, one file → many events):" }).style.fontWeight =
			"600";
		body.createEl("p", {
			text: "One source file with headings splits into index events (branches, empty body) and section events (leaves, with body). Each allowed section kind + markup is a linked section template.",
		});

		const structuredList = body.createEl("ul");
		structuredList.style.marginTop = "0.25rem";
		structuredList.createEl("li", {
			text: 'Publication: "structured": true, index kind, "contentTemplateIds" listing section templates',
		});
		structuredList.createEl("li", {
			text: "Section templates: each defines kind + markup (e.g. 30041/asciidoc, 30818/markdown)",
		});
		structuredList.createEl("li", {
			text: 'Metadata "sectionTemplateId" picks which section kind when multiple are allowed',
		});

		body.createEl("p", {
			text: 'Use Settings → Add → "Publication" to configure index kind and allowed section kinds.',
		});
	}

	private runValidation(forSave: boolean): KindTemplate | null {
		const parsed = parseKindTemplateJson(this.textareaEl!.value);
		if (!parsed.success) {
			this.showMessages(parsed.errors, true);
			return null;
		}

		const others = this.allTemplates.filter((t) => t.id !== parsed.template.id);
		const result = validateTemplate(parsed.template, [...others, parsed.template]);

		if (result.errors.length > 0) {
			this.showMessages(result.errors, true);
			return null;
		}

		if (result.warnings.length > 0) {
			this.showMessages(result.warnings, false);
		} else {
			this.showMessages([forSave ? "Valid" : "Validation passed"], false, true);
		}
		return parsed.template;
	}

	private showMessages(messages: string[], isError = true, isSuccess = false): void {
		if (!this.errorEl) return;
		this.errorEl.empty();

		const color = isSuccess
			? "var(--text-success)"
			: isError
				? "var(--text-error)"
				: "var(--text-muted)";
		this.errorEl.style.color = color;

		if (messages.length === 1) {
			this.errorEl.textContent = messages[0];
			return;
		}

		const heading = this.errorEl.createEl("p", {
			text: isError ? `${messages.length} errors:` : `${messages.length} warnings:`,
		});
		heading.style.margin = "0 0 0.35rem";
		heading.style.fontWeight = "600";

		const list = this.errorEl.createEl("ul");
		list.style.margin = "0";
		list.style.paddingLeft = "1.25rem";
		for (const message of messages) {
			list.createEl("li", { text: message });
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

export function updateKindTemplatesInSettings(
	settings: ScriptoriumSettings,
	updated: KindTemplate,
	originalId?: string
): void {
	const id = originalId || updated.id;
	const idx = settings.kindTemplates.findIndex((t) => t.id === id);
	if (idx >= 0) {
		settings.kindTemplates[idx] = updated;
	} else {
		settings.kindTemplates.push(updated);
	}
}

export function deleteKindTemplate(settings: ScriptoriumSettings, id: string): boolean {
	const template = settings.kindTemplates.find((t) => t.id === id);
	if (!template || template.type !== "custom") return false;
	settings.kindTemplates = settings.kindTemplates.filter((t) => t.id !== id);
	return true;
}

export function showTemplateNotice(message: string) {
	new Notice(message);
}
