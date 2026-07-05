import { App, Modal, Setting } from "obsidian";
import { MarkupFormat, PublicationSectionKind } from "../types";

export interface AddPublicationConfig {
	name: string;
	indexKind: number;
	sectionKinds: PublicationSectionKind[];
}

export class AddPublicationModal extends Modal {
	private name = "My Publication";
	private indexKind = 30040;
	private sectionRows: PublicationSectionKind[] = [{ kind: 30041, markup: "asciidoc" }];
	private onSubmit: (config: AddPublicationConfig) => void;

	constructor(app: App, onSubmit: (config: AddPublicationConfig) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Add Publication Template" });

		contentEl.createEl("p", {
			text: "A publication splits one hierarchical source file into index events (branches) and section events (leaves). Define which section kind(s) and markup format(s) are allowed.",
			cls: "setting-item-description",
		});

		new Setting(contentEl)
			.setName("Publication name")
			.setDesc("Display name for the publication template")
			.addText((text) => {
				text.setValue(this.name).onChange((v) => {
					this.name = v.trim() || "My Publication";
				});
			});

		new Setting(contentEl)
			.setName("Index kind")
			.setDesc("NIP-01 kind for index/branch events (default 30040)")
			.addText((text) => {
				text.setValue(String(this.indexKind)).onChange((v) => {
					const n = parseInt(v, 10);
					if (!Number.isNaN(n)) this.indexKind = n;
				});
			});

		const sectionHeader = contentEl.createDiv();
		sectionHeader.createEl("h3", { text: "Allowed section kinds" });
		sectionHeader.createEl("p", {
			text: "Each row is one allowed content kind and its source markup. The first row is the default for new documents.",
		});

		const rowsContainer = contentEl.createDiv({ cls: "scriptorium-publication-section-rows" });
		this.renderSectionRows(rowsContainer);

		const rowButtons = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		rowButtons.createEl("button", { text: "Add section kind" }).addEventListener("click", () => {
			this.sectionRows.push({ kind: 30041, markup: "asciidoc" });
			this.renderSectionRows(rowsContainer);
		});

		const actionButtons = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		actionButtons.style.marginTop = "1em";
		actionButtons.createEl("button", { text: "Create", cls: "mod-cta" }).addEventListener("click", () => {
			if (this.sectionRows.length === 0) return;
			this.onSubmit({
				name: this.name,
				indexKind: this.indexKind,
				sectionKinds: this.sectionRows,
			});
			this.close();
		});
		actionButtons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	private renderSectionRows(container: HTMLElement): void {
		container.empty();

		this.sectionRows.forEach((row, index) => {
			const rowEl = container.createDiv({ cls: "scriptorium-publication-section-row" });
			rowEl.style.display = "flex";
			rowEl.style.gap = "0.5rem";
			rowEl.style.alignItems = "center";
			rowEl.style.marginBottom = "0.5rem";

			const kindInput = rowEl.createEl("input", { type: "number", attr: { min: "1", max: "65535" } });
			kindInput.value = String(row.kind);
			kindInput.style.width = "6rem";
			kindInput.addEventListener("change", () => {
				const n = parseInt(kindInput.value, 10);
				if (!Number.isNaN(n)) this.sectionRows[index].kind = n;
			});

			const markupSelect = rowEl.createEl("select");
			for (const opt of ["asciidoc", "markdown"] as MarkupFormat[]) {
				const option = markupSelect.createEl("option", { value: opt, text: opt });
				if (opt === row.markup) option.selected = true;
			}
			markupSelect.addEventListener("change", () => {
				this.sectionRows[index].markup = markupSelect.value as MarkupFormat;
			});

			if (this.sectionRows.length > 1) {
				rowEl.createEl("button", { text: "Remove" }).addEventListener("click", () => {
					this.sectionRows.splice(index, 1);
					this.renderSectionRows(container);
				});
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
