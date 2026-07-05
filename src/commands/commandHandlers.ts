import { TFile, App, Notice } from "obsidian";
import { TemplateMetadata, SignedEvent, ScriptoriumSettings, KindTemplate } from "../types";
import {
	readMetadata,
	writeMetadata,
	createDefaultMetadata,
	validateMetadata,
	mergeWithHeaderTitle,
} from "../metadataManager";
import { buildEvents } from "../eventManager";
import { saveEvents, loadEvents, eventsFileExists, getEventsFilePath, deleteEvents } from "../eventStorage";
import { publishEventsWithRetry } from "../nostr/relayClient";
import { getWriteRelays, getEffectiveRelayList } from "../relayManager";
import { parseDocumentStructure, isStructuredSourceDocument } from "../structureParser";
import { isAsciiDocDocument } from "../asciidocParser";
import { getMarkdownBody, parseMarkdownDocumentHeader } from "../markdownParser";
import { validateAsciiDocDocument } from "../asciidocValidator";
import { verifyEventSecurity } from "../utils/security";
import { showErrorNotice } from "../utils/errorHandling";
import {
	buildPublishResultsHeader,
	showPublishResultsModal,
	summarizePublishResults,
} from "../ui/publishResultsModal";
import { log, logError } from "../utils/console";
import { resolveTemplateForFile } from "../utils/eventKind";
import {
	getFolderName,
	getDocumentMarkup,
	resolveSectionTemplate,
} from "../templateRegistry";
import { StructurePreviewModal } from "../ui/structurePreviewModal";
import { MetadataReminderModal } from "../ui/metadataReminderModal";
import { MetadataModal } from "../ui/metadataModal";

const MISSING_KEY_NOTICE =
	"Set SCRIPTORIUM_OBSIDIAN_KEY in your environment and restart Obsidian";

/** Resolve template and read metadata with placeholder filtering for that template. */
async function readDocumentMetadata(
	app: App,
	file: TFile,
	content: string,
	settings: ScriptoriumSettings
): Promise<{ metadata: TemplateMetadata | null; template: KindTemplate }> {
	const preliminary = await readMetadata(file, app);
	const template = resolveTemplateForFile(preliminary, settings, file, content);
	const metadata = preliminary
		? ((await readMetadata(file, app, template)) ?? preliminary)
		: null;
	return { metadata, template };
}

export async function getCurrentFile(app: App): Promise<TFile | null> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice("No active file");
		return null;
	}
	return activeFile;
}

export async function ensureNostrNotesFolder(app: App, template: KindTemplate): Promise<string> {
	const baseFolder = "Nostr notes";
	const kindFolder = getFolderName(template);
	const fullPath = `${baseFolder}/${kindFolder}`;

	if (!app.vault.getAbstractFileByPath(baseFolder)) {
		await app.vault.createFolder(baseFolder);
	}
	if (!app.vault.getAbstractFileByPath(fullPath)) {
		await app.vault.createFolder(fullPath);
	}

	return fullPath;
}

async function saveAndOpenEvents(app: App, file: TFile, events: SignedEvent[]): Promise<void> {
	const eventsPath = getEventsFilePath(file);
	await saveEvents(file, events, app);

	const eventsFile = app.vault.getAbstractFileByPath(eventsPath);
	if (eventsFile instanceof TFile) {
		try {
			const leaf = app.workspace.getMostRecentLeaf();
			if (leaf?.view) await leaf.openFile(eventsFile, { active: true });
			else await app.workspace.getLeaf(true).openFile(eventsFile, { active: true });
		} catch (openError: unknown) {
			logError("Error opening events file", openError);
		}
	}

	new Notice(`Created ${events.length} event(s) and saved to ${eventsPath}`);
}

export async function handleCreateEvents(
	app: App,
	file: TFile,
	settings: ScriptoriumSettings,
	privkey: string | null
): Promise<void> {
	if (!privkey) {
		new Notice(MISSING_KEY_NOTICE);
		return;
	}

	try {
		const content = await app.vault.read(file);
		const { metadata: initialMetadata, template } = await readDocumentMetadata(app, file, content, settings);
		let metadata = initialMetadata;

		await ensureNostrNotesFolder(app, template);

		if (!metadata) {
			metadata = createDefaultMetadata(template);
			await writeMetadata(file, metadata, app, template, settings);
			metadata = (await readMetadata(file, app, template)) ?? metadata;
		}

		if (template.structured) {
			const markup = getDocumentMarkup(template, settings, metadata);
			if (markup === "asciidoc" && isAsciiDocDocument(content)) {
				const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
				metadata = mergeWithHeaderTitle(metadata, headerTitle);
			} else if (markup === "markdown") {
				const header = parseMarkdownDocumentHeader(getMarkdownBody(content));
				if (header) metadata = mergeWithHeaderTitle(metadata, header.title);
			}
		}

		new MetadataReminderModal(app, template, metadata, async () => {
			try {
				const updatedContent = await app.vault.read(file);
				let updatedMetadata: TemplateMetadata =
					(await readMetadata(file, app, template)) ??
					metadata ??
					createDefaultMetadata(template);

				const resolvedTemplate = resolveTemplateForFile(updatedMetadata, settings, file, updatedContent);
				if (!updatedMetadata.templateId || updatedMetadata.templateId !== resolvedTemplate.id) {
					updatedMetadata = {
						...updatedMetadata,
						templateId: resolvedTemplate.id,
						kind: resolvedTemplate.kind,
					};
					await writeMetadata(file, updatedMetadata, app, resolvedTemplate, settings);
				}

				if (resolvedTemplate.structured) {
					const markup = getDocumentMarkup(resolvedTemplate, settings, updatedMetadata);
					if (markup === "asciidoc" && isAsciiDocDocument(updatedContent)) {
						const headerTitle = updatedContent.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
						updatedMetadata = mergeWithHeaderTitle(updatedMetadata, headerTitle);
					} else if (markup === "markdown") {
						const header = parseMarkdownDocumentHeader(getMarkdownBody(updatedContent));
						if (header) updatedMetadata = mergeWithHeaderTitle(updatedMetadata, header.title);
					}
				}

				const validation = validateMetadata(updatedMetadata, resolvedTemplate);
				if (!validation.valid) {
					new Notice(`Metadata validation failed: ${validation.errors.join(", ")}`);
					return;
				}

				const docMarkup = getDocumentMarkup(resolvedTemplate, settings, updatedMetadata);
				if (
					resolvedTemplate.structured &&
					isStructuredSourceDocument(updatedContent, docMarkup, file, updatedMetadata)
				) {
					if (docMarkup === "asciidoc") {
						const asciiDocValidation = validateAsciiDocDocument(updatedContent);
						if (!asciiDocValidation.valid) {
							new Notice(`AsciiDoc validation failed:\n${asciiDocValidation.errors.join("\n")}`);
							return;
						}
					}
				}

				log(`Building events for file: ${file.path}, template: ${resolvedTemplate.id}`);
				const result = await buildEvents(file, updatedContent, updatedMetadata, privkey, settings);

				if (result.errors.length > 0) {
					new Notice(`Errors: ${result.errors.join(", ")}`);
					return;
				}
				if (result.events.length === 0) {
					new Notice("No events were created. Check metadata and content.");
					return;
				}

				for (const event of result.events) {
					if (!verifyEventSecurity(event)) {
						new Notice("Security error: Event contains private key. Aborting.");
						return;
					}
				}

				if (result.structure.length > 0) {
					new StructurePreviewModal(app, result.structure, async () => {
						await saveAndOpenEvents(app, file, result.events);
					}).open();
				} else {
					await saveAndOpenEvents(app, file, result.events);
				}
			} catch (error: unknown) {
				showErrorNotice("Error creating events", error);
			}
		}).open();
	} catch (error: unknown) {
		showErrorNotice("Error creating events", error);
	}
}

export async function handlePreviewStructure(
	app: App,
	file: TFile,
	settings: ScriptoriumSettings
): Promise<void> {
	try {
		const content = await app.vault.read(file);
		let { metadata, template } = await readDocumentMetadata(app, file, content, settings);

		if (!metadata || !template.structured) {
			const indexTemplate = settings.kindTemplates.find((t) => t.structured);
			if (!indexTemplate) {
				new Notice("No publication template found");
				return;
			}
			template = indexTemplate;
			metadata = metadata ?? createDefaultMetadata(indexTemplate);
			metadata = (await readMetadata(file, app, template)) ?? metadata;
		}

		const markup = getDocumentMarkup(template, settings, metadata);
		if (!isStructuredSourceDocument(content, markup, file, metadata)) {
			new Notice(`This file is not a valid hierarchical ${markup} document`);
			return;
		}

		if (markup === "asciidoc") {
			const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
			metadata = mergeWithHeaderTitle(metadata, headerTitle);
		} else if (markup === "markdown") {
			const header = parseMarkdownDocumentHeader(getMarkdownBody(content));
			if (header) metadata = mergeWithHeaderTitle(metadata, header.title);
		}

		const contentTemplate = resolveSectionTemplate(template, settings, metadata);
		const indexKind = template.kind;
		const contentKind = contentTemplate?.kind ?? 30041;

		const structure = parseDocumentStructure(content, metadata, indexKind, contentKind, markup);
		new StructurePreviewModal(app, structure, () => {}).open();
	} catch (error: unknown) {
		showErrorNotice("Error previewing structure", error);
	}
}

export async function handlePublishEvents(
	app: App,
	file: TFile,
	settings: ScriptoriumSettings,
	privkey: string | null
): Promise<void> {
	if (!privkey) {
		new Notice(MISSING_KEY_NOTICE);
		return;
	}

	if (!(await eventsFileExists(file, app))) {
		new Notice("No events file found. Please create events first.");
		return;
	}

	try {
		const events = await loadEvents(file, app);
		if (events.length === 0) {
			new Notice("No events to publish");
			return;
		}

		const writeRelays = getWriteRelays(getEffectiveRelayList(settings));
		if (writeRelays.length === 0) {
			new Notice("No write relays configured. Please fetch relay list in settings.");
			return;
		}

		new Notice(`Publishing ${events.length} event(s) to ${writeRelays.length} relay(s)...`);
		const results = await publishEventsWithRetry(writeRelays, events, privkey);

		const total = events.length;
		const { allRelaysComplete, allEventsPublishedSomewhere } = summarizePublishResults(
			events,
			results
		);

		const header = buildPublishResultsHeader(total, allRelaysComplete, allEventsPublishedSomewhere);

		showPublishResultsModal(app, {
			header,
			totalEvents: total,
			results,
			events,
		});
	} catch (error: unknown) {
		showErrorNotice("Error publishing events", error);
	}
}

export async function handleDeleteEvents(app: App, file: TFile): Promise<void> {
	if (!(await eventsFileExists(file, app))) {
		new Notice("No events file found for this document.");
		return;
	}
	try {
		await deleteEvents(file, app);
		new Notice(`Deleted events file for ${file.name}`);
	} catch (error: unknown) {
		showErrorNotice("Error deleting events", error);
	}
}

export async function handleEditMetadata(
	app: App,
	file: TFile,
	settings: ScriptoriumSettings
): Promise<void> {
	try {
		const content = await app.vault.read(file);
		const { metadata: initialMetadata, template } = await readDocumentMetadata(app, file, content, settings);
		let metadata = initialMetadata;

		if (!metadata) {
			metadata = createDefaultMetadata(template);
		}

		new MetadataModal(app, metadata, template, async (updatedMetadata) => {
			const content = await app.vault.read(file);
			const resolved = resolveTemplateForFile(updatedMetadata, settings, file, content);
			await writeMetadata(file, { ...updatedMetadata, templateId: resolved.id, kind: resolved.kind }, app, resolved, settings);
			new Notice("Metadata saved");
		}).open();
	} catch (error: unknown) {
		showErrorNotice("Error editing metadata", error);
	}
}
