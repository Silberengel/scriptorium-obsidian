import { TFile } from "obsidian";
import { DEFAULT_KIND_TEMPLATES } from "./defaultKindTemplates";
import {
	KindTemplate,
	KindTemplateField,
	MarkupFormat,
	PublicationSectionKind,
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
	migratePublicationTemplates(settings);
}

/** Keep publication templates compatible with the contentKinds model. */
export function migratePublicationTemplates(settings: ScriptoriumSettings): void {
	const shipped = getDefaultTemplates();

	for (const shippedTemplate of shipped) {
		if (!settings.kindTemplates.some((t) => t.id === shippedTemplate.id)) {
			settings.kindTemplates.push(JSON.parse(JSON.stringify(shippedTemplate)) as KindTemplate);
		}
	}

	for (const template of settings.kindTemplates) {
		if (!template.structured) continue;

		if (!template.contentKinds?.length) {
			const legacy = template as KindTemplate & {
				contentTemplateId?: string;
				contentTemplateIds?: string[];
			};
			const ids = legacy.contentTemplateIds?.length
				? [...new Set(legacy.contentTemplateIds)]
				: legacy.contentTemplateId
					? [legacy.contentTemplateId]
					: [];
			const derived: PublicationSectionKind[] = [];
			for (const id of ids) {
				const section = getTemplateById(id, settings);
				if (section && !section.structured) {
					derived.push({ kind: section.kind, markup: section.markup ?? "asciidoc" });
				}
			}
			if (derived.length) template.contentKinds = derived;
		}

		delete (template as { contentTemplateId?: string }).contentTemplateId;
		delete (template as { contentTemplateIds?: string[] }).contentTemplateIds;
	}

	const shippedPub = shipped.find((t) => t.id === "kind-30040-default");
	const localPub = settings.kindTemplates.find((t) => t.id === "kind-30040-default");
	if (shippedPub && localPub?.type === "default") {
		localPub.contentKinds = JSON.parse(JSON.stringify(shippedPub.contentKinds ?? []));
		localPub.description = shippedPub.description;
		localPub.name = shippedPub.name;
	}

	settings.kindTemplates = settings.kindTemplates.filter(
		(t) => !(t.type === "custom" && t.folderName === "my-publication-sections")
	);

	for (const template of settings.kindTemplates) {
		template.fields = template.fields.filter((f) => f.key !== "auto_update");
	}
}

export function slugifyTemplateName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "publication";
}

function normalizeMarkup(value: unknown): MarkupFormat | null {
	if (value === "asciidoc" || value === "markdown") return value;
	if (value === "markup") return "markdown";
	return null;
}

/** Accept object pairs or flat [kind, markup, ...] arrays from hand-edited JSON. */
export function normalizeContentKinds(raw: unknown): PublicationSectionKind[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;

	if (typeof raw[0] === "object" && raw[0] !== null && "kind" in (raw[0] as object)) {
		const result: PublicationSectionKind[] = [];
		for (const item of raw) {
			if (typeof item !== "object" || item === null) return null;
			const kind = typeof (item as PublicationSectionKind).kind === "string"
				? parseInt((item as PublicationSectionKind).kind as unknown as string, 10)
				: (item as PublicationSectionKind).kind;
			const markup = normalizeMarkup((item as PublicationSectionKind).markup);
			if (!Number.isInteger(kind) || !markup) return null;
			result.push({ kind, markup });
		}
		return result;
	}

	const result: PublicationSectionKind[] = [];
	for (let i = 0; i + 1 < raw.length; i += 2) {
		const kindRaw = raw[i];
		const kind = typeof kindRaw === "string" ? parseInt(kindRaw, 10) : kindRaw;
		const markup = normalizeMarkup(raw[i + 1]);
		if (typeof kind !== "number" || !Number.isInteger(kind) || !markup) return null;
		result.push({ kind, markup });
	}
	return result.length ? result : null;
}

export function getPublicationContentKinds(
	publication: KindTemplate,
	settings?: ScriptoriumSettings
): PublicationSectionKind[] {
	if (publication.contentKinds?.length) {
		return publication.contentKinds;
	}
	if (!settings) return [];
	const legacy = publication as KindTemplate & {
		contentTemplateId?: string;
		contentTemplateIds?: string[];
	};
	const ids = legacy.contentTemplateIds?.length
		? [...new Set(legacy.contentTemplateIds)]
		: legacy.contentTemplateId
			? [legacy.contentTemplateId]
			: [];
	const derived: PublicationSectionKind[] = [];
	for (const id of ids) {
		const section = getTemplateById(id, settings);
		if (section && !section.structured) {
			derived.push({ kind: section.kind, markup: section.markup ?? "asciidoc" });
		}
	}
	return derived;
}

export function getTemplateById(id: string, settings: ScriptoriumSettings): KindTemplate | undefined {
	return settings.kindTemplates.find((t) => t.id === id);
}

const GENERIC_SCAFFOLD_IDS = new Set(["my-template", "my-publication"]);

/** Assign a stable id from the template name when still on a generic scaffold id; avoid duplicates. */
export function finalizeCustomTemplateForSave(
	settings: ScriptoriumSettings,
	template: KindTemplate,
	replaceId?: string
): KindTemplate {
	const copy = JSON.parse(JSON.stringify(template)) as KindTemplate;
	if (copy.type !== "custom") return copy;

	if (!copy.id?.trim() || GENERIC_SCAFFOLD_IDS.has(copy.id)) {
		copy.id = slugifyTemplateName(copy.name) || "custom-template";
	}

	let candidate = copy.id;
	let suffix = 2;
	while (
		settings.kindTemplates.some((t) => t.id === candidate && (!replaceId || t.id !== replaceId))
	) {
		candidate = `${copy.id}-${suffix++}`;
	}
	copy.id = candidate;
	return copy;
}

/** Resolve a template from document metadata using id, name slug, path, or kind. */
export function findTemplateForDocument(
	metadata: Partial<TemplateMetadata>,
	settings: ScriptoriumSettings,
	file?: TFile
): KindTemplate | undefined {
	const templateId = metadata.templateId ? String(metadata.templateId).trim() : undefined;

	if (templateId) {
		const exact = getTemplateById(templateId, settings);
		if (exact) return exact;

		const loose = settings.kindTemplates.find(
			(t) =>
				t.id.toLowerCase() === templateId.toLowerCase() ||
				slugifyTemplateName(t.name) === templateId
		);
		if (loose) return loose;
	}

	if (file) {
		const inferred = inferTemplateFromFile(file, settings);
		if (inferred) return inferred;
	}

	const kind =
		typeof metadata.kind === "string" ? parseInt(metadata.kind, 10) : metadata.kind;
	if (kind !== undefined && !Number.isNaN(kind)) {
		const customs = settings.kindTemplates.filter((t) => t.type === "custom" && t.kind === kind);
		if (customs.length === 1) return customs[0];
		if (customs.length > 1 && templateId) {
			const match = customs.find(
				(t) => t.id === templateId || slugifyTemplateName(t.name) === templateId
			);
			if (match) return match;
		}
	}

	return undefined;
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

/** Match a document file to a custom template by folder + filename. */
export function inferTemplateFromFile(
	file: TFile,
	settings: ScriptoriumSettings
): KindTemplate | undefined {
	const match = file.path.match(/^Nostr notes\/([^/]+)\/([^/]+)\.[^.]+$/);
	if (!match) return undefined;
	const [, folderName, basename] = match;

	const exact = settings.kindTemplates.find(
		(t) => t.type === "custom" && t.folderName === folderName && t.id === basename
	);
	if (exact) return exact;

	const inFolder = settings.kindTemplates.filter(
		(t) => t.type === "custom" && t.folderName === folderName
	);
	if (inFolder.length === 1) return inFolder[0];

	return undefined;
}

export function getAllTemplates(settings: ScriptoriumSettings): KindTemplate[] {
	return settings.kindTemplates;
}

export function isPublicationSectionOnlyTemplate(template: KindTemplate): boolean {
	return template.id === "kind-30041-default";
}

export function getSelectableTemplates(settings: ScriptoriumSettings): KindTemplate[] {
	const sectionOnlyIds = new Set<string>();
	for (const t of settings.kindTemplates) {
		if (isPublicationSectionOnlyTemplate(t)) {
			sectionOnlyIds.add(t.id);
		}
	}
	return settings.kindTemplates.filter((t) => !sectionOnlyIds.has(t.id));
}

/** Label for publication section picker, e.g. "30041 (Asciidoc)". */
export function formatPublicationSectionLabel(section: PublicationSectionKind): string {
	const markupLabel = section.markup.charAt(0).toUpperCase() + section.markup.slice(1);
	return `${section.kind} (${markupLabel})`;
}

export function sectionKindKey(section: PublicationSectionKind): string {
	return `${section.kind}:${section.markup}`;
}

export function parseSectionKindKey(key: string): PublicationSectionKind | null {
	const [kindRaw, markup] = key.split(":");
	const kind = parseInt(kindRaw, 10);
	if (!Number.isInteger(kind) || (markup !== "asciidoc" && markup !== "markdown")) return null;
	return { kind, markup };
}

export function resolveSectionKind(
	publication: KindTemplate,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata>
): PublicationSectionKind | undefined {
	const kinds = getPublicationContentKinds(publication, settings);
	if (!kinds.length) return undefined;

	if (metadata?.sectionKind !== undefined && metadata.sectionMarkup) {
		const sectionKind =
			typeof metadata.sectionKind === "string"
				? parseInt(metadata.sectionKind, 10)
				: metadata.sectionKind;
		const match = kinds.find(
			(k) => k.kind === sectionKind && k.markup === metadata.sectionMarkup
		);
		if (match) return match;
	}

	const legacy = metadata as { sectionTemplateId?: string } | undefined;
	if (legacy?.sectionTemplateId) {
		const sectionTemplate = getTemplateById(legacy.sectionTemplateId, settings);
		if (sectionTemplate) {
			const match = kinds.find(
				(k) =>
					k.kind === sectionTemplate.kind &&
					k.markup === (sectionTemplate.markup ?? "asciidoc")
			);
			if (match) return match;
		}
	}

	return kinds[0];
}

export function findTemplateForSection(
	settings: ScriptoriumSettings,
	section: PublicationSectionKind
): KindTemplate {
	const matches = settings.kindTemplates.filter(
		(t) =>
			t.type === "default" &&
			!t.structured &&
			t.kind === section.kind &&
			(t.markup ?? "asciidoc") === section.markup
	);
	if (matches.length >= 1) return matches[0];
	return createPublicationSectionScaffold(section);
}

export function resolveSectionTemplate(
	publication: KindTemplate,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata>
): KindTemplate | undefined {
	const section = resolveSectionKind(publication, settings, metadata);
	if (!section) return undefined;
	return findTemplateForSection(settings, section);
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

export function getContentTemplate(
	template: KindTemplate,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata>
): KindTemplate | undefined {
	if (template.structured) {
		return resolveSectionTemplate(template, settings, metadata);
	}
	return undefined;
}

/** Markup for source documents. Publications inherit from the active section template. */
export function getDocumentMarkup(
	template: KindTemplate,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata>
): MarkupFormat {
	if (template.structured) {
		const content = getContentTemplate(template, settings, metadata);
		if (content?.markup) return content.markup;
	}
	return template.markup ?? "asciidoc";
}

export function getFileExtension(
	template: KindTemplate,
	settings: ScriptoriumSettings,
	metadata?: Partial<TemplateMetadata>
): string {
	const markup = getDocumentMarkup(template, settings, metadata);
	return markup === "asciidoc" ? "adoc" : "md";
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

	const template = parsed as KindTemplate;
	if (template.structured && template.contentKinds) {
		const normalized = normalizeContentKinds(template.contentKinds);
		if (normalized) template.contentKinds = normalized;
	}

	return { success: true, template };
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
	if (!template.structured) {
		if (template.markup !== "markdown" && template.markup !== "asciidoc") {
			errors.push('markup must be "markdown" or "asciidoc"');
		}
	}
	if (template.structured) {
		const normalized = normalizeContentKinds(template.contentKinds);
		if (normalized?.length) {
			template.contentKinds = normalized;
		}
		const contentKinds = template.contentKinds ?? [];
		if (!contentKinds.length) {
			errors.push(
				'structured templates require "contentKinds" — allowed section kind + markup pairs (use Add → Publication)'
			);
		} else {
			for (const section of contentKinds) {
				const kindError = validateNip01Kind(section.kind);
				if (kindError) {
					errors.push(`contentKinds: ${kindError}`);
				}
				if (section.markup !== "markdown" && section.markup !== "asciidoc") {
					errors.push(
						`contentKinds: kind ${section.kind} has invalid markup "${section.markup}" (use "asciidoc" or "markdown")`
					);
				}
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

export function createCustomTemplateScaffold(name = "My Template"): KindTemplate {
	const id = slugifyTemplateName(name) || "custom-template";
	return {
		id,
		type: "custom",
		kind: 30023,
		name,
		description: "Single-document template (article, note, wiki page)",
		markup: "markdown",
		structured: false,
		folderName: "my-templates",
		fields: [
			{ key: "title", tagType: "title", description: "Title", required: true },
		],
	};
}

/** Section template for one allowed content kind + markup pair. */
export function createPublicationSectionScaffold(
	config: PublicationSectionKind,
	id?: string
): KindTemplate {
	const sectionId = id ?? `my-publication-k${config.kind}-${config.markup}`;
	return {
		id: sectionId,
		type: "custom",
		kind: config.kind,
		name: `Sections (kind ${config.kind}, ${config.markup})`,
		description: `Section events: kind ${config.kind}, ${config.markup} source markup`,
		markup: config.markup,
		structured: false,
		folderName: "my-publication-sections",
		fields: [
			{ key: "title", tagType: "title", description: "Section title (required)", required: true },
			{ key: "summary", tagType: "text", description: "Brief summary", required: false },
			{ key: "topics", tagType: "topics", description: "Comma-separated topics", required: false },
		],
	};
}

export interface PublicationSetupConfig {
	publicationId?: string;
	indexKind?: number;
	name?: string;
	sectionKinds: PublicationSectionKind[];
}

/** Hierarchical publication template — source file splits into index + section events. */
export function createPublicationTemplate(config: PublicationSetupConfig): KindTemplate {
	const publicationId = config.publicationId ?? slugifyTemplateName(config.name ?? "publication");
	return {
		id: publicationId,
		type: "custom",
		kind: config.indexKind ?? 30040,
		name: config.name ?? "My Publication",
		description: "Hierarchical publication: one source file splits into index and section Nostr events",
		structured: true,
		contentKinds: config.sectionKinds,
		folderName: "my-publications",
		fields: [
			{ key: "title", tagType: "title", description: "Publication title (required)", required: true },
			{ key: "author", tagType: "text", description: "Author name", required: false },
			{ key: "summary", tagType: "text", description: "Brief description", required: false },
			{ key: "topics", tagType: "topics", description: "Comma-separated topics", required: false },
		],
	};
}

/** @deprecated Use createPublicationTemplate */
export function createPublicationTemplates(config: PublicationSetupConfig): {
	publication: KindTemplate;
	sections: KindTemplate[];
} {
	const publication = createPublicationTemplate(config);
	return { publication, sections: [] };
}

/** @deprecated Use createPublicationTemplate */
export function createPublicationScaffold(
	_sectionTemplateIds: string[],
	config?: { publicationId?: string; indexKind?: number; name?: string }
): KindTemplate {
	return createPublicationTemplate({
		publicationId: config?.publicationId,
		indexKind: config?.indexKind,
		name: config?.name,
		sectionKinds: [{ kind: 30041, markup: "asciidoc" }],
	});
}

export function createPublicationTemplatePair(
	sectionKinds: PublicationSectionKind[] = [{ kind: 30041, markup: "asciidoc" }]
): { publication: KindTemplate; sections: KindTemplate[] } {
	return createPublicationTemplates({ sectionKinds });
}

/** @deprecated Use createPublicationSectionScaffold */
export function createStructuredContentTemplateScaffold(
	markup: MarkupFormat = "asciidoc"
): KindTemplate {
	return createPublicationSectionScaffold({ kind: 30041, markup });
}

/** @deprecated Use createPublicationTemplate */
export function createStructuredIndexTemplateScaffold(): KindTemplate {
	return createPublicationTemplate({ sectionKinds: [{ kind: 30041, markup: "asciidoc" }] });
}
