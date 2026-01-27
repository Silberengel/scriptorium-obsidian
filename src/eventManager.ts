import { TFile } from "obsidian";
import {
	EventKind,
	EventMetadata,
	SignedEvent,
	StructureNode,
	EventCreationResult,
	Kind30040Metadata,
	Kind30041Metadata,
} from "./types";
import {
	createSignedEvent,
	buildTagsFromMetadata,
	getPubkeyFromPrivkey,
} from "./nostr/eventBuilder";
import { parseAsciiDocStructure, isAsciiDocDocument } from "./asciidocParser";
import { readMetadata, mergeWithHeaderTitle, stripMetadataFromContent } from "./metadataManager";
import { isAsciiDocFile } from "./utils/fileExtensions";
import {
	buildNKBIP08TagsFor30041,
	applyNKBIP08TagsTo30041,
	mergeNKBIP08TagsFor30040,
	applyNKBIP08TagsTo30040,
	addNKBIP08TagsTo30040,
	NKBIP08_TAGS,
} from "./nostr/nkbip08Tags";

/**
 * Build events from a simple document (non-AsciiDoc)
 */
export async function buildSimpleEvent(
	file: TFile,
	content: string,
	metadata: EventMetadata,
	privkey: string,
	app: any
): Promise<SignedEvent[]> {
	// Strip metadata from content before publishing
	const cleanContent = stripMetadataFromContent(file, content);
	const tags = buildTagsFromMetadata(metadata, getPubkeyFromPrivkey(privkey));
	const event = createSignedEvent(metadata.kind, cleanContent, tags, privkey);
	return [event];
}

/**
 * Build events from AsciiDoc structure (30040/30041)
 */
export async function buildAsciiDocEvents(
	file: TFile,
	content: string,
	metadata: EventMetadata,
	privkey: string,
	app: any
): Promise<EventCreationResult> {
	if (metadata.kind !== 30040 && metadata.kind !== 30041 && metadata.kind !== 30818) {
		throw new Error("AsciiDoc events must be kind 30040, 30041, or 30818");
	}

	const errors: string[] = [];
	const events: SignedEvent[] = [];
	const pubkey = getPubkeyFromPrivkey(privkey);

	// Strip metadata attributes from content before parsing structure
	// (but keep the title header for structure parsing)
	const cleanContent = stripMetadataFromContent(file, content);
	
	// Parse structure
	const header = parseAsciiDocStructure(cleanContent, metadata as Kind30040Metadata);
	if (header.length === 0) {
		errors.push("Failed to parse AsciiDoc structure");
		return { events: [], structure: [], errors };
	}

	const rootNode = header[0];
	const structure: StructureNode[] = [rootNode];
	
	// Track the root book title for T tag inheritance
	const rootBookTitle = rootNode.title;

	// Recursively build events from structure
	async function buildEventsFromNode(
		node: StructureNode,
		parentMetadata?: Kind30040Metadata,
		bookTitle?: string,
		isParentRoot: boolean = false,
		rootMetadata?: Kind30040Metadata
	): Promise<void> {
		// Determine book title: use root if this is root, otherwise inherit from parent
		const currentBookTitle = bookTitle || rootBookTitle;
		// Track root metadata for collection_id inheritance
		const currentRootMetadata = rootMetadata || (metadata as Kind30040Metadata);
		
		if (node.kind === 30041) {
			// Content event - nested under 30040, so use NKBIP-08 tags
			if (!parentMetadata) {
				errors.push("30041 event must have a parent 30040 metadata");
				return;
			}

			// Build base 30041 metadata
			const baseMetadata: Kind30041Metadata = {
				kind: 30041,
				title: node.title,
			};

			// Determine if this 30041 is directly under root (making it a chapter) or under a chapter (making it a section)
			// If parent is root, this 30041 is a chapter (not a section)
			const isChapter = isParentRoot;
			
			// Build and apply NKBIP-08 tags from parent
			// If isChapter: c tag uses 30041's own title, no s tag
			// If not isChapter: c tag uses parent chapter title, s tag uses section title
			const nkbip08Tags = buildNKBIP08TagsFor30041(
				parentMetadata,
				currentRootMetadata,  // Root metadata for collection_id inheritance
				currentBookTitle,  // T tag: book title
				isChapter ? node.title : parentMetadata.title,  // c tag: chapter title (30041's title if chapter, parent's if section)
				node.title,  // s tag: section title (this 30041, but only used if not isChapter)
				isChapter  // Flag: true if this is a chapter (direct child of root)
			);
			const contentMetadata = applyNKBIP08TagsTo30041(baseMetadata, nkbip08Tags);

			const tags = buildTagsFromMetadata(contentMetadata, pubkey);
			const event = createSignedEvent(30041, node.content || "", tags, privkey);
			events.push(event);
			node.metadata = contentMetadata;
		} else if (node.kind === 30040) {
			// Index event - need to build children first
			const childEvents: Array<{ kind: number; dTag: string; eventId?: string }> = [];

			// Merge parent metadata with node metadata for nested 30040 events
			const baseMetadata = node.metadata as Kind30040Metadata;
			
			// Merge NKBIP-08 tags (inherits collection_id from root, version_tag from parent if present, otherwise uses own)
			const mergedNKBIP08Tags = mergeNKBIP08TagsFor30040(parentMetadata, baseMetadata, currentRootMetadata);
			
			// Build merged metadata with inherited NKBIP-08 tags
			const mergedMetadata: Kind30040Metadata = {
				...baseMetadata,
				kind: 30040,
				title: node.title,
				// Inherit other 30040 tags from parent
				author: parentMetadata?.author || baseMetadata.author,
				type: parentMetadata?.type || baseMetadata.type,
				version: parentMetadata?.version || baseMetadata.version,
				published_on: parentMetadata?.published_on || baseMetadata.published_on,
				published_by: parentMetadata?.published_by || baseMetadata.published_by,
				summary: parentMetadata?.summary || baseMetadata.summary,
				source: parentMetadata?.source || baseMetadata.source,
				image: parentMetadata?.image || baseMetadata.image,
				auto_update: parentMetadata?.auto_update || baseMetadata.auto_update,
			};
			
			// Apply merged NKBIP-08 tags
			const finalMetadata = applyNKBIP08TagsTo30040(mergedMetadata, mergedNKBIP08Tags);

			// Determine if this is a book (root) or chapter (has parent)
			const isBook = !parentMetadata;
			const isChapter = !!parentMetadata;
			const isRoot = !parentMetadata; // This node is the root
			
			// Build all children first, passing final metadata as parent and book title
			for (const child of node.children) {
				await buildEventsFromNode(child, finalMetadata, currentBookTitle, isRoot, currentRootMetadata);
				
				// Find the event we just created for this child
				const childEvent = events.find((e) => {
					const dTag = e.tags.find((t) => t[0] === "d")?.[1];
					return dTag === child.dTag;
				});

				if (childEvent) {
					childEvents.push({
						kind: child.kind,
						dTag: child.dTag,
						eventId: childEvent.id,
					});
				}
			}

			// Now build this index event with references to children
			// We need to manually add NKBIP-08 tags with proper book/chapter flags
			const tags = buildTagsFromMetadata(finalMetadata, pubkey, childEvents);
			
			// Override NKBIP-08 tags with proper book/chapter identification
			// Remove any existing NKBIP-08 tags first
			const filteredTags = tags.filter(t => 
				t[0] !== NKBIP08_TAGS.COLLECTION &&
				t[0] !== NKBIP08_TAGS.TITLE && 
				t[0] !== NKBIP08_TAGS.CHAPTER && 
				t[0] !== NKBIP08_TAGS.VERSION
			);
			
			// Add NKBIP-08 tags with proper flags
			// Chapters inherit T tag from book
			addNKBIP08TagsTo30040(filteredTags, finalMetadata, isBook, isChapter, currentBookTitle, currentRootMetadata);
			
			const event = createSignedEvent(30040, "", filteredTags, privkey);
			events.push(event);
			node.metadata = finalMetadata;
		}
	}

	// Build events starting from root (no parent, book title is root title, isParentRoot=false for root itself)
	await buildEventsFromNode(rootNode, metadata as Kind30040Metadata, rootBookTitle, false, metadata as Kind30040Metadata);

	// Sort events: indexes first, then content (for proper dependency order)
	events.sort((a, b) => {
		if (a.kind === 30040 && b.kind === 30041) return -1;
		if (a.kind === 30041 && b.kind === 30040) return 1;
		return 0;
	});

	return { events, structure, errors };
}

/**
 * Build events from document
 */
export async function buildEvents(
	file: TFile,
	content: string,
	metadata: EventMetadata,
	privkey: string,
	app: any
): Promise<EventCreationResult> {
	// Check if this is an AsciiDoc document with structure
	const hasStructure = isAsciiDocFile(file) && isAsciiDocDocument(content);

	if (hasStructure && (metadata.kind === 30040 || metadata.kind === 30041)) {
		// Parse header title and merge with metadata
		const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
		const mergedMetadata = mergeWithHeaderTitle(metadata, headerTitle);
		return buildAsciiDocEvents(file, content, mergedMetadata, privkey, app);
	} else {
		// Simple event
		const events = await buildSimpleEvent(file, content, metadata, privkey, app);
		return { events, structure: [], errors: [] };
	}
}
