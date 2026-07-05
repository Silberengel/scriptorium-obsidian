import { App, Modal, Notice } from "obsidian";
import { KindTemplate, ScriptoriumSettings } from "../types";
import {
	validateTemplate,
	validateTemplatesArray,
} from "../templateRegistry";

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

		this.errorEl = contentEl.createEl("div");
		this.errorEl.style.color = "var(--text-error)";
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
			if (this.runValidation(true)) {
				try {
					const parsed = JSON.parse(this.textareaEl!.value) as KindTemplate;
					this.onSave(parsed);
					this.close();
				} catch (e) {
					this.showError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		});

		buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	private runValidation(forSave: boolean): boolean {
		try {
			const parsed = JSON.parse(this.textareaEl!.value) as KindTemplate;
			const others = this.allTemplates.filter((t) => t.id !== parsed.id);
			const result = validateTemplate(parsed, [...others, parsed]);
			const arrayResult = validateTemplatesArray([...others, parsed]);

			const messages = [...result.errors, ...arrayResult.errors];
			const warnings = [...result.warnings, ...arrayResult.warnings];

			if (messages.length > 0) {
				this.showError(messages.join("\n"));
				return false;
			}

			if (warnings.length > 0) {
				this.showError(`Warnings:\n${warnings.join("\n")}`, false);
			} else {
				this.showError(forSave ? "Valid" : "Validation passed", false, true);
			}
			return true;
		} catch (e) {
			this.showError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
			return false;
		}
	}

	private showError(message: string, isError = true, isSuccess = false) {
		if (!this.errorEl) return;
		this.errorEl.textContent = message;
		this.errorEl.style.color = isSuccess ? "var(--text-success)" : isError ? "var(--text-error)" : "var(--text-muted)";
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
