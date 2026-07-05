import { TFile } from "obsidian";
import { KindTemplate, ScriptoriumSettings, TemplateMetadata } from "../types";
import { isAsciiDocFile } from "./fileExtensions";
import { isAsciiDocDocument } from "../asciidocParser";
import { resolveTemplate, getTemplateById } from "../templateRegistry";

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

	if (isAsciiDocFile(file)) {
		if (isAsciiDocDocument(content)) {
			const structured = settings.kindTemplates.find((t) => t.structured && t.markup === "asciidoc");
			if (structured) return structured;
		}
		const wiki = getTemplateById("kind-30818-default", settings);
		if (wiki) return wiki;
	}

	const defaultTemplate = getTemplateById(settings.defaultTemplateId, settings);
	if (defaultTemplate) return defaultTemplate;

	return settings.kindTemplates[0];
}

export function getFolderNameForTemplate(template: KindTemplate): string {
	return template.folderName || `kind-${template.kind}`;
}
