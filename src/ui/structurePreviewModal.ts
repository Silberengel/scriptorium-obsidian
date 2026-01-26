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
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Document Structure Preview" });

		const structureContainer = contentEl.createDiv({ cls: "scriptorium-structure-preview" });

		this.structure.forEach((node) => {
			this.renderNode(structureContainer, node, 0);
		});

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
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
		nodeDiv.style.paddingLeft = `${indent * 20}px`;

		const kindBadge = nodeDiv.createSpan({
			cls: `scriptorium-kind-badge kind-${node.kind}`,
			text: `Kind ${node.kind}`,
		});

		const titleEl = nodeDiv.createEl("div", { cls: "scriptorium-node-title" });
		titleEl.createEl("strong", { text: node.title });

		const dTagEl = nodeDiv.createEl("div", { cls: "scriptorium-node-dtag" });
		dTagEl.createEl("span", { text: `d-tag: `, cls: "scriptorium-label" });
		dTagEl.createEl("code", { text: node.dTag });

		if (node.kind === 30041 && node.content) {
			const contentPreview = nodeDiv.createDiv({ cls: "scriptorium-content-preview" });
			const previewText = node.content.substring(0, 100);
			contentPreview.createEl("em", {
				text: previewText + (node.content.length > 100 ? "..." : ""),
			});
		}

		if (node.children.length > 0) {
			node.children.forEach((child) => {
				this.renderNode(container, child, indent + 1);
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
