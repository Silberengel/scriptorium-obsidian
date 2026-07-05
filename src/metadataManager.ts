import { TFile } from "obsidian";
import { KindTemplate, KindTemplateField, TemplateMetadata, MarkupFormat, ScriptoriumSettings, PublicationSectionKind } from "./types";
import { getDocumentMarkup } from "./templateRegistry";
import { safeConsoleError } from "./utils/security";
import { isMarkdownFile, isAsciiDocFile } from "./utils/fileExtensions";
import { stripEmbeddedDocumentHelp, buildDocumentHelpCallout, buildDocumentHelpAsciiDoc } from "./documentHelp";

const RESERVED_KEYS = new Set(["kind", "templateId", "published_at"]);

export function getFieldsForTemplate(template: KindTemplate): KindTemplateField[] {
	return template.fields;
}

function getPlaceholder(field: KindTemplateField): string {
	return field.description;
}

export function extractTemplateId(file: TFile, content: string): string | null {
	if (isMarkdownFile(file)) {
		const { metadata } = parseMarkdownFrontmatter(content);
		return typeof metadata.templateId === "string" ? metadata.templateId : null;
	}
	if (isAsciiDocFile(file)) {
		const { metadata } = parseAsciiDocAttributes(content);
		return typeof metadata.templateId === "string" ? metadata.templateId : null;
	}
	return null;
}

function isPlaceholder(value: unknown, field: KindTemplateField): boolean {
	if (value === null || value === undefined || value === "") return true;
	if (typeof value !== "string") return false;
	const placeholder = getPlaceholder(field);
	return value === placeholder || value.trim() === placeholder;
}

export function isMetadataPlaceholder(value: unknown, field: KindTemplateField): boolean {
	return isPlaceholder(value, field);
}

function escapeYamlString(value: string): string {
	return JSON.stringify(value);
}

function formatYamlScalar(value: unknown): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return String(value);
	return escapeYamlString(String(value));
}

function formatAsciiDocAttributeValue(value: unknown): string {
	return String(value).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function parseMarkdownFrontmatter(content: string): { metadata: Record<string, unknown>; body: string } {
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (!match) {
		return { metadata: {}, body: content };
	}

	const frontmatterText = match[1];
	const body = match[2];
	const metadata: Record<string, unknown> = {};
	const lines = frontmatterText.split("\n");
	let currentArrayKey: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		if (trimmed.startsWith("-")) {
			const item = trimmed.slice(1).trim().replace(/^["']|["']$/g, "");
			if (currentArrayKey) {
				if (!metadata[currentArrayKey]) metadata[currentArrayKey] = [];
				(metadata[currentArrayKey] as string[]).push(item);
			}
			continue;
		}

		currentArrayKey = null;
		const colonIndex = trimmed.indexOf(":");
		if (colonIndex === -1) continue;

		const key = trimmed.substring(0, colonIndex).trim();
		let value = trimmed.substring(colonIndex + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		if (value.startsWith("[") && value.endsWith("]")) {
			const arrayContent = value.slice(1, -1).trim();
			metadata[key] = arrayContent
				? arrayContent.split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""))
				: [];
		} else if (value === "true") metadata[key] = true;
		else if (value === "false") metadata[key] = false;
		else if (/^-?\d+$/.test(value)) metadata[key] = parseInt(value, 10);
		else if (value === "") {
			metadata[key] = metadata[key] ?? "";
			currentArrayKey = key;
		} else {
			metadata[key] = value;
		}

		if (key === "kind" && typeof metadata[key] === "string") {
			metadata[key] = parseInt(metadata[key] as string, 10);
		}
	}

	return { metadata, body };
}

function parseAsciiDocAttributes(content: string): { metadata: Record<string, unknown>; body: string } {
	const metadata: Record<string, unknown> = {};
	const lines = content.split("\n");
	let bodyStartIndex = 0;
	let foundTitle = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		if (line.startsWith("=") && !line.startsWith("==") && !foundTitle) {
			metadata.title = line.slice(1).trim();
			foundTitle = true;
			bodyStartIndex = i + 1;
			continue;
		}

		if (line.startsWith(":") && line.includes(":")) {
			const colonIndex = line.indexOf(":", 1);
			if (colonIndex !== -1) {
				let key = line.substring(1, colonIndex).trim();
				const isRequired = key.endsWith("!");
				if (isRequired) key = key.slice(0, -1);
				let value = line.substring(colonIndex + 1).trim();

				if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}

				if (value === "true") metadata[key] = true;
				else if (value === "false") metadata[key] = false;
				else if (/^-?\d+$/.test(value)) metadata[key] = parseInt(value, 10);
				else metadata[key] = value;

				if (key === "kind" && typeof metadata[key] === "string") {
					metadata[key] = parseInt(metadata[key] as string, 10);
				}
			}
			bodyStartIndex = i + 1;
			continue;
		}

		if (foundTitle) {
			if (line === "") {
				bodyStartIndex = i + 1;
				continue;
			}
			if (!line.startsWith(":")) {
				bodyStartIndex = i;
				break;
			}
		}
	}

	return { metadata, body: lines.slice(bodyStartIndex).join("\n") };
}

function normalizeMetadataTypes(metadata: Record<string, unknown>): void {
	for (const key of ["kind", "sectionKind"] as const) {
		const value = metadata[key];
		if (typeof value === "string" && /^-?\d+$/.test(value)) {
			metadata[key] = parseInt(value, 10);
		}
	}
}

function filterPlaceholders(metadata: Record<string, unknown>, template?: KindTemplate): Record<string, unknown> {
	const filtered: Record<string, unknown> = {};
	const fieldMap = new Map((template?.fields ?? []).map((f) => [f.key, f]));

	for (const [key, value] of Object.entries(metadata)) {
		if (key === "kind" || key === "templateId") {
			filtered[key] = value;
			continue;
		}
		if (key === "published_at") continue;

		const field = fieldMap.get(key);
		if (field && isPlaceholder(value, field)) continue;

		if (Array.isArray(value) && field) {
			const filteredArray = value.filter((item) => !isPlaceholder(item, field));
			if (filteredArray.length > 0) filtered[key] = filteredArray;
		} else if (value !== "" && value != null) {
			filtered[key] = value;
		}
	}

	return filtered;
}

export async function readMetadata(
	file: TFile,
	app: {
		vault: { read: (f: TFile) => Promise<string> };
		metadataCache?: { getFileCache: (f: TFile) => { frontmatter?: Record<string, unknown> } | null };
	},
	template?: KindTemplate
): Promise<TemplateMetadata | null> {
	try {
		const content = await app.vault.read(file);
		const cached = app.metadataCache?.getFileCache(file)?.frontmatter ?? {};

		if (isMarkdownFile(file)) {
			const { metadata } = parseMarkdownFrontmatter(content);
			// Parsed file content is authoritative; cache only fills keys missing from the file.
			const merged = { ...cached, ...metadata };
			normalizeMetadataTypes(merged);
			if (Object.keys(merged).length === 0) return null;
			return filterPlaceholders(merged, template) as TemplateMetadata;
		}

		if (isAsciiDocFile(file)) {
			const { metadata } = parseAsciiDocAttributes(content);
			// Parsed file content is authoritative; cache only fills keys missing from the file.
			const merged = { ...cached, ...metadata };
			normalizeMetadataTypes(merged);
			if (Object.keys(merged).length === 0) return null;
			return filterPlaceholders(merged, template) as TemplateMetadata;
		}

		return null;
	} catch (error) {
		safeConsoleError("Error reading metadata:", error);
		return null;
	}
}

export function stripMetadataFromContent(file: TFile, content: string): string {
	let body: string;
	if (isMarkdownFile(file)) {
		body = parseMarkdownFrontmatter(content).body;
	} else if (isAsciiDocFile(file)) {
		const lines = content.split("\n");
		const result: string[] = [];
		let foundTitle = false;
		let inAttributes = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			if (line.startsWith("=") && !line.startsWith("==") && !foundTitle) {
				result.push(lines[i]);
				foundTitle = true;
				inAttributes = true;
				continue;
			}

			if (inAttributes && line.startsWith(":")) continue;

			if (inAttributes && line !== "") inAttributes = false;

			if (!inAttributes || line === "") result.push(lines[i]);
		}

		body = result.join("\n");
	} else {
		body = content;
	}

	return stripEmbeddedDocumentHelp(body);
}

function formatMarkdownFrontmatter(metadata: TemplateMetadata, template: KindTemplate): string {
	const lines: string[] = [];
	const meta = metadata as Record<string, unknown>;

	lines.push(`templateId: ${escapeYamlString(String(metadata.templateId || template.id))}`);
	lines.push(`kind: ${metadata.kind}`);

	for (const field of template.fields) {
		const value = meta[field.key];
		if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, field)) {
			if (Array.isArray(value)) {
				lines.push(`${field.key}: [${value.map((t: string) => escapeYamlString(String(t))).join(", ")}]`);
			} else {
				lines.push(`${field.key}: ${formatYamlScalar(value)}`);
			}
		} else {
			lines.push(`${field.key}: ${escapeYamlString(getPlaceholder(field))}`);
		}
	}

	for (const [key, value] of Object.entries(meta)) {
		if (RESERVED_KEYS.has(key) || template.fields.some((f) => f.key === key)) continue;
		if (value !== undefined && value !== null && value !== "") {
			if (Array.isArray(value)) {
				lines.push(`${key}: [${value.map((t: string) => escapeYamlString(String(t))).join(", ")}]`);
			} else {
				lines.push(`${key}: ${formatYamlScalar(value)}`);
			}
		}
	}

	return lines.join("\n") + "\n";
}

function appendDefaultBody(lines: string[], template: KindTemplate, documentMarkup: MarkupFormat): void {
	if (documentMarkup === "asciidoc") {
		lines.push(...buildDocumentHelpAsciiDoc(template), "");
	} else {
		lines.push(...buildDocumentHelpCallout(template), "");
	}

	if (template.kind === 1) {
		lines.push("place your content here");
		return;
	}

	// Hierarchical publication source file: AsciiDoc headings define the tree that splits into events.
	if (template.structured) {
		if (documentMarkup === "asciidoc") {
			lines.push(
				"== First chapter",
				"",
				"=== First section",
				"",
				"Section body text here.",
				"",
				"=== Second section",
				"",
				"More section body text.",
				"",
				"== Second chapter",
				"",
				"Another chapter section."
			);
		} else {
			lines.push(
				"## First chapter",
				"",
				"### First section",
				"",
				"Section body text here.",
				"",
				"### Second section",
				"",
				"More section body text."
			);
		}
		return;
	}

	if (documentMarkup === "asciidoc") {
		lines.push("== This is the first header in this document", "", "place your content here");
		return;
	}
	lines.push("# This is the first header in this document", "", "place your content here");
}

export async function writeMetadata(
	file: TFile,
	metadata: TemplateMetadata,
	app: { vault: { read: (f: TFile) => Promise<string>; modify: (f: TFile, c: string) => Promise<void> } },
	template: KindTemplate,
	settings?: ScriptoriumSettings
): Promise<void> {
	try {
		const currentContent = await app.vault.read(file);
		metadata.templateId = metadata.templateId || template.id;
		metadata.kind = template.kind;
		const documentMarkup = settings
			? getDocumentMarkup(template, settings, metadata)
			: (template.markup ?? "asciidoc");

		if (isMarkdownFile(file)) {
			const { body } = parseMarkdownFrontmatter(currentContent);
			const frontmatter = formatMarkdownFrontmatter(metadata, template);
			const trimmedBody = body.trim();
			const nonEmptyLines = trimmedBody.split("\n").filter((line) => line.trim().length > 0);
			const isOnlyHeader = trimmedBody && nonEmptyLines.length === 1 && /^#+\s+.+$/.test(nonEmptyLines[0]);
			let finalBody = body;
			if (!trimmedBody || isOnlyHeader) {
				finalBody = "";
				const lines: string[] = [];
				if (template.structured && documentMarkup === "markdown" && metadata.title) {
					lines.push(`# ${metadata.title}`, "");
				}
				appendDefaultBody(lines, template, documentMarkup);
				finalBody = lines.join("\n");
			}
			const newContent = `---\n${frontmatter}---\n${finalBody}`;
			await app.vault.modify(file, newContent);
			return;
		}

		if (isAsciiDocFile(file)) {
			const { body } = parseAsciiDocAttributes(currentContent);
			const bodyLines = body.split("\n");
			let titleLine: string | null = null;
			let bodyStartIndex = 0;

			for (let i = 0; i < bodyLines.length; i++) {
				const line = bodyLines[i].trim();
				if (line.startsWith("=") && !line.startsWith("==")) {
					titleLine = bodyLines[i];
					bodyStartIndex = i + 1;
					break;
				}
			}

			let actualBodyStart = bodyStartIndex;
			for (let i = bodyStartIndex; i < bodyLines.length; i++) {
				const line = bodyLines[i].trim();
				if (line === "" || line.startsWith(":")) actualBodyStart = i + 1;
				else break;
			}
			const actualBody = bodyLines.slice(actualBodyStart).join("\n");
			const meta = metadata as Record<string, unknown>;
			const lines: string[] = [];

			if (titleLine) lines.push(titleLine);
			else if (metadata.title) lines.push(`= ${metadata.title}`);

			for (const field of template.fields) {
				const value = meta[field.key];
				if (field.key === "title" && titleLine && (!value || isPlaceholder(value, field))) continue;
				if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, field)) {
					if (Array.isArray(value)) lines.push(`:${field.key}: ${formatAsciiDocAttributeValue(value.join(", "))}`);
					else lines.push(`:${field.key}: ${formatAsciiDocAttributeValue(value)}`);
				} else {
					lines.push(`:${field.key}: ${getPlaceholder(field)}`);
				}
			}

			lines.push(`:templateId: ${metadata.templateId}`);
			lines.push(`:kind: ${metadata.kind}`);
			if (metadata.sectionKind !== undefined && metadata.sectionMarkup) {
				lines.push(`:sectionKind: ${metadata.sectionKind}`);
				lines.push(`:sectionMarkup: ${metadata.sectionMarkup}`);
			}
			lines.push("");

			if (!actualBody.trim()) {
				appendDefaultBody(lines, template, documentMarkup);
			} else {
				lines.push(actualBody);
			}

			await app.vault.modify(file, lines.join("\n"));
		}
	} catch (error) {
		safeConsoleError("Error writing metadata:", error);
		throw error;
	}
}

export function validateMetadata(
	metadata: TemplateMetadata,
	template: KindTemplate
): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (metadata.kind !== template.kind) {
		errors.push(`Metadata kind ${metadata.kind} does not match template kind ${template.kind}`);
	}

	for (const field of template.fields) {
		if (!field.required) continue;
		const value = metadata[field.key];
		if (value === undefined || value === null || value === "") {
			errors.push(`${field.label || field.key} is required`);
			continue;
		}
		const fieldDef = field;
		if (isPlaceholder(value, fieldDef)) {
			errors.push(`${field.label || field.key} is required`);
		}
	}

	return { valid: errors.length === 0, errors };
}

export function createDefaultMetadata(
	template: KindTemplate,
	title?: string,
	section?: PublicationSectionKind
): TemplateMetadata {
	const metadata: TemplateMetadata = {
		templateId: template.id,
		kind: template.kind,
	};

	if (section) {
		metadata.sectionKind = section.kind;
		metadata.sectionMarkup = section.markup;
	} else if (template.structured && template.contentKinds?.length) {
		metadata.sectionKind = template.contentKinds[0].kind;
		metadata.sectionMarkup = template.contentKinds[0].markup;
	}

	if (title?.trim() && template.kind !== 1) metadata.title = title.trim();
	if (template.structured) {
		metadata.type = metadata.type ?? "book";
	}

	return metadata;
}

export function mergeWithHeaderTitle(
	metadata: TemplateMetadata,
	headerTitle: string
): TemplateMetadata {
	const isPublication =
		(metadata.sectionKind !== undefined && Boolean(metadata.sectionMarkup)) ||
		(metadata.kind >= 30040 && metadata.kind < 30050);
	if (isPublication && (!metadata.title || String(metadata.title).trim() === "")) {
		return { ...metadata, title: headerTitle };
	}
	return metadata;
}

export function hasMissingRequiredFields(
	metadata: TemplateMetadata,
	template: KindTemplate
): boolean {
	return !validateMetadata(metadata, template).valid;
}
