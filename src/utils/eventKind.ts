import { TFile } from "obsidian";
import { KindTemplate, ScriptoriumSettings, TemplateMetadata } from "../types";
import { isAsciiDocFile, isMarkdownFile } from "./fileExtensions";
import { isAsciiDocDocument } from "../asciidocParser";
import { isMarkdownHierarchicalDocument } from "../markdownParser";
import { isStructuredSourceDocument } from "../structureParser";
import {
	resolveTemplate,
	getTemplateById,
	getPublicationContentKinds,
} from "../templateRegistry";

function findStructuredTemplateForContent(
	content: string,
	file: TFile,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata> | null
): KindTemplate | undefined {
	if (metadata?.templateId) {
		const fromMeta = getTemplateById(metadata.templateId, settings);
		if (fromMeta?.structured) {
			for (const section of getPublicationContentKinds(fromMeta, settings)) {
				if (isStructuredSourceDocument(content, section.markup, file)) return fromMeta;
			}
		}
	}

	for (const publication of settings.kindTemplates.filter((t) => t.structured)) {
		for (const section of getPublicationContentKinds(publication, settings)) {
			if (isStructuredSourceDocument(content, section.markup, file)) return publication;
		}
	}

	return undefined;
}

export function determineTemplate(
	file: TFile,
	content: string,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata> | null
): KindTemplate {
	if (metadata) {
		try {
			return resolveTemplate(metadata, settings);
		} catch {
			// fall through
		}
	}

	if (metadata?.kind !== undefined) {
		const matches = settings.kindTemplates.filter((t) => t.kind === metadata.kind);
		if (matches.length === 1) return matches[0];
	}

	const structured = findStructuredTemplateForContent(content, file, settings, metadata);
	if (structured) return structured;

	if (isAsciiDocFile(file) && isAsciiDocDocument(content)) {
		const wiki = getTemplateById("kind-30818-default", settings);
		if (wiki) return wiki;
	}

	if (isMarkdownFile(file) && !isMarkdownHierarchicalDocument(content)) {
		const wiki = getTemplateById("kind-30817-default", settings);
		if (wiki) return wiki;
	}

	const defaultTemplate = getTemplateById(settings.defaultTemplateId, settings);
	if (defaultTemplate) return defaultTemplate;

	return settings.kindTemplates[0];
}

export function getFolderNameForTemplate(template: KindTemplate): string {
	return template.folderName || `kind-${template.kind}`;
}
