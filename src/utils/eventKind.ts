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
	inferTemplateFromFile,
	findTemplateForDocument,
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
				if (isStructuredSourceDocument(content, section.markup, file, metadata)) return fromMeta;
			}
		}
	}

	for (const publication of settings.kindTemplates.filter((t) => t.structured)) {
		for (const section of getPublicationContentKinds(publication, settings)) {
			if (isStructuredSourceDocument(content, section.markup, file, metadata ?? undefined)) return publication;
		}
	}

	return undefined;
}

/**
 * Resolve template for a document, falling back to path/kind inference when templateId is missing or stale.
 */
export function resolveTemplateForFile(
	metadata: Partial<TemplateMetadata> | null | undefined,
	settings: ScriptoriumSettings,
	file: TFile,
	content: string
): KindTemplate {
	const meta = metadata ?? {};

	const found = findTemplateForDocument(meta, settings, file);
	if (found) return found;

	if (meta.templateId) {
		const customIds = settings.kindTemplates.filter((t) => t.type === "custom").map((t) => t.id);
		const hint = customIds.length
			? ` Registered custom templates: ${customIds.join(", ")}.`
			: " Add your template in Settings → Event Kind Templates.";
		throw new Error(`Unknown templateId "${meta.templateId}".${hint}`);
	}

	return determineTemplate(file, content, settings, meta);
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

	const inferred = inferTemplateFromFile(file, settings);
	if (inferred) return inferred;

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
