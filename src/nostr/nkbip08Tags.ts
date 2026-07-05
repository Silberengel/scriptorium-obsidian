import { Kind30040Metadata, Kind30041Metadata } from "../types";

/**
 * NKBIP-08 tag names
 */
export const NKBIP08_TAGS = {
	COLLECTION: "C",
	TITLE: "T",
	CHAPTER: "c",
	SECTION: "s",
	VERSION: "v",
} as const;

/**
 * Normalize tag values according to NKBIP-08 (NIP-54 rules):
 * - Remove quotes (single and double)
 * - Convert any non-letter non-number character to a hyphen
 * - Convert all letters to lowercase
 * - Numbers are preserved (not converted to hyphens)
 * - Collapse multiple hyphens to single hyphen
 * - Trim leading/trailing hyphens
 * 
 * IMPORTANT: This handles hierarchical paths with colons (e.g., "part-1:question-2:article-3")
 * by converting colons to hyphens, resulting in "part-1-question-2-article-3" as per NKBIP-08 spec.
 */
export function normalizeNKBIP08TagValue(text: string | undefined | null): string {
	if (!text || typeof text !== "string") {
		return "";
	}
	
	// Remove quotes (single and double)
	const normalized = text.trim().replace(/^["']|["']$/g, "");
	
	// Normalize: lowercase, convert non-letter non-number to hyphen
	// Per NKBIP-08: "Section identifiers cannot contain colons in tag values.
	// Hierarchical paths with colons MUST be normalized: colons → hyphens"
	let result = "";
	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];
		if ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || (char >= "0" && char <= "9")) {
			result += char.toLowerCase();
		} else {
			// Non-alphanumeric (including colons) becomes hyphen (but don't add consecutive hyphens)
			if (result && result[result.length - 1] !== "-") {
				result += "-";
			}
		}
	}
	
	// Collapse multiple hyphens
	result = result.replace(/-+/g, "-");
	
	// Trim leading/trailing hyphens
	result = result.replace(/^-+|-+$/g, "");
	
	return result;
}

/**
 * NKBIP-08 tag metadata for 30040 (publication index)
 */
export interface NKBIP08_30040Tags {
	collection_id?: string; // C tag (optional - for compendiums, digests, libraries)
	version_tag?: string; // v tag
}

/**
 * NKBIP-08 tag metadata for 30041 (publication content) when nested under 30040
 */
export interface NKBIP08_30041Tags {
	collection_id?: string; // C tag (inherited from root 30040)
	title_id?: string; // T tag (derived from root 30040 title)
	chapter_id?: string; // c tag (from chapter title)
	section_id?: string; // s tag (from section title, only if not a chapter)
	version_tag?: string; // v tag (inherited from parent 30040)
}

/**
 * Build NKBIP-08 tags for a nested 30041 event under a 30040 parent
 * 
 * Per NKBIP-08 spec:
 * - C tag (collection_id): Inherited from root 30040 (optional - for compendiums, digests, libraries)
 * - T tag (title_id): Normalized book title (from root 30040, not just immediate parent)
 * - c tag (chapter_id): Normalized chapter identifier
 *   - If 30041 is directly under root (isChapter=true): from 30041's own title
 *   - If 30041 is under a chapter (isChapter=false): from parent 30040's title
 * - s tag (section_id): Normalized section identifier (from 30041 node's title)
 *   - Only added if isChapter=false (i.e., this is a section, not a chapter)
 * - v tag (version_tag): Inherited from parent 30040
 * 
 * @param parentMetadata - The parent 30040 metadata (source of inheritance)
 * @param rootMetadata - The root 30040 metadata (source of collection_id)
 * @param bookTitle - The book title (root 30040 title) for T tag
 * @param chapterTitle - The chapter title (parent 30040 title if nested, or 30041 title if direct child)
 * @param sectionTitle - The section title (30041 node title)
 * @param isChapter - Whether this 30041 is directly under root (making it a chapter, not a section)
 * @returns NKBIP-08 tags for the 30041 event
 */
export function buildNKBIP08TagsFor30041(
	parentMetadata: Kind30040Metadata,
	rootMetadata: Kind30040Metadata | undefined,
	bookTitle: string,
	chapterTitle: string,
	sectionTitle: string,
	isChapter: boolean = false
): NKBIP08_30041Tags {
	return {
		// C tag: Inherited from root 30040 (optional - for compendiums, digests, libraries)
		collection_id: rootMetadata?.collection_id ? normalizeNKBIP08TagValue(rootMetadata.collection_id) : undefined,
		// Inherit from parent 30040
		version_tag: parentMetadata.version_tag ? normalizeNKBIP08TagValue(parentMetadata.version_tag) : undefined,
		// T tag: Normalized book title (from root 30040)
		title_id: bookTitle ? normalizeNKBIP08TagValue(bookTitle) : undefined,
		// c tag: If this is a chapter (direct child of root), use its own title; otherwise use parent's title
		chapter_id: chapterTitle ? normalizeNKBIP08TagValue(chapterTitle) : undefined,
		// s tag: Only add if this is NOT a chapter (i.e., it's a section under a chapter)
		section_id: isChapter ? undefined : (sectionTitle ? normalizeNKBIP08TagValue(sectionTitle) : undefined),
	};
}

/**
 * Merge NKBIP-08 tags for nested 30040 events
 * Child 30040 inherits from parent 30040 if parent values exist, otherwise uses own values
 * All values are normalized per NKBIP-08 spec
 * 
 * @param parentMetadata - Parent 30040 metadata (optional)
 * @param childMetadata - Child 30040 metadata
 * @returns Merged NKBIP-08 tags (normalized)
 */
export function mergeNKBIP08TagsFor30040(
	parentMetadata: Kind30040Metadata | undefined,
	childMetadata: Kind30040Metadata,
	rootMetadata?: Kind30040Metadata
): NKBIP08_30040Tags {
	// Collection ID is inherited from root (if present), not from parent
	const collectionId = rootMetadata?.collection_id || childMetadata?.collection_id;
	const versionTag = parentMetadata?.version_tag || childMetadata?.version_tag;
	
	return {
		collection_id: collectionId ? normalizeNKBIP08TagValue(collectionId) : undefined,
		version_tag: versionTag ? normalizeNKBIP08TagValue(versionTag) : undefined,
	};
}

/**
 * Apply NKBIP-08 tags to a 30041 metadata object
 * Used when building nested 30041 events under 30040
 * 
 * @param metadata - The 30041 metadata to update
 * @param nkbip08Tags - The NKBIP-08 tags to apply
 * @returns Updated metadata with NKBIP-08 tags
 */
export function applyNKBIP08TagsTo30041(
	metadata: Kind30041Metadata,
	nkbip08Tags: NKBIP08_30041Tags
): Kind30041Metadata {
	return {
		...metadata,
		collection_id: nkbip08Tags.collection_id,
		title_id: nkbip08Tags.title_id,
		chapter_id: nkbip08Tags.chapter_id,
		section_id: nkbip08Tags.section_id,
		version_tag: nkbip08Tags.version_tag,
	};
}

/**
 * Apply NKBIP-08 tags to a 30040 metadata object
 * Used when building nested 30040 events
 * 
 * @param metadata - The 30040 metadata to update
 * @param nkbip08Tags - The NKBIP-08 tags to apply
 * @returns Updated metadata with NKBIP-08 tags
 */
export function applyNKBIP08TagsTo30040(
	metadata: Kind30040Metadata,
	nkbip08Tags: NKBIP08_30040Tags
): Kind30040Metadata {
	return {
		...metadata,
		collection_id: nkbip08Tags.collection_id,
		version_tag: nkbip08Tags.version_tag,
	};
}

/**
 * Add NKBIP-08 tags to a tags array for a 30040 event
 * 
 * Per NKBIP-08 spec:
 * - C tag (collection_id): Optional, normalized (for compendiums, digests, libraries - inherited from root)
 * - T tag (title_id): MANDATORY for book/title events, also added to chapters (inherited from book)
 * - c tag (chapter_id): Optional, for chapter index events, normalized
 * - v tag (version_tag): Optional, normalized
 * 
 * @param tags - The tags array to add to
 * @param metadata - The 30040 metadata containing NKBIP-08 tag values
 * @param isBook - Whether this is a book/title event (requires T tag)
 * @param isChapter - Whether this is a chapter event (requires c tag and inherits T tag)
 * @param bookTitle - The book title for T tag (used for chapters to inherit from book)
 */
export function addNKBIP08TagsTo30040(
	tags: string[][],
	metadata: Kind30040Metadata,
	isBook: boolean = false,
	isChapter: boolean = false,
	bookTitle?: string,
	rootMetadata?: Kind30040Metadata
): void {
	// C tag (collection) - optional, inherited from root if present
	if (rootMetadata?.collection_id) {
		const normalized = normalizeNKBIP08TagValue(rootMetadata.collection_id);
		if (normalized) {
			tags.push([NKBIP08_TAGS.COLLECTION, normalized]);
		}
	} else if (metadata.collection_id) {
		// Fallback: use own collection_id if root not provided (for root itself)
		const normalized = normalizeNKBIP08TagValue(metadata.collection_id);
		if (normalized) {
			tags.push([NKBIP08_TAGS.COLLECTION, normalized]);
		}
	}
	
	// T tag (title) - MANDATORY for book/title events per NKBIP-08 spec
	// Also added to chapters (inherited from book)
	if (isBook && metadata.title) {
		const normalized = normalizeNKBIP08TagValue(metadata.title);
		if (normalized) {
			tags.push([NKBIP08_TAGS.TITLE, normalized]);
		}
	} else if (isChapter && bookTitle) {
		// Chapter inherits T tag from book
		const normalized = normalizeNKBIP08TagValue(bookTitle);
		if (normalized) {
			tags.push([NKBIP08_TAGS.TITLE, normalized]);
		}
	}
	
	// c tag (chapter) - for chapter index events
	if (isChapter && metadata.title) {
		const normalized = normalizeNKBIP08TagValue(metadata.title);
		if (normalized) {
			tags.push([NKBIP08_TAGS.CHAPTER, normalized]);
		}
	}
	
	// v tag (version) - optional, add if present
	if (metadata.version_tag) {
		const normalized = normalizeNKBIP08TagValue(metadata.version_tag);
		if (normalized) {
			tags.push([NKBIP08_TAGS.VERSION, normalized]);
		}
	}
}

/**
 * Add NKBIP-08 tags to a tags array for a 30041 event
 * Only adds tags if they are present (for nested 30041 under 30040)
 * Stand-alone 30041 events don't have NKBIP-08 tags
 * 
 * Per NKBIP-08 spec:
 * - C tag (collection_id): Optional, normalized (inherited from root 30040)
 * - T tag (title_id): MANDATORY for nested 30041, normalized
 * - c tag (chapter_id): Optional, normalized
 * - s tag (section_id): Optional, normalized
 * - v tag (version_tag): Optional, normalized
 * 
 * @param tags - The tags array to add to
 * @param metadata - The 30041 metadata containing NKBIP-08 tag values
 */
export function addNKBIP08TagsTo30041(
	tags: string[][],
	metadata: Kind30041Metadata
): void {
	// Only add NKBIP-08 tags if they exist (indicating this is a nested 30041)
	// All tag values are already normalized when stored in metadata
	if (metadata.collection_id) {
		tags.push([NKBIP08_TAGS.COLLECTION, metadata.collection_id]);
	}
	if (metadata.title_id) {
		tags.push([NKBIP08_TAGS.TITLE, metadata.title_id]);
	}
	if (metadata.chapter_id) {
		tags.push([NKBIP08_TAGS.CHAPTER, metadata.chapter_id]);
	}
	if (metadata.section_id) {
		tags.push([NKBIP08_TAGS.SECTION, metadata.section_id]);
	}
	if (metadata.version_tag) {
		tags.push([NKBIP08_TAGS.VERSION, metadata.version_tag]);
	}
}
