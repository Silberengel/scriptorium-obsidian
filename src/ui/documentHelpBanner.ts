import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { KindTemplate, ScriptoriumSettings } from "../types";
import { getKindHelpSummary, SCRIPTORIUM_WORKFLOW_STEPS } from "../documentHelp";
import { extractTemplateId } from "../metadataManager";
import { getTemplateById } from "../templateRegistry";

export function registerDocumentHelpBanner(
	plugin: Plugin,
	getSettings: () => ScriptoriumSettings
): void {
	const dismissed = new Set<string>();
	let bannerEl: HTMLElement | null = null;
	let updateGeneration = 0;

	const removeBanner = () => {
		bannerEl?.remove();
		bannerEl = null;
	};

	const updateBanner = async () => {
		const generation = ++updateGeneration;
		removeBanner();

		const leaf = plugin.app.workspace.activeLeaf;
		const target = leaf ? getBannerTarget(leaf) : null;
		if (!target) return;

		const filePath = target.file.path;
		if (dismissed.has(filePath)) return;

		const content = await plugin.app.vault.cachedRead(target.file);
		if (generation !== updateGeneration) return;

		const activeLeaf = plugin.app.workspace.activeLeaf;
		const activeTarget = activeLeaf ? getBannerTarget(activeLeaf) : null;
		if (!activeTarget || activeTarget.file.path !== filePath) return;

		const templateId = extractTemplateId(activeTarget.file, content);
		if (!templateId) return;

		const template = getTemplateById(templateId, getSettings());
		if (!template) return;

		if (generation !== updateGeneration) return;

		bannerEl = buildBanner(template, activeTarget.file, () => {
			dismissed.add(filePath);
			removeBanner();
		});
		activeTarget.container.prepend(bannerEl);
	};

	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => void updateBanner()));
	plugin.registerEvent(plugin.app.workspace.on("file-open", () => void updateBanner()));
	plugin.register(() => removeBanner());
	void updateBanner();
}

function getBannerTarget(leaf: WorkspaceLeaf): { file: TFile; container: HTMLElement } | null {
	const view = leaf.view;
	if (!view) return null;

	const file = view instanceof MarkdownView ? view.file : (view as { file?: TFile }).file;
	if (!(file instanceof TFile)) return null;

	const container = view.containerEl.querySelector(".view-content");
	if (!(container instanceof HTMLElement)) return null;

	return { file, container };
}

function buildBanner(template: KindTemplate, file: TFile, onDismiss: () => void): HTMLElement {
	const banner = document.createElement("div");
	banner.className = "scriptorium-document-help";

	const header = banner.createDiv({ cls: "scriptorium-document-help-header" });
	header.createSpan({ text: "Scriptorium", cls: "scriptorium-document-help-label" });
	const dismiss = header.createEl("button", {
		text: "Dismiss",
		cls: "scriptorium-document-help-dismiss",
		attr: { type: "button", "aria-label": "Dismiss help for this note" },
	});
	dismiss.addEventListener("click", onDismiss);

	banner.createEl("p", {
		text: getKindHelpSummary(template),
		cls: "scriptorium-document-help-summary",
	});

	const list = banner.createEl("ol", { cls: "scriptorium-document-help-steps" });
	for (const step of SCRIPTORIUM_WORKFLOW_STEPS) {
		list.createEl("li", { text: step });
	}

	banner.createEl("p", {
		text: "This help is not part of your note and will not be published.",
		cls: "scriptorium-document-help-footnote",
	});

	banner.dataset.filePath = file.path;
	return banner;
}
