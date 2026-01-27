import { Modal, App } from "obsidian";
import { StructureNode } from "../types";

/**
 * Modal for previewing document structure before creating events
 */
export class StructurePreviewModal extends Modal {
	private structure: StructureNode[];
	private onConfirm: () => void;

	constructor(app: App, structure: StructureNode[], onConfirm: () => void) {
		super(app);
		this.structure = structure;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		// Set max height on the modal content
		modalEl.style.maxHeight = "1000px";
		modalEl.style.display = "flex";
		modalEl.style.flexDirection = "column";
		contentEl.style.display = "flex";
		contentEl.style.flexDirection = "column";
		contentEl.style.maxHeight = "1000px";
		contentEl.style.overflow = "hidden";

		const title = contentEl.createEl("h2", { text: "Document Structure Preview" });
		title.style.marginBottom = "1.5em";
		title.style.flexShrink = "0";

		const structureContainer = contentEl.createDiv({ cls: "scriptorium-structure-preview" });
		structureContainer.style.marginBottom = "2em";
		structureContainer.style.overflowY = "auto";
		structureContainer.style.flex = "1";
		structureContainer.style.minHeight = "0";

		this.structure.forEach((node) => {
			this.renderNode(structureContainer, node, 0);
		});

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		buttonContainer.style.marginTop = "1.5em";
		buttonContainer.style.paddingTop = "1em";
		buttonContainer.style.borderTop = "1px solid var(--background-modifier-border)";
		buttonContainer.style.flexShrink = "0";
		const confirmButton = buttonContainer.createEl("button", {
			text: "Create Events",
			cls: "mod-cta",
		});
		confirmButton.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => {
			this.close();
		});
	}

	private renderNode(container: HTMLElement, node: StructureNode, indent: number) {
		const nodeDiv = container.createDiv({ cls: "scriptorium-structure-node" });
		nodeDiv.style.marginBottom = "1.2em";
		nodeDiv.style.paddingTop = "0.8em";
		nodeDiv.style.paddingBottom = "0.8em";
		
		// For nested nodes, indent the entire div and add border at the indented position
		if (indent > 0) {
			const indentPx = indent * 24;
			// Position the border at the indentation level (not at the left edge)
			nodeDiv.style.marginLeft = `${indentPx}px`;
			nodeDiv.style.borderLeft = "2px solid var(--background-modifier-border)";
			nodeDiv.style.paddingLeft = "8px";
		} else {
			nodeDiv.style.paddingLeft = "0px";
		}

		const kindBadge = nodeDiv.createSpan({
			cls: `scriptorium-kind-badge kind-${node.kind}`,
			text: `Kind ${node.kind}`,
		});
		kindBadge.style.marginBottom = "0.5em";
		kindBadge.style.display = "block";

		const titleEl = nodeDiv.createEl("div", { cls: "scriptorium-node-title" });
		titleEl.style.marginBottom = "0.4em";
		titleEl.createEl("strong", { text: node.title });

		const dTagEl = nodeDiv.createEl("div", { cls: "scriptorium-node-dtag" });
		dTagEl.style.marginTop = "0.3em";
		dTagEl.style.fontSize = "0.9em";
		dTagEl.style.color = "var(--text-muted)";
		dTagEl.createEl("span", { text: `d-tag: `, cls: "scriptorium-label" });
		dTagEl.createEl("code", { text: node.dTag });

		if (node.kind === 30041 && node.content) {
			const contentPreview = nodeDiv.createDiv({ cls: "scriptorium-content-preview" });
			contentPreview.style.marginTop = "0.5em";
			contentPreview.style.fontSize = "0.85em";
			contentPreview.style.color = "var(--text-muted)";
			const previewText = node.content.substring(0, 100);
			contentPreview.createEl("em", {
				text: previewText + (node.content.length > 100 ? "..." : ""),
			});
		}

		if (node.children.length > 0) {
			const childrenContainer = container.createDiv();
			childrenContainer.style.marginTop = "0.5em";
			node.children.forEach((child) => {
				this.renderNode(childrenContainer, child, indent + 1);
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
