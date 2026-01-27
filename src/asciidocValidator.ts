import { parseDocumentHeader, parseHeaderLine } from "./asciidocParser";

/**
 * Validation result for AsciiDoc documents
 */
export interface AsciiDocValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Header information extracted from document
 */
interface HeaderInfo {
	lineNumber: number;
	level: number;
	title: string;
	originalLine: string;
}

/**
 * Validate AsciiDoc document structure
 * 
 * Checks:
 * - Document header (single =) exists and has title
 * - At least one additional header exists
 * - Headers have proper text (not empty)
 * - Leaf headers (last in their branch) have content beneath them
 * - Interim headers (with child headers) don't need content
 * - Headers form intact branches (no skipped levels - this would create orphaned events)
 * 
 * @param content - The AsciiDoc content to validate
 * @returns Validation result with errors and warnings
 */
export function validateAsciiDocDocument(content: string): AsciiDocValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	
	// Early return for empty document
	if (!content || content.trim().length === 0) {
		errors.push("Document is empty");
		return { valid: false, errors, warnings };
	}
	
	// Validate document header
	const documentHeader = validateDocumentHeader(content, errors);
	if (!documentHeader) {
		return { valid: false, errors, warnings };
	}
	
	// Parse section headers
	const lines = content.split("\n");
	const headerLines = parseSectionHeaders(lines);
	
	// Validate section headers exist
	if (!validateSectionHeadersExist(headerLines, errors)) {
		return { valid: false, errors, warnings };
	}
	
	// Validate header text
	validateHeaderText(headerLines, errors);
	
	// Validate header hierarchy (no skipped levels)
	validateHeaderHierarchy(headerLines, errors);
	
	// Validate leaf headers have content
	validateLeafHeaderContent(headerLines, lines, errors);
	
	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Validate document header exists and has a title
 */
function validateDocumentHeader(
	content: string,
	errors: string[]
): { title: string; remaining: string } | null {
	const documentHeader = parseDocumentHeader(content);
	if (!documentHeader) {
		errors.push("Document must start with a document header (single = followed by title)");
		return null;
	}
	
	if (!documentHeader.title || documentHeader.title.trim().length === 0) {
		errors.push("Document header must have a title");
		return null;
	}
	
	return documentHeader;
}

/**
 * Parse all section headers from document lines (excluding document header)
 */
function parseSectionHeaders(lines: string[]): HeaderInfo[] {
	const headerLines: HeaderInfo[] = [];
	
	// Start from line 2 (index 1) to skip document header
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		const headerInfo = parseHeaderLine(line);
		if (headerInfo) {
			headerLines.push({
				lineNumber: i + 1, // 1-indexed for user display
				level: headerInfo.level,
				title: headerInfo.title,
				originalLine: line.trim(),
			});
		}
	}
	
	return headerLines;
}

/**
 * Validate that at least one section header exists
 */
function validateSectionHeadersExist(headerLines: HeaderInfo[], errors: string[]): boolean {
	if (headerLines.length === 0) {
		errors.push("Document must have at least one section header (==, ===, etc.) after the document title");
		return false;
	}
	return true;
}

/**
 * Validate that all headers have text
 */
function validateHeaderText(headerLines: HeaderInfo[], errors: string[]): void {
	for (const header of headerLines) {
		if (!header.title || header.title.trim().length === 0) {
			errors.push(`Header on line ${header.lineNumber} has no title text: "${header.originalLine}"`);
		}
	}
}

/**
 * Validate header hierarchy - no skipped levels
 */
function validateHeaderHierarchy(headerLines: HeaderInfo[], errors: string[]): void {
	let previousLevel = 0;
	
	for (const header of headerLines) {
		// Only check for skipped levels when going deeper (not when going back up)
		if (header.level > previousLevel + 1) {
			errors.push(
				`Header on line ${header.lineNumber} ("${header.title}") skips a level (from level ${previousLevel} to ${header.level}). ` +
				`This would create orphaned chapter-events. Headers must form intact branches.`
			);
		}
		previousLevel = header.level;
	}
}

/**
 * Identify leaf headers (headers that are last in their branch)
 * A header is a leaf if there are no child headers (deeper level) after it
 * before the next header at the same or higher level
 */
function identifyLeafHeaders(headerLines: HeaderInfo[]): Set<number> {
	const leafHeaders = new Set<number>();
	
	for (let i = 0; i < headerLines.length; i++) {
		const currentHeader = headerLines[i];
		const hasChildren = hasChildHeaders(headerLines, i);
		
		if (!hasChildren) {
			leafHeaders.add(currentHeader.lineNumber);
		}
	}
	
	return leafHeaders;
}

/**
 * Check if a header has child headers after it
 */
function hasChildHeaders(headerLines: HeaderInfo[], currentIndex: number): boolean {
	const currentHeader = headerLines[currentIndex];
	
	// Look ahead to find the next header at same or higher level
	for (let j = currentIndex + 1; j < headerLines.length; j++) {
		const nextHeader = headerLines[j];
		
		if (nextHeader.level <= currentHeader.level) {
			// Found a header at same or higher level - end of this branch
			// If we haven't found any children, this is a leaf
			return false;
		}
		
		if (nextHeader.level > currentHeader.level) {
			// Found a child header - this header is not a leaf
			return true;
		}
	}
	
	// No more headers - this is a leaf
	return false;
}

/**
 * Validate that leaf headers have content beneath them
 */
function validateLeafHeaderContent(
	headerLines: HeaderInfo[],
	lines: string[],
	errors: string[]
): void {
	const leafHeaders = identifyLeafHeaders(headerLines);
	
	for (const header of headerLines) {
		if (leafHeaders.has(header.lineNumber)) {
			if (!hasContentAfterHeader(header, lines)) {
				errors.push(
					`Leaf header on line ${header.lineNumber} ("${header.title}") must have content beneath it`
				);
			}
		}
	}
}

/**
 * Check if there is content after a header (before the next header at same or higher level)
 */
function hasContentAfterHeader(header: HeaderInfo, lines: string[]): boolean {
	const headerIndex = header.lineNumber - 1; // Convert to 0-indexed
	
	// Look for content between this header and the next header at same or higher level
	for (let i = headerIndex + 1; i < lines.length; i++) {
		const headerInfo = parseHeaderLine(lines[i]);
		
		if (headerInfo) {
			// Found a header - if it's at same or higher level, we've reached the end of this branch
			if (headerInfo.level <= header.level) {
				break;
			}
			// If it's deeper, continue (shouldn't happen for a leaf, but handle gracefully)
			continue;
		}
		
		// Check for non-empty content (not attribute lines)
		const line = lines[i].trim();
		if (line.length > 0 && !line.startsWith(":")) {
			return true;
		}
	}
	
	return false;
}
