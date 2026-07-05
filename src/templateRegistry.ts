import { DEFAULT_KIND_TEMPLATES } from "./defaultKindTemplates";
import {
	KindTemplate,
	KindTemplateField,
	ScriptoriumSettings,
	TemplateMetadata,
} from "./types";
import { getNip01KindClass, requiresDTag, validateNip01Kind } from "./utils/nip01Kind";

const SHIPPED_DEFAULT_IDS = new Set(DEFAULT_KIND_TEMPLATES.map((t) => t.id));

export function getDefaultTemplates(): KindTemplate[] {
	return JSON.parse(JSON.stringify(DEFAULT_KIND_TEMPLATES)) as KindTemplate[];
}

export function ensureKindTemplates(settings: ScriptoriumSettings): void {
	if (!settings.kindTemplates || settings.kindTemplates.length === 0) {
		settings.kindTemplates = getDefaultTemplates();
	}
	if (!settings.defaultTemplateId) {
		settings.defaultTemplateId = "kind-1-default";
	}
	// Migrate legacy defaultEventKind
	const legacy = (settings as { defaultEventKind?: number }).defaultEventKind;
	if (legacy !== undefined && !settings.kindTemplates.some((t) => t.id === settings.defaultTemplateId)) {
		const match = settings.kindTemplates.find(
			(t) => t.type === "default" && t.kind === legacy
		);
		if (match) {
			settings.defaultTemplateId = match.id;
		}
	}
	delete (settings as { defaultEventKind?: number }).defaultEventKind;
}

export function getTemplateById(id: string, settings: ScriptoriumSettings): KindTemplate | undefined {
	return settings.kindTemplates.find((t) => t.id === id);
}

export function getTemplatesByKind(kind: number, settings: ScriptoriumSettings): KindTemplate[] {
	return settings.kindTemplates.filter((t) => t.kind === kind);
}

export function resolveTemplate(
	metadata: Partial<TemplateMetadata>,
	settings: ScriptoriumSettings
): KindTemplate {
	if (metadata.templateId) {
		const t = getTemplateById(metadata.templateId, settings);
		if (t) return t;
		throw new Error(`Unknown templateId: ${metadata.templateId}`);
	}
	if (metadata.kind !== undefined) {
		const matches = getTemplatesByKind(metadata.kind, settings);
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) {
			const fallback = getTemplateById(settings.defaultTemplateId, settings);
			if (fallback && fallback.kind === metadata.kind) return fallback;
			throw new Error(`Ambiguous kind ${metadata.kind}: set templateId in metadata`);
		}
	}
	const fallback = getTemplateById(settings.defaultTemplateId, settings);
	if (fallback) return fallback;
	throw new Error("No template could be resolved for this document");
}

export function getAllTemplates(settings: ScriptoriumSettings): KindTemplate[] {
	return settings.kindTemplates;
}

export function getSelectableTemplates(settings: ScriptoriumSettings): KindTemplate[] {
	return settings.kindTemplates.filter((t) => !t.contentTemplateId || t.structured);
}

export function isDeletableTemplate(template: KindTemplate): boolean {
	return template.type === "custom";
}

export function getFolderName(template: KindTemplate): string {
	return template.folderName || `kind-${template.kind}`;
}

export function getRequiredFields(template: KindTemplate): KindTemplateField[] {
	return template.fields.filter((f) => f.required);
}

export function getFileExtension(template: KindTemplate): string {
	return template.markup === "asciidoc" ? "adoc" : "md";
}

export function resetTemplateToDefault(id: string, settings: ScriptoriumSettings): KindTemplate | null {
	const shipped = DEFAULT_KIND_TEMPLATES.find((t) => t.id === id);
	if (!shipped) return null;
	const copy = JSON.parse(JSON.stringify(shipped)) as KindTemplate;
	const idx = settings.kindTemplates.findIndex((t) => t.id === id);
	if (idx >= 0) {
		settings.kindTemplates[idx] = copy;
	} else {
		settings.kindTemplates.push(copy);
	}
	return copy;
}

export function resetAllTemplatesToDefaults(settings: ScriptoriumSettings): void {
	const custom = settings.kindTemplates.filter((t) => t.type === "custom");
	const defaults = getDefaultTemplates();
	settings.kindTemplates = [...defaults, ...custom];
}

export interface TemplateValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export type ParseKindTemplateResult =
	| { success: true; template: KindTemplate }
	| { success: false; errors: string[] };

function describeInvalidKindInJson(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"')) {
		return `kind must be an integer, not a quoted string (found ${trimmed}). Use a bare number like 30023.`;
	}
	if (!/^-?\d+$/.test(trimmed)) {
		const value = trimmed.replace(/,$/, "");
		return `kind must be an integer (NIP-01 event kind), but "${value}" is not valid JSON. Use a bare number like 30023 with no letters or extra characters.`;
	}
	return null;
}

function friendlyTemplateJsonErrors(text: string, error: unknown): string[] {
	const kindMatch = text.match(/"kind"\s*:\s*([^,\r\n}]+)/);
	if (kindMatch) {
		const kindError = describeInvalidKindInJson(kindMatch[1]);
		if (kindError) return [kindError];
	}

	const msg = error instanceof Error ? error.message : String(error);
	const lineMatch = msg.match(/line (\d+)/i);
	if (lineMatch) {
		const lineNum = parseInt(lineMatch[1], 10);
		const line = text.split("\n")[lineNum - 1]?.trim() ?? "";
		if (line.includes('"kind"')) {
			return [
				`Invalid value for kind on line ${lineNum}. It must be a bare integer (NIP-01 event kind), e.g. 30023.`,
			];
		}
	}

	return [`Invalid JSON syntax: ${msg}`];
}

export function parseKindTemplateJson(text: string): ParseKindTemplateResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return { success: false, errors: friendlyTemplateJsonErrors(text, error) };
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { success: false, errors: ["Template must be a JSON object"] };
	}

	return { success: true, template: parsed as KindTemplate };
}

export function validateTemplate(
	template: KindTemplate,
	allTemplates: KindTemplate[]
): TemplateValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!template.id || typeof template.id !== "string") {
		errors.push("Template must have a non-empty id");
	}
	if (template.type !== "default" && template.type !== "custom") {
		errors.push('type must be "default" or "custom"');
	}
	if (template.type === "default" && !SHIPPED_DEFAULT_IDS.has(template.id)) {
		errors.push(`type "default" is only allowed for shipped template ids`);
	}
	if (template.type === "custom" && SHIPPED_DEFAULT_IDS.has(template.id)) {
		errors.push(`Cannot use shipped default id "${template.id}" for a custom template`);
	}
	const kindError = validateNip01Kind(template.kind);
	if (kindError) {
		errors.push(kindError);
	}
	if (!template.name) {
		errors.push("name is required");
	}
	if (template.markup !== "markdown" && template.markup !== "asciidoc") {
		errors.push('markup must be "markdown" or "asciidoc"');
	}
	if (template.structured && template.markup !== "asciidoc") {
		errors.push(
			'structured templates require "markup": "asciidoc" (AsciiDoc headings define the publication hierarchy)'
		);
	}
	if (template.structured) {
		if (!template.contentTemplateId) {
			errors.push(
				'structured templates require "contentTemplateId" — the id of a non-structured content template (create a Publication Content template first, then reference its id here)'
			);
		} else if (template.contentTemplateId === template.id) {
			errors.push("contentTemplateId must not equal template id");
		} else {
			const content = allTemplates.find((t) => t.id === template.contentTemplateId);
			if (!content) {
				errors.push(`contentTemplateId "${template.contentTemplateId}" not found`);
			} else if (content.structured) {
				errors.push("content template must not be structured");
			}
		}
	}
	if (!kindError && requiresDTag(template.kind)) {
		const titleField = template.fields?.find((f) => f.tagType === "title");
		if (!titleField || !titleField.required) {
			errors.push("Addressable kinds require a title field with required: true");
		}
	}
	if (!kindError && getNip01KindClass(template.kind) === "ephemeral") {
		warnings.push("Ephemeral kinds (20000-29999) are not stored by relays");
	}
	if (!Array.isArray(template.fields) || template.fields.length === 0) {
		errors.push("fields array is required and must not be empty");
	} else {
		const keys = new Set<string>();
		for (const field of template.fields) {
			if (!field.key) errors.push("Each field must have a key");
			if (keys.has(field.key)) errors.push(`Duplicate field key: ${field.key}`);
			keys.add(field.key);
			if (typeof field.required !== "boolean") {
				errors.push(`Field "${field.key}" must have required: boolean`);
			}
			if (!field.description) errors.push(`Field "${field.key}" must have a description`);
			if (!["text", "topics", "title"].includes(field.tagType)) {
				errors.push(`Field "${field.key}" has invalid tagType`);
			}
		}
	}

	const dupId = allTemplates.filter((t) => t.id === template.id);
	if (dupId.length > 1) {
		errors.push(`Duplicate template id: ${template.id}`);
	}

	return { valid: errors.length === 0, errors, warnings };
}

export function validateTemplatesArray(templates: KindTemplate[]): TemplateValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const ids = new Set<string>();
	for (const t of templates) {
		if (ids.has(t.id)) errors.push(`Duplicate template id: ${t.id}`);
		ids.add(t.id);
		const result = validateTemplate(t, templates);
		errors.push(...result.errors);
		warnings.push(...result.warnings);
	}
	return { valid: errors.length === 0, errors, warnings };
}

export function createCustomTemplateScaffold(): KindTemplate {
	return {
		id: "my-template",
		type: "custom",
		kind: 30023,
		name: "My Template",
		description: "Single-document template (article, note, wiki page)",
		markup: "markdown",
		structured: false,
		folderName: "my-templates",
		fields: [
			{ key: "title", tagType: "title", description: "Title", required: true },
		],
	};
}

/** Scaffold for chapter/section content used by a structured publication index. Create this first. */
export function createStructuredContentTemplateScaffold(): KindTemplate {
	return {
		id: "my-publication-content",
		type: "custom",
		kind: 30041,
		name: "My Publication Content",
		description: "Chapter or section content for a structured publication",
		markup: "asciidoc",
		structured: false,
		folderName: "my-publication-sections",
		fields: [
			{ key: "title", tagType: "title", description: "Section title (required)", required: true },
			{ key: "summary", tagType: "text", description: "Brief summary", required: false },
			{ key: "topics", tagType: "topics", description: "Comma-separated topics", required: false },
		],
	};
}

/** Scaffold for a structured publication index. Set contentTemplateId to your content template's id. */
export function createStructuredIndexTemplateScaffold(
	contentTemplateId = "my-publication-content"
): KindTemplate {
	return {
		id: "my-publication-index",
		type: "custom",
		kind: 30040,
		name: "My Publication Index",
		description: "Root index for a multi-part publication (book, documentation, magazine)",
		markup: "asciidoc",
		structured: true,
		contentTemplateId,
		folderName: "my-publications",
		fields: [
			{ key: "title", tagType: "title", description: "Publication title (required)", required: true },
			{ key: "author", tagType: "text", description: "Author name", required: false },
			{ key: "summary", tagType: "text", description: "Brief description", required: false },
			{ key: "topics", tagType: "topics", description: "Comma-separated topics", required: false },
		],
	};
}
