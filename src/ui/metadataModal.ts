import { Modal, App, Setting } from "obsidian";
import { EventMetadata, EventKind } from "../types";

/**
 * Modal for editing event metadata
 */
export class MetadataModal extends Modal {
	private metadata: EventMetadata;
	private onSave: (metadata: EventMetadata) => void;

	constructor(app: App, metadata: EventMetadata, onSave: (metadata: EventMetadata) => void) {
		super(app);
		this.metadata = { ...metadata };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Edit Event Metadata" });

		// Common fields
		if (this.requiresTitle()) {
			new Setting(contentEl)
				.setName("Title")
				.setDesc("Title is mandatory for this event kind")
				.addText((text) => {
					text.setValue(this.metadata.title || "")
						.setPlaceholder("Enter title")
						.onChange((value) => {
							(this.metadata as any).title = value;
						});
				});
		}

		new Setting(contentEl)
			.setName("Author")
			.setDesc("Author name")
			.addText((text) => {
				text.setValue(this.metadata.author || "")
					.setPlaceholder("Enter author")
					.onChange((value) => {
						this.metadata.author = value;
					});
			});

		new Setting(contentEl)
			.setName("Summary")
			.setDesc("Brief summary or description")
			.addTextArea((text) => {
				text.setValue(this.metadata.summary || "")
					.setPlaceholder("Enter summary")
					.onChange((value) => {
						this.metadata.summary = value;
					});
				text.inputEl.rows = 3;
			});

		// Kind-specific fields
		this.renderKindSpecificFields(contentEl);

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		const saveButton = buttonContainer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		saveButton.addEventListener("click", () => {
			this.onSave(this.metadata);
			this.close();
		});

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => {
			this.close();
		});
	}

	private requiresTitle(): boolean {
		return (
			this.metadata.kind === 30023 ||
			this.metadata.kind === 30040 ||
			this.metadata.kind === 30041 ||
			this.metadata.kind === 30817 ||
			this.metadata.kind === 30818
		);
	}

	private renderKindSpecificFields(container: HTMLElement) {
		switch (this.metadata.kind) {
			case 30023:
				this.render30023Fields(container);
				break;
			case 30040:
				this.render30040Fields(container);
				break;
			case 30041:
				this.render30041Fields(container);
				break;
			case 30817:
			case 30818:
				// No additional fields beyond common ones
				break;
		}
	}

	private render30023Fields(container: HTMLElement) {
		const meta = this.metadata as any;

		new Setting(container)
			.setName("Image URL")
			.setDesc("URL to an image for the article")
			.addText((text) => {
				text.setValue(meta.image || "")
					.setPlaceholder("https://...")
					.onChange((value) => {
						meta.image = value;
					});
			});

		new Setting(container)
			.setName("Published At")
			.setDesc("Unix timestamp of first publication")
			.addText((text) => {
				text.setValue(meta.published_at || "")
					.setPlaceholder("Unix timestamp")
					.onChange((value) => {
						meta.published_at = value;
					});
			});

		new Setting(container)
			.setName("Topics")
			.setDesc("Comma-separated topics (t tags)")
			.addText((text) => {
				text.setValue(meta.topics?.join(", ") || "")
					.setPlaceholder("topic1, topic2, ...")
					.onChange((value) => {
						meta.topics = value.split(",").map((t: string) => t.trim()).filter((t: string) => t.length > 0);
					});
			});
	}

	private render30040Fields(container: HTMLElement) {
		const meta = this.metadata as any;

		new Setting(container)
			.setName("Type")
			.setDesc("Publication type")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("book", "Book")
					.addOption("illustrated", "Illustrated")
					.addOption("magazine", "Magazine")
					.addOption("documentation", "Documentation")
					.addOption("academic", "Academic")
					.addOption("blog", "Blog")
					.setValue(meta.type || "book")
					.onChange((value) => {
						meta.type = value;
					});
			});

		new Setting(container)
			.setName("Version")
			.setDesc("Version or edition")
			.addText((text) => {
				text.setValue(meta.version || "")
					.setPlaceholder("e.g., 1st edition")
					.onChange((value) => {
						meta.version = value;
					});
			});

		new Setting(container)
			.setName("Published On")
			.setDesc("Publication date")
			.addText((text) => {
				text.setValue(meta.published_on || "")
					.setPlaceholder("e.g., 2003-05-13")
					.onChange((value) => {
						meta.published_on = value;
					});
			});

		new Setting(container)
			.setName("Published By")
			.setDesc("Publisher or source")
			.addText((text) => {
				text.setValue(meta.published_by || "")
					.setPlaceholder("e.g., public domain")
					.onChange((value) => {
						meta.published_by = value;
					});
			});

		new Setting(container)
			.setName("Source URL")
			.setDesc("URL to original source")
			.addText((text) => {
				text.setValue(meta.source || "")
					.setPlaceholder("https://...")
					.onChange((value) => {
						meta.source = value;
					});
			});

		new Setting(container)
			.setName("Image URL")
			.setDesc("Cover image URL")
			.addText((text) => {
				text.setValue(meta.image || "")
					.setPlaceholder("https://...")
					.onChange((value) => {
						meta.image = value;
					});
			});

		new Setting(container)
			.setName("Auto Update")
			.setDesc("Auto-update behavior")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("yes", "Yes")
					.addOption("ask", "Ask")
					.addOption("no", "No")
					.setValue(meta.auto_update || "ask")
					.onChange((value) => {
						meta.auto_update = value;
					});
			});

		new Setting(container)
			.setName("Collection ID")
			.setDesc("NKBIP-08 collection identifier (C tag)")
			.addText((text) => {
				text.setValue(meta.collection_id || "")
					.setPlaceholder("collection-id")
					.onChange((value) => {
						meta.collection_id = value;
					});
			});

		new Setting(container)
			.setName("Version Tag")
			.setDesc("NKBIP-08 version identifier (v tag)")
			.addText((text) => {
				text.setValue(meta.version_tag || "")
					.setPlaceholder("e.g., kjv, drb")
					.onChange((value) => {
						meta.version_tag = value;
					});
			});
	}

	private render30041Fields(container: HTMLElement) {
		const meta = this.metadata as any;

		new Setting(container)
			.setName("Collection ID")
			.setDesc("NKBIP-08 collection identifier (C tag)")
			.addText((text) => {
				text.setValue(meta.collection_id || "")
					.setPlaceholder("collection-id")
					.onChange((value) => {
						meta.collection_id = value;
					});
			});

		new Setting(container)
			.setName("Title ID")
			.setDesc("NKBIP-08 title identifier (T tag)")
			.addText((text) => {
				text.setValue(meta.title_id || "")
					.setPlaceholder("title-id")
					.onChange((value) => {
						meta.title_id = value;
					});
			});

		new Setting(container)
			.setName("Chapter ID")
			.setDesc("NKBIP-08 chapter identifier (c tag)")
			.addText((text) => {
				text.setValue(meta.chapter_id || "")
					.setPlaceholder("chapter-id")
					.onChange((value) => {
						meta.chapter_id = value;
					});
			});

		new Setting(container)
			.setName("Section ID")
			.setDesc("NKBIP-08 section identifier (s tag)")
			.addText((text) => {
				text.setValue(meta.section_id || "")
					.setPlaceholder("section-id")
					.onChange((value) => {
						meta.section_id = value;
					});
			});

		new Setting(container)
			.setName("Version Tag")
			.setDesc("NKBIP-08 version identifier (v tag)")
			.addText((text) => {
				text.setValue(meta.version_tag || "")
					.setPlaceholder("e.g., kjv, drb")
					.onChange((value) => {
						meta.version_tag = value;
					});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
