import { TFile } from "obsidian";
import { EventKind, EventMetadata } from "./types";
import { safeConsoleError } from "./utils/security";
import { isMarkdownFile, isAsciiDocFile } from "./utils/fileExtensions";

/**
 * Tag definitions with descriptions for each event kind
 */
interface TagDefinition {
	key: string;
	description: string;
	required?: boolean;
}

const TAG_DEFINITIONS: Record<EventKind, TagDefinition[]> = {
	1: [
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
	],
	11: [
		{ key: "title", description: "Thread title (required)", required: true },
		{ key: "author", description: "Author name", required: false },
		{ key: "summary", description: "Brief summary", required: false },
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
	],
	30023: [
		{ key: "title", description: "Article title (required)", required: true },
		{ key: "author", description: "Author name", required: false },
		{ key: "summary", description: "Article summary", required: false },
		{ key: "image", description: "Image URL", required: false },
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
	],
	30040: [
		{ key: "title", description: "Publication title (required)", required: true },
		{ key: "author", description: "Author name", required: false },
		{ key: "type", description: "Publication type: book, illustrated, magazine, documentation, academic, blog", required: false },
		{ key: "version", description: "Version or edition", required: false },
		{ key: "published_on", description: "Publication date (e.g., 2003-05-13)", required: false },
		{ key: "published_by", description: "Publisher or source", required: false },
		{ key: "summary", description: "Brief description", required: false },
		{ key: "source", description: "URL to original source", required: false },
		{ key: "image", description: "Cover image URL", required: false },
		{ key: "auto_update", description: "Auto-update: yes, ask, or no", required: false },
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
		{ key: "collection_id", description: "NKBIP-08 collection identifier (C tag) - Optional: compendium, digest, or library of related books (e.g., 'bible', 'goethe-complete-works', 'encyclopedia-britannica')", required: false },
		{ key: "version_tag", description: "NKBIP-08 version identifier (e.g., kjv, drb)", required: false },
	],
	30041: [
		{ key: "title", description: "Chapter/section title (required)", required: true },
		{ key: "image", description: "Image URL", required: false },
		{ key: "summary", description: "Article summary", required: false },
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
		// Note: NKBIP-08 tags (collection_id, title_id, chapter_id, section_id, version_tag) 
		// are only used when 30041 is nested under 30040, not for stand-alone 30041 events
		// collection_id is inherited from root 30040 if present
	],
	30817: [
		{ key: "title", description: "Wiki page title (required)", required: true },
		{ key: "author", description: "Author name", required: false },
		{ key: "summary", description: "Brief summary", required: false },
		{ key: "image", description: "Image URL", required: false },
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
	],
	30818: [
		{ key: "title", description: "Wiki page title (required)", required: true },
		{ key: "author", description: "Author name", required: false },
		{ key: "summary", description: "Brief summary", required: false },
		{ key: "image", description: "Image URL", required: false },
		{ key: "topics", description: "Comma-separated topics (e.g., 'bitcoin, nostr')", required: false },
	],
};

/**
 * Get placeholder value for a tag
 */
function getPlaceholder(key: string, kind: EventKind): string {
	const definitions = TAG_DEFINITIONS[kind];
	const def = definitions.find(d => d.key === key);
	return def ? def.description : `Enter ${key}`;
}

/**
 * Get description of event kind and what it's typically used for
 */
function getEventKindDescription(kind: EventKind): string {
	switch (kind) {
		case 1:
			return "**Event Kind 1 (Normal Note)**: Simple text notes for quick thoughts, reminders, or short messages. Good for everyday notes and casual posts.";
		case 11:
			return "**Event Kind 11 (Discussion Thread OP)**: Opening post for a discussion thread. Good for starting conversations and topic discussions.";
		case 30023:
			return "**Event Kind 30023 (Long-form Article)**: Structured articles with title, summary, and image support. Good for blog posts, essays, and detailed articles.";
		case 30040:
			return "**Event Kind 30040 (Publication Index)**: Publication index for books, magazines, or documentation. Supports hierarchical structure with chapters and sections. Good for books, documentation, and structured publications.";
		case 30041:
			return "**Event Kind 30041 (Publication Content)**: Content for publications, either stand-alone or nested under a 30040 index. Good for chapters, sections, or individual publication pieces.";
		case 30817:
			return "**Event Kind 30817 (Wiki Page - Markdown)**: Wiki-style pages using Markdown format. Good for knowledge bases, documentation, and collaborative content.";
		case 30818:
			return "**Event Kind 30818 (Wiki Page - AsciiDoc)**: Wiki-style pages using AsciiDoc format. Good for knowledge bases, documentation, and collaborative content with advanced formatting.";
		default:
			return "";
	}
}

/**
 * Check if a value is a placeholder (still has the description)
 */
function isPlaceholder(value: any, key: string, kind: EventKind): boolean {
	if (value === null || value === undefined || value === "") return true;
	if (typeof value !== "string") return false;
	const placeholder = getPlaceholder(key, kind);
	// Check if the value exactly matches the placeholder or contains it as a substring
	return value === placeholder || value.trim() === placeholder || value.includes(placeholder);
}

/**
 * Parse YAML frontmatter from Markdown file
 */
function parseMarkdownFrontmatter(content: string): { metadata: Record<string, any>; body: string } {
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);
	
	if (!match) {
		return { metadata: {}, body: content };
	}
	
	const frontmatterText = match[1];
	const body = match[2];
	const metadata: Record<string, any> = {};
	
	// Simple YAML parser for frontmatter (key: value pairs)
	const lines = frontmatterText.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		
		const colonIndex = trimmed.indexOf(":");
		if (colonIndex === -1) continue;
		
		const key = trimmed.substring(0, colonIndex).trim();
		let value = trimmed.substring(colonIndex + 1).trim();
		
		// Remove quotes if present
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		
		// Parse arrays (simple format: [item1, item2] or - item1)
		if (value.startsWith("[") && value.endsWith("]")) {
			const arrayContent = value.slice(1, -1).trim();
			metadata[key] = arrayContent.split(",").map(item => item.trim().replace(/^["']|["']$/g, ""));
		} else if (trimmed.startsWith("-")) {
			// Array item
			const arrayKey = lines[lines.indexOf(line) - 1]?.split(":")[0]?.trim();
			if (arrayKey) {
				if (!metadata[arrayKey]) metadata[arrayKey] = [];
				metadata[arrayKey].push(value.replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
			}
		} else {
			// Try to parse as number or boolean
			if (value === "true") {
				metadata[key] = true;
			} else if (value === "false") {
				metadata[key] = false;
			} else if (/^-?\d+$/.test(value)) {
				metadata[key] = parseInt(value, 10);
			} else {
				metadata[key] = value;
			}
			
			// Ensure kind is a number
			if (key === "kind" && typeof metadata[key] === "string") {
				metadata[key] = parseInt(metadata[key] as string, 10);
			}
		}
	}
	
	return { metadata, body };
}

/**
 * Parse AsciiDoc header attributes
 */
function parseAsciiDocAttributes(content: string): { metadata: Record<string, any>; body: string } {
	const metadata: Record<string, any> = {};
	const lines = content.split("\n");
	let bodyStartIndex = 0;
	
	// Find where the document body starts (after title and attributes)
	let foundTitle = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		
		// Document title (single =)
		if (line.startsWith("=") && !line.startsWith("==") && !foundTitle) {
			const title = line.slice(1).trim();
			metadata.title = title;
			foundTitle = true;
			bodyStartIndex = i + 1;
			continue;
		}
		
		// Attribute lines (:key: value or :key!: value)
		if (line.startsWith(":") && line.includes(":")) {
			const colonIndex = line.indexOf(":", 1);
			if (colonIndex !== -1) {
				let key = line.substring(1, colonIndex).trim();
				const isRequired = key.endsWith("!");
				if (isRequired) {
					key = key.slice(0, -1);
				}
				let value = line.substring(colonIndex + 1).trim();
				
				// Remove quotes if present
				if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}
				
				// Try to parse as number or boolean
				if (value === "true") {
					metadata[key] = true;
				} else if (value === "false") {
					metadata[key] = false;
				} else if (/^-?\d+$/.test(value)) {
					metadata[key] = parseInt(value, 10);
				} else {
					metadata[key] = value;
				}
				
				// Ensure kind is a number
				if (key === "kind" && typeof metadata[key] === "string") {
					metadata[key] = parseInt(metadata[key] as string, 10);
				}
			}
			bodyStartIndex = i + 1;
			continue;
		}
		
		// Handle blank lines and body start
		if (foundTitle) {
			if (line === "") {
				// Empty line - continue parsing in case there are more attributes after blank line
				// (for backwards compatibility), but update body start index
				bodyStartIndex = i + 1;
				continue;
			} else if (!line.startsWith(":")) {
				// Non-attribute, non-empty line after title - body starts here
				bodyStartIndex = i;
				break;
			}
		}
	}
	
	const body = lines.slice(bodyStartIndex).join("\n");
	return { metadata, body };
}

/**
 * Filter out placeholder values from metadata
 * Also removes published_at as it's automatically generated during event creation
 */
function filterPlaceholders(metadata: Record<string, any>, kind: EventKind): Record<string, any> {
	const filtered: Record<string, any> = {};
	
	for (const [key, value] of Object.entries(metadata)) {
		// Always keep kind
		if (key === "kind") {
			filtered[key] = value;
			continue;
		}
		
		// Remove published_at - it's automatically generated during event creation
		if (key === "published_at") {
			continue;
		}
		
		// Skip placeholder values
		if (isPlaceholder(value, key, kind)) {
			continue;
		}
		
		// For arrays, filter out placeholder items
		if (Array.isArray(value)) {
			const filteredArray = value.filter((item: any) => !isPlaceholder(item, key, kind));
			if (filteredArray.length > 0) {
				filtered[key] = filteredArray;
			}
		} else if (value !== "" && value != null) {
			filtered[key] = value;
		}
	}
	
	return filtered;
}

/**
 * Read metadata from file content (frontmatter or AsciiDoc attributes)
 */
export async function readMetadata(
	file: TFile,
	app: any
): Promise<EventMetadata | null> {
	try {
		const content = await app.vault.read(file);
		
		if (isMarkdownFile(file)) {
			const { metadata } = parseMarkdownFrontmatter(content);
			if (Object.keys(metadata).length === 0) {
				return null;
			}
			const kind = (metadata.kind as EventKind) || 1;
			const filtered = filterPlaceholders(metadata, kind);
			return filtered as EventMetadata;
		} else if (isAsciiDocFile(file)) {
			const { metadata } = parseAsciiDocAttributes(content);
			if (Object.keys(metadata).length === 0) {
				return null;
			}
			const kind = (metadata.kind as EventKind) || 30040;
			const filtered = filterPlaceholders(metadata, kind);
			return filtered as EventMetadata;
		}
		
		return null;
	} catch (error) {
		safeConsoleError("Error reading metadata:", error);
		return null;
	}
}

/**
 * Strip frontmatter/attributes from content for publishing
 * For AsciiDoc, keeps the title header but removes attribute lines
 */
export function stripMetadataFromContent(file: TFile, content: string): string {
	if (isMarkdownFile(file)) {
		const { body } = parseMarkdownFrontmatter(content);
		return body;
	} else if (isAsciiDocFile(file)) {
		const lines = content.split("\n");
		const result: string[] = [];
		let foundTitle = false;
		let inAttributes = false;
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			
			// Keep title header (single =)
			if (line.startsWith("=") && !line.startsWith("==") && !foundTitle) {
				result.push(lines[i]);
				foundTitle = true;
				inAttributes = true;
				continue;
			}
			
			// Skip attribute lines (but keep empty lines after title)
			if (inAttributes && line.startsWith(":")) {
				continue;
			}
			
			// If we hit a non-empty, non-attribute line after title, we're in the body
			if (inAttributes && line !== "") {
				inAttributes = false;
			}
			
			// Add all body lines
			if (!inAttributes || line === "") {
				result.push(lines[i]);
			}
		}
		
		return result.join("\n");
	}
	return content;
}

/**
 * Write metadata to file content (as frontmatter or AsciiDoc attributes)
 */
export async function writeMetadata(
	file: TFile,
	metadata: EventMetadata,
	app: any
): Promise<void> {
	try {
		const currentContent = await app.vault.read(file);
		
		if (isMarkdownFile(file)) {
			const { body } = parseMarkdownFrontmatter(currentContent);
			const frontmatter = formatMarkdownFrontmatter(metadata);
			
			// If body is empty, only whitespace, or only contains a single header line, add default content
			const trimmedBody = body.trim();
			// Check if body only contains a single header line (e.g., "# Title" or "## Title")
			// Split by newlines and filter out empty lines to count non-empty lines
			const nonEmptyLines = trimmedBody.split('\n').filter(line => line.trim().length > 0);
			const isOnlyHeader = trimmedBody && nonEmptyLines.length === 1 && /^#+\s+.+$/.test(nonEmptyLines[0]);
			let finalBody = body;
			if (!trimmedBody || trimmedBody.length === 0 || isOnlyHeader) {
				// For kind 1, just add placeholder text (no header)
				if (metadata.kind === 1) {
					finalBody = `place your content here\n\n---\n\n**How to use this app:**\n1. Edit your content above\n2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar\n3. Select "Create Nostr events" to create and sign events\n4. Select "Publish events to relays" to publish to relays\n\n${getEventKindDescription(metadata.kind)}`;
				} else {
					// For other kinds, add level-one header (#) with default text
					finalBody = `# This is the first header in this document\n\nplace your content here\n\n---\n\n**How to use this app:**\n1. Edit your content above\n2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar\n3. Select "Create Nostr events" to create and sign events\n4. Select "Publish events to relays" to publish to relays\n\n${getEventKindDescription(metadata.kind)}`;
				}
			}
			
			const newContent = frontmatter ? `---\n${frontmatter}---\n${finalBody}` : finalBody;
			await app.vault.modify(file, newContent);
		} else if (isAsciiDocFile(file)) {
			// For AsciiDoc, we need to preserve the title if it exists in the body
			// and remove old attributes
			const { body } = parseAsciiDocAttributes(currentContent);
			const bodyLines = body.split("\n");
			
			// Find title line if it exists
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
			
			// Get body content (after title, skipping empty lines and old attributes)
			let actualBodyStart = bodyStartIndex;
			for (let i = bodyStartIndex; i < bodyLines.length; i++) {
				const line = bodyLines[i].trim();
				if (line === "") {
					actualBodyStart = i + 1;
				} else if (line.startsWith(":")) {
					actualBodyStart = i + 1;
				} else {
					break;
				}
			}
			const actualBody = bodyLines.slice(actualBodyStart).join("\n");
			
			// Format new content with title + attributes + body
			// Note: No blank line between document header and attributes (AsciiDoc spec)
			const lines: string[] = [];
			if (titleLine) {
				lines.push(titleLine);
			} else if (metadata.title) {
				lines.push(`= ${metadata.title}`);
			}
			
			// Add all predefined attributes with placeholders or actual values
			const kind = metadata.kind;
			const definitions = TAG_DEFINITIONS[kind];
			const meta = metadata as any;
			
			// Add all predefined tags
			for (const def of definitions) {
				const value = meta[def.key];
				
				// For title: if it's in the header, still include it in attributes if it's set in metadata
				// This ensures the title is visible and can be edited
				if (def.key === "title" && titleLine && value && !isPlaceholder(value, def.key, kind)) {
					// Title is in header, but also include it in attributes for visibility
					lines.push(`:${def.key}: ${value}`);
					continue;
				}
				
				// Skip title attribute if it's only in header and not set in metadata
				if (def.key === "title" && titleLine && (!value || isPlaceholder(value, def.key, kind))) {
					continue;
				}
				
				if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, def.key, kind)) {
					// Use actual value
					if (Array.isArray(value)) {
						lines.push(`:${def.key}: ${value.join(", ")}`);
					} else {
						lines.push(`:${def.key}: ${value}`);
					}
				} else {
					// Use placeholder
					lines.push(`:${def.key}: ${getPlaceholder(def.key, kind)}`);
				}
			}
			
			// Always include kind
			lines.push(`:kind: ${kind}`);
			
			// Add any custom attributes that aren't in the definitions
			for (const [key, value] of Object.entries(meta)) {
				if (key === "kind") continue;
				if (definitions.some(d => d.key === key)) continue; // Already handled
				if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, key, kind)) {
					if (Array.isArray(value)) {
						lines.push(`:${key}: ${value.join(", ")}`);
					} else {
						lines.push(`:${key}: ${value}`);
					}
				}
			}
			
			// Add blank line after attributes (before body content)
			lines.push("");
			
			// If body is empty or only whitespace, add default content with level-one header
			const trimmedBody = actualBody.trim();
			if (!trimmedBody || trimmedBody.length === 0) {
				// For kind 30040, provide structured example with chapters and sub-chapters
				if (metadata.kind === 30040) {
					lines.push(`== This is the first chapter header`);
					lines.push("");
					lines.push(`=== This is the first sub-chapter header`);
					lines.push("");
					lines.push("place your content here");
					lines.push("");
					lines.push(`=== This is the second sub-chapter header`);
					lines.push("");
					lines.push("place your content here");
					lines.push("");
					lines.push(`== This is the second chapter header`);
					lines.push("");
					lines.push("place your content here");
					lines.push("");
					lines.push("---");
					lines.push("");
					lines.push("**How to use this app:**");
					lines.push("");
					lines.push("1. Edit your content above");
					lines.push("2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar");
					lines.push("3. Select \"Create Nostr events\" to create and sign events");
					lines.push("4. Select \"Publish events to relays\" to publish to relays");
					lines.push("");
					lines.push(getEventKindDescription(metadata.kind));
				} else {
					// For other AsciiDoc kinds, add level-one header (==) with default text
					lines.push(`== This is the first header in this document`);
					lines.push("");
					lines.push("place your content here");
					lines.push("");
					lines.push("---");
					lines.push("");
					lines.push("**How to use this app:**");
					lines.push("");
					lines.push("1. Edit your content above");
					lines.push("2. Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar");
					lines.push("3. Select \"Create Nostr events\" to create and sign events");
					lines.push("4. Select \"Publish events to relays\" to publish to relays");
					lines.push("");
					lines.push(getEventKindDescription(metadata.kind));
				}
			} else {
				// Use existing body content
				lines.push(actualBody);
			}
			
			const newContent = lines.join("\n");
			await app.vault.modify(file, newContent);
		}
	} catch (error) {
		safeConsoleError("Error writing metadata:", error);
		throw error;
	}
}

/**
 * Format metadata as Markdown frontmatter with all predefined tags
 */
function formatMarkdownFrontmatter(metadata: EventMetadata): string {
	const lines: string[] = [];
	const kind = metadata.kind;
	const definitions = TAG_DEFINITIONS[kind];
	const meta = metadata as any;
	
	// Always include kind first
	lines.push(`kind: ${kind}`);
	
	// Add all predefined tags with placeholders or actual values
	for (const def of definitions) {
		const value = meta[def.key];
		if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, def.key, kind)) {
			// Use actual value
			if (Array.isArray(value)) {
				lines.push(`${def.key}: [${value.map((t: string) => `"${t}"`).join(", ")}]`);
			} else {
				lines.push(`${def.key}: "${value}"`);
			}
		} else {
			// Use placeholder
			lines.push(`${def.key}: "${getPlaceholder(def.key, kind)}"`);
		}
	}
	
	// Add any custom tags that aren't in the definitions
	for (const [key, value] of Object.entries(meta)) {
		if (key === "kind") continue;
		if (definitions.some(d => d.key === key)) continue; // Already handled
		if (value !== undefined && value !== null && value !== "" && !isPlaceholder(value, key, kind)) {
			if (Array.isArray(value)) {
				lines.push(`${key}: [${value.map((t: string) => `"${t}"`).join(", ")}]`);
			} else {
				lines.push(`${key}: "${value}"`);
			}
		}
	}
	
	return lines.join("\n") + "\n";
}

/**
 * Validate metadata for a specific event kind
 */
export function validateMetadata(
	metadata: EventMetadata,
	kind: EventKind
): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	// Check that kind matches
	if (metadata.kind !== kind) {
		errors.push(`Metadata kind ${metadata.kind} does not match expected kind ${kind}`);
	}

	// Validate based on kind
	switch (kind) {
		case 1:
			// Title is optional for kind 1
			break;

		case 11:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 11");
			}
			break;

		case 30023:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 30023");
			}
			break;

		case 30040:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 30040");
			}
			break;

		case 30041:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 30041");
			}
			break;

		case 30817:
		case 30818:
			if (!metadata.title) {
				errors.push(`Title is mandatory for kind ${kind}`);
			}
			break;
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Create default metadata for a given kind
 */
export function createDefaultMetadata(kind: EventKind): EventMetadata {
	switch (kind) {
		case 1:
			return { kind: 1 };
		case 11:
			return { kind: 11 };
		case 30023:
			return {
				kind: 30023,
				title: "",
			};
		case 30040:
			return {
				kind: 30040,
				title: "",
				type: "book",
				auto_update: "ask",
			};
		case 30041:
			return {
				kind: 30041,
				title: "",
			};
		case 30817:
			return {
				kind: 30817,
				title: "",
			};
		case 30818:
			return {
				kind: 30818,
				title: "",
			};
	}
}

/**
 * Merge metadata with document header title (for 30040)
 */
export function mergeWithHeaderTitle(
	metadata: EventMetadata,
	headerTitle: string
): EventMetadata {
	if (metadata.kind === 30040) {
		// Only use header title if metadata doesn't have a title
		if (!metadata.title || metadata.title.trim() === "") {
			return {
				...metadata,
				title: headerTitle,
			};
		}
	}
	return metadata;
}
