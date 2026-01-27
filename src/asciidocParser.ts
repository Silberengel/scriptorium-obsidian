import { EventKind, Kind30040Metadata, Kind30041Metadata, StructureNode } from "./types";

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
		dTag: rootTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, ""),
		kind: 30040,
		children: [],
		metadata: rootMetadata,
	};

	const lines = header.remaining.split("\n");
	const nodes: StructureNode[] = [rootNode];
	const stack: StructureNode[] = [rootNode];
	let currentContent: string[] = [];
	let currentLevel = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const headerInfo = parseHeaderLine(line);

		if (headerInfo) {
			// Save content to current node if any (save to all nodes, we'll determine kind later)
			if (currentContent.length > 0 && stack.length > 0) {
				const currentNode = stack[stack.length - 1];
				// Save content to the node - it will be used if it becomes a 30041
				currentNode.content = currentContent.join("\n").trim();
				currentContent = [];
			}

			const { level, title } = headerInfo;
			
			// Determine if this should be 30040 or 30041
			// The lowest level on each branch becomes 30041
			const shouldBe30041 = level === 6; // Maximum level is always 30041
			
			// Pop stack until we find the parent
			while (stack.length > 1 && stack[stack.length - 1].level >= level) {
				stack.pop();
			}

			const parent = stack[stack.length - 1];
			const dTag = title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");

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
			currentLevel = level;
		} else {
			// Content line
			currentContent.push(line);
		}
	}

	// Save remaining content to the last node (save to all nodes, we'll determine kind later)
	if (currentContent.length > 0 && stack.length > 0) {
		const currentNode = stack[stack.length - 1];
		currentNode.content = currentContent.join("\n").trim();
	}

	// Post-process: mark lowest level nodes as 30041
	markLowestLevelAs30041(rootNode);

	return [rootNode];
}

/**
 * Recursively mark the lowest level nodes in each branch as 30041
 * Leaf nodes (nodes with no children) should always be 30041
 * Nodes with children should be 30040 (index events)
 */
function markLowestLevelAs30041(node: StructureNode): void {
	// Process children first (depth-first)
	node.children.forEach((child) => markLowestLevelAs30041(child));

	// After processing children, determine this node's kind
	if (node.children.length === 0) {
		// Leaf node - always 30041 (content event)
		node.kind = 30041;
		// Ensure content is preserved (it was collected during parsing)
	} else {
		// Node with children - always 30040 (index event)
		node.kind = 30040;
		// Clear content for index nodes (they don't have content, only references)
		node.content = "";
	}
}

/**
 * Extract content for a specific section
 */
export function extractSectionContent(
	content: string,
	startLine: number,
	endLine?: number
): string {
	const lines = content.split("\n");
	const start = startLine;
	const end = endLine !== undefined ? endLine : lines.length;
	return lines.slice(start, end).join("\n").trim();
}

/**
 * Get all section boundaries (line numbers where headers start)
 */
export function getSectionBoundaries(content: string): Array<{ level: number; line: number; title: string }> {
	const lines = content.split("\n");
	const boundaries: Array<{ level: number; line: number; title: string }> = [];

	for (let i = 0; i < lines.length; i++) {
		const headerInfo = parseHeaderLine(lines[i]);
		if (headerInfo) {
			boundaries.push({
				level: headerInfo.level,
				line: i,
				title: headerInfo.title,
			});
		}
	}

	return boundaries;
}
