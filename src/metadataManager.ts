import { TFile } from "obsidian";
import { KindTemplate, KindTemplateField, TemplateMetadata } from "./types";
import { safeConsoleError } from "./utils/security";
import { isMarkdownFile, isAsciiDocFile } from "./utils/fileExtensions";

const RESERVED_KEYS = new Set(["kind", "templateId", "published_at"]);

export function getFieldsForTemplate(template: KindTemplate): KindTemplateField[] {
	return template.fields;
}

function getPlaceholder(field: KindTemplateField): string {
	return field.description;
}

export function getKindDescription(template: KindTemplate): string {
	const base = template.description || template.name;
	return `**${template.name} (kind ${template.kind})**: ${base}`;
}

function isPlaceholder(value: unknown, field: KindTemplateField): boolean {
	if (value === null || value === undefined || value === "") return true;
	if (typeof value !== "string") return false;
	const placeholder = getPlaceholder(field);
	return value === placeholder || value.trim() === placeholder || value.includes(placeholder);
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

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const colonIndex = trimmed.indexOf(":");
		if (colonIndex === -1) continue;

		const key = trimmed.substring(0, colonIndex).trim();
		let value = trimmed.substring(colonIndex + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		if (value.startsWith("[") && value.endsWith("]")) {
			const arrayContent = value.slice(1, -1).trim();
			metadata[key] = arrayContent.split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""));
		} else if (trimmed.startsWith("-")) {
			const arrayKey = lines[lines.indexOf(line) - 1]?.split(":")[0]?.trim();
			if (arrayKey) {
				if (!metadata[arrayKey]) metadata[arrayKey] = [];
				(metadata[arrayKey] as string[]).push(value.replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
			}
		} else {
			if (value === "true") metadata[key] = true;
			else if (value === "false") metadata[key] = false;
			else if (/^-?\d+$/.test(value)) metadata[key] = parseInt(value, 10);
			else metadata[key] = value;
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
	app: { vault: { read: (f: TFile) => Promise<string> } },
	template?: KindTemplate
): Promise<TemplateMetadata | null> {
	try {
		const content = await app.vault.read(file);

		if (isMarkdownFile(file)) {
			const { metadata } = parseMarkdownFrontmatter(content);
			if (Object.keys(metadata).length === 0) return null;
			return filterPlaceholders(metadata, template) as TemplateMetadata;
		}

		if (isAsciiDocFile(file)) {
			const { metadata } = parseAsciiDocAttributes(content);
			if (Object.keys(metadata).length === 0) return null;
			return filterPlaceholders(metadata, template) as TemplateMetadata;
		}

		return null;
	} catch (error) {
		safeConsoleError("Error reading metadata:", error);
		return null;
	}
}

export function stripMetadataFromContent(file: TFile, content: string): string {
	if (isMarkdownFile(file)) {
		return parseMarkdownFrontmatter(content).body;
	}

	if (isAsciiDocFile(file)) {
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

		return result.join("\n");
	}

	return content;
}

function formatMarkdownFrontmatter(metadata: TemplateMetadata, template: KindTemplate): string {
	const lines: string[] = [];
	const meta = metadata as Record<string, unknown>;

	lines.push(`templateId: "${metadata.templateId || template.id}"`);
	lines.push(`kind: ${metadata.kind}`);

	for (const field of template.fields) {
		const value = meta[field.key];
		if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, field)) {
			if (Array.isArray(value)) {
				lines.push(`${field.key}: [${value.map((t: string) => `"${t}"`).join(", ")}]`);
			} else {
				lines.push(`${field.key}: "${value}"`);
			}
		} else {
			lines.push(`${field.key}: "${getPlaceholder(field)}"`);
		}
	}

	for (const [key, value] of Object.entries(meta)) {
		if (RESERVED_KEYS.has(key) || template.fields.some((f) => f.key === key)) continue;
		if (value !== undefined && value !== null && value !== "") {
			if (Array.isArray(value)) {
				lines.push(`${key}: [${value.map((t: string) => `"${t}"`).join(", ")}]`);
			} else {
				lines.push(`${key}: "${value}"`);
			}
		}
	}

	return lines.join("\n") + "\n";
}

function appendDefaultBody(lines: string[], template: KindTemplate): void {
	const help = getKindDescription(template);
	if (template.kind === 1) {
		lines.push("place your content here", "", "---", "", "**How to use this app:**", "1. Edit your content above", "2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar", "3. Select \"Create Nostr events\" to create and sign events", "4. Select \"Publish events to relays\" to publish to relays", "", help);
		return;
	}
	if (template.structured) {
		lines.push("== This is the first chapter header", "", "=== This is the first sub-chapter header", "", "place your content here", "", "=== This is the second sub-chapter header", "", "place your content here", "", "== This is the second chapter header", "", "place your content here", "", "---", "", "**How to use this app:**", "", "1. Edit your content above", "2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar", "3. Select \"Create Nostr events\" to create and sign events", "4. Select \"Publish events to relays\" to publish to relays", "", help);
		return;
	}
	if (template.markup === "asciidoc") {
		lines.push("== This is the first header in this document", "", "place your content here", "", "---", "", "**How to use this app:**", "", "1. Edit your content above", "2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar", "3. Select \"Create Nostr events\" to create and sign events", "4. Select \"Publish events to relays\" to publish to relays", "", help);
		return;
	}
	lines.push("# This is the first header in this document", "", "place your content here", "", "---", "", "**How to use this app:**", "1. Edit your content above", "2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar", "3. Select \"Create Nostr events\" to create and sign events", "4. Select \"Publish events to relays\" to publish to relays", "", help);
}

export async function writeMetadata(
	file: TFile,
	metadata: TemplateMetadata,
	app: { vault: { read: (f: TFile) => Promise<string>; modify: (f: TFile, c: string) => Promise<void> } },
	template: KindTemplate
): Promise<void> {
	try {
		const currentContent = await app.vault.read(file);
		metadata.templateId = metadata.templateId || template.id;
		metadata.kind = template.kind;

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
				appendDefaultBody(lines, template);
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
					if (Array.isArray(value)) lines.push(`:${field.key}: ${value.join(", ")}`);
					else lines.push(`:${field.key}: ${value}`);
				} else {
					lines.push(`:${field.key}: ${getPlaceholder(field)}`);
				}
			}

			lines.push(`:templateId: ${metadata.templateId}`);
			lines.push(`:kind: ${metadata.kind}`);
			lines.push("");

			if (!actualBody.trim()) {
				appendDefaultBody(lines, template);
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

export function createDefaultMetadata(template: KindTemplate, title?: string): TemplateMetadata {
	const metadata: TemplateMetadata = {
		templateId: template.id,
		kind: template.kind,
	};

	if (title?.trim()) metadata.title = title.trim();
	if (template.kind === 30040) {
		metadata.type = "book";
		metadata.auto_update = "ask";
	}

	return metadata;
}

export function mergeWithHeaderTitle(
	metadata: TemplateMetadata,
	headerTitle: string
): TemplateMetadata {
	if (metadata.kind === 30040 && (!metadata.title || String(metadata.title).trim() === "")) {
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
