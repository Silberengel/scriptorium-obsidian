import { Kind30040Metadata, StructureNode } from "./types";
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
 * Exported for use in validator
 */
export function parseHeaderLine(line: string): { level: number; title: string } | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("=")) {
		return null;
	}
	
	let level = 0;
	let i = 0;
	while (i < trimmed.length && trimmed[i] === "=" && level < 6) {
		level++;
		i++;
	}
	
	if (level === 0 || level > 6) {
		return null;
	}
	
	const title = trimmed.slice(i).trim();
	return { level, title };
}

/**
 * Parse AsciiDoc document into structure nodes
 */
export function parseAsciiDocStructure(
	content: string,
	rootMetadata?: Kind30040Metadata
): StructureNode[] {
	const header = parseDocumentHeader(content);
	if (!header) {
		return [];
	}

	const rootTitle = rootMetadata?.title || header.title;
	const rootNode: StructureNode = {
		level: 0,
		title: rootTitle,
		dTag: normalizeDTag(rootTitle),
		kind: 30040,
		children: [],
		metadata: rootMetadata,
	};

	const lines = header.remaining.split("\n");
	const nodes: StructureNode[] = [rootNode];
	const stack: StructureNode[] = [rootNode];
	let currentContent: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const headerInfo = parseHeaderLine(line);

		if (headerInfo) {
			if (currentContent.length > 0 && stack.length > 0) {
				const currentNode = stack[stack.length - 1];
				currentNode.content = currentContent.join("\n").trim();
				currentContent = [];
			}

			const { level, title } = headerInfo;
			const shouldBe30041 = level === 6;
			
			while (stack.length > 1 && stack[stack.length - 1].level >= level) {
				stack.pop();
			}

			const parent = stack[stack.length - 1];
			const dTag = normalizeDTag(title);

			const newNode: StructureNode = {
				level,
				title,
				dTag,
				kind: shouldBe30041 ? 30041 : 30040,
				children: [],
				content: "",
			};

			parent.children.push(newNode);
			nodes.push(newNode);
			stack.push(newNode);
		} else {
			currentContent.push(line);
		}
	}

	if (currentContent.length > 0 && stack.length > 0) {
		const currentNode = stack[stack.length - 1];
		currentNode.content = currentContent.join("\n").trim();
	}

	markLowestLevelAs30041(rootNode);

	return [rootNode];
}

/**
 * Recursively mark the lowest level nodes in each branch as 30041
 */
function markLowestLevelAs30041(node: StructureNode): void {
	node.children.forEach((child) => markLowestLevelAs30041(child));

	if (node.children.length === 0) {
		node.kind = 30041;
	} else {
		node.kind = 30040;
		node.content = "";
	}
}
