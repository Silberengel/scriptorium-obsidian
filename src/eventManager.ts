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
import { readMetadata, mergeWithHeaderTitle } from "./metadataManager";

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
	const tags = buildTagsFromMetadata(metadata, getPubkeyFromPrivkey(privkey));
	const event = createSignedEvent(metadata.kind, content, tags, privkey);
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

	// Parse structure
	const header = parseAsciiDocStructure(content, metadata as Kind30040Metadata);
	if (header.length === 0) {
		errors.push("Failed to parse AsciiDoc structure");
		return { events: [], structure: [], errors };
	}

	const rootNode = header[0];
	const structure: StructureNode[] = [rootNode];

	// Recursively build events from structure
	async function buildEventsFromNode(node: StructureNode, parentMetadata?: Kind30040Metadata): Promise<void> {
		if (node.kind === 30041) {
			// Content event
			const contentMetadata: Kind30041Metadata = {
				kind: 30041,
				title: node.title,
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

			// Build all children first
			for (const child of node.children) {
				await buildEventsFromNode(child, node.metadata as Kind30040Metadata);
				
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
			const indexMetadata: Kind30040Metadata = {
				kind: 30040,
				title: node.title,
				...(node.metadata as Kind30040Metadata),
			};

			const tags = buildTagsFromMetadata(indexMetadata, pubkey, childEvents);
			const event = createSignedEvent(30040, "", tags, privkey);
			events.push(event);
			node.metadata = indexMetadata;
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
