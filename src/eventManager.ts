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
	normalizeDTag,
	getPubkeyFromPrivkey,
} from "./nostr/eventBuilder";
import { parseAsciiDocStructure } from "./asciidocParser";
import { readMetadata, mergeWithHeaderTitle, stripMetadataFromContent } from "./metadataManager";

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

	// Recursively build events from structure
	async function buildEventsFromNode(node: StructureNode, parentMetadata?: Kind30040Metadata): Promise<void> {
		if (node.kind === 30041) {
			// Content event - nested under 30040, so use NKBIP-08 tags
			const contentMetadata: Kind30041Metadata = {
				kind: 30041,
				title: node.title,
				// Inherit NKBIP-08 tags from parent 30040
				collection_id: parentMetadata?.collection_id,
				title_id: parentMetadata ? normalizeDTag(parentMetadata.title) : undefined,
				chapter_id: node.dTag,
				section_id: node.dTag,
				version_tag: parentMetadata?.version_tag,
			};

			const tags = buildTagsFromMetadata(contentMetadata, pubkey);
			const event = createSignedEvent(30041, node.content || "", tags, privkey);
			events.push(event);
			node.metadata = contentMetadata;
		} else if (node.kind === 30040) {
			// Index event - need to build children first
			const childEvents: Array<{ kind: number; dTag: string; eventId?: string }> = [];

			// Merge parent metadata with node metadata for nested 30040 events
			// Inherit NKBIP-08 tags from parent if this is a nested 30040
			const baseMetadata = node.metadata as Kind30040Metadata;
			const mergedMetadata: Kind30040Metadata = {
				...baseMetadata,
				kind: 30040,
				title: node.title,
				// Inherit NKBIP-08 tags from parent 30040 if present
				collection_id: parentMetadata?.collection_id || baseMetadata.collection_id,
				version_tag: parentMetadata?.version_tag || baseMetadata.version_tag,
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

			// Build all children first, passing merged metadata as parent
			for (const child of node.children) {
				await buildEventsFromNode(child, mergedMetadata);
				
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
			const tags = buildTagsFromMetadata(mergedMetadata, pubkey, childEvents);
			const event = createSignedEvent(30040, "", tags, privkey);
			events.push(event);
			node.metadata = mergedMetadata;
		}
	}

	// Build events starting from root
	await buildEventsFromNode(rootNode, metadata as Kind30040Metadata);

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
	const isAsciiDoc = file.extension === "adoc" || file.extension === "asciidoc";
	const hasStructure = isAsciiDoc && content.trim().startsWith("=") && !content.trim().startsWith("==");

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
