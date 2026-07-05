import { TemplateMetadata, StructureNode } from "./types";
import { normalizeDTag } from "./nostr/eventBuilder";

/**
 * Parse AsciiDoc document header (single =)
 */
export function parseDocumentHeader(content: string): { title: string; remaining: string } | null {
	const lines = content.split("\n");
	const firstLine = lines[0]?.trim();

	if (firstLine && firstLine.startsWith("=") && !firstLine.startsWith("==")) {
		const title = firstLine.slice(1).trim();
		const remaining = lines.slice(1).join("\n");
		return { title, remaining };
	}

	return null;
}

/**
 * Check if document starts with AsciiDoc header
 */
export function isAsciiDocDocument(content: string): boolean {
	const firstLine = content.split("\n")[0]?.trim();
	return firstLine ? firstLine.startsWith("=") && !firstLine.startsWith("==") : false;
}

/**
 * Parse AsciiDoc line to extract header level and title
 */
export function parseHeaderLine(line: string): { level: number; title: string } | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("=")) return null;

	let level = 0;
	let i = 0;
	while (i < trimmed.length && trimmed[i] === "=" && level < 6) {
		level++;
		i++;
	}

	if (level === 0 || level > 6) return null;

	return { level, title: trimmed.slice(i).trim() };
}

/**
 * Parse AsciiDoc document into structure nodes
 */
export function parseAsciiDocStructure(
	content: string,
	rootMetadata?: TemplateMetadata,
	indexKind = 30040,
	contentKind = 30041
): StructureNode[] {
	const header = parseDocumentHeader(content);
	if (!header) return [];

	const rootTitle = rootMetadata?.title || header.title;
	const rootNode: StructureNode = {
		level: 0,
		title: String(rootTitle),
		dTag: normalizeDTag(String(rootTitle)),
		kind: indexKind,
		children: [],
		metadata: rootMetadata,
	};

	const lines = header.remaining.split("\n");
	const stack: StructureNode[] = [rootNode];
	let currentContent: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const headerInfo = parseHeaderLine(line);

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

/**
 * Assign stable hierarchical d-tags from the document tree.
 * Path is built from normalized titles (e.g. my-book-chapter-1-intro) so
 * inserting a new chapter or section does not change existing d-tags.
 * Duplicate titles under the same parent get -2, -3 suffixes.
 */
export function assignHierarchicalDTags(root: StructureNode): void {
	const rootTag = normalizeDTag(String(root.title)) || "untitled";
	root.dTag = rootTag;

	function walk(parent: StructureNode, parentTag: string): void {
		const segmentCounts = new Map<string, number>();
		for (const child of parent.children) {
			const segment = normalizeDTag(String(child.title)) || "untitled";
			const seen = segmentCounts.get(segment) ?? 0;
			segmentCounts.set(segment, seen + 1);
			child.dTag =
				seen === 0 ? `${parentTag}-${segment}` : `${parentTag}-${segment}-${seen + 1}`;
			walk(child, child.dTag);
		}
	}

	walk(root, rootTag);
}

export function markLowestLevelAsContent(node: StructureNode, indexKind: number, contentKind: number): void {
	node.children.forEach((child) => markLowestLevelAsContent(child, indexKind, contentKind));

	if (node.children.length === 0) {
		node.kind = contentKind;
	} else {
		node.kind = indexKind;
		node.content = "";
	}
}
