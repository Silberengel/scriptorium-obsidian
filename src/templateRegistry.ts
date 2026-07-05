import { DEFAULT_KIND_TEMPLATES } from "./defaultKindTemplates";
import {
	KindTemplate,
	KindTemplateField,
	ScriptoriumSettings,
	TemplateMetadata,
} from "./types";
import { requiresDTag } from "./utils/nip01Kind";
import { getNip01KindClass } from "./utils/nip01Kind";

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
	if (!Number.isInteger(template.kind) || template.kind < 1 || template.kind > 65535) {
		errors.push("kind must be an integer between 1 and 65535");
	}
	if (!template.name) {
		errors.push("name is required");
	}
	if (template.markup !== "markdown" && template.markup !== "asciidoc") {
		errors.push('markup must be "markdown" or "asciidoc"');
	}
	if (template.structured && template.markup !== "asciidoc") {
		errors.push("structured templates require asciidoc markup");
	}
	if (template.structured) {
		if (!template.contentTemplateId) {
			errors.push("structured templates require contentTemplateId");
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
	if (requiresDTag(template.kind)) {
		const titleField = template.fields?.find((f) => f.tagType === "title");
		if (!titleField || !titleField.required) {
			errors.push("Addressable kinds require a title field with required: true");
		}
	}
	if (getNip01KindClass(template.kind) === "ephemeral") {
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
		description: "",
		markup: "markdown",
		structured: false,
		folderName: "my-templates",
		fields: [
			{ key: "title", tagType: "title", description: "Title", required: true },
		],
	};
}
