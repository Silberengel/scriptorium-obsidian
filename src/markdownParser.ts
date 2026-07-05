import { TemplateMetadata, StructureNode } from "./types";
import { normalizeDTag } from "./nostr/eventBuilder";
import { assignHierarchicalDTags, markLowestLevelAsContent } from "./asciidocParser";

/** Body after YAML frontmatter (if present). */
export function getMarkdownBody(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).replace(/^\n/, "");
}

export function parseMarkdownDocumentHeader(body: string): { title: string; remaining: string } | null {
	const lines = body.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const match = trimmed.match(/^#\s+(.+)$/);
		if (match) {
			return { title: match[1].trim(), remaining: lines.slice(i + 1).join("\n") };
		}
		if (trimmed.length > 0) break;
	}
	return null;
}

export function isMarkdownHierarchicalDocument(
	content: string,
	metadata?: Partial<TemplateMetadata>
): boolean {
	const body = getMarkdownBody(content);
	if (parseMarkdownDocumentHeader(body)) return true;
	if (metadata?.title && /^#{2,6}\s+/m.test(body)) return true;
	return /^#{2,6}\s+/m.test(body);
}

export function parseMarkdownSectionHeader(line: string): { level: number; title: string } | null {
	const match = line.trim().match(/^(#{2,6})\s+(.+)$/);
	if (!match) return null;
	return { level: match[1].length, title: match[2].trim() };
}

export function parseMarkdownStructure(
	content: string,
	rootMetadata?: TemplateMetadata,
	indexKind = 30040,
	contentKind = 30041
): StructureNode[] {
	const body = getMarkdownBody(content);
	const header = parseMarkdownDocumentHeader(body);

	let rootTitle: string;
	let remaining: string;

	if (header) {
		rootTitle = String(rootMetadata?.title || header.title);
		remaining = header.remaining;
	} else if (rootMetadata?.title) {
		rootTitle = String(rootMetadata.title);
		remaining = body;
	} else {
		return [];
	}

	const rootNode: StructureNode = {
		level: 0,
		title: rootTitle,
		dTag: normalizeDTag(rootTitle),
		kind: indexKind,
		children: [],
		metadata: rootMetadata,
	};

	const lines = remaining.split("\n");
	const stack: StructureNode[] = [rootNode];
	let currentContent: string[] = [];

	for (const line of lines) {
		const headerInfo = parseMarkdownSectionHeader(line);

		if (headerInfo) {
			if (currentContent.length > 0 && stack.length > 0) {
				stack[stack.length - 1].content = currentContent.join("\n").trim();
				currentContent = [];
			}

			const { level, title } = headerInfo;
			while (stack.length > 1 && stack[stack.length - 1].level >= level) {
				stack.pop();
			}

			const parent = stack[stack.length - 1];
			const newNode: StructureNode = {
				level,
				title,
				dTag: normalizeDTag(title),
				kind: level === 6 ? contentKind : indexKind,
				children: [],
				content: "",
			};

			parent.children.push(newNode);
			stack.push(newNode);
		} else {
			currentContent.push(line);
		}
	}

	if (currentContent.length > 0 && stack.length > 0) {
		stack[stack.length - 1].content = currentContent.join("\n").trim();
	}

	markLowestLevelAsContent(rootNode, indexKind, contentKind);
	assignHierarchicalDTags(rootNode);
	return [rootNode];
}
