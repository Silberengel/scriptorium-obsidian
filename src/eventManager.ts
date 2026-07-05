import { TFile } from "obsidian";
import {
	TemplateMetadata,
	SignedEvent,
	StructureNode,
	EventCreationResult,
	KindTemplate,
	ScriptoriumSettings,
} from "./types";
import {
	createSignedEvent,
	getPubkeyFromPrivkey,
	normalizeDTag,
} from "./nostr/eventBuilder";
import { buildTagsFromTemplate } from "./nostr/templateEventBuilder";
import { parseAsciiDocStructure, isAsciiDocDocument } from "./asciidocParser";
import { mergeWithHeaderTitle, stripMetadataFromContent } from "./metadataManager";
import { isAsciiDocFile } from "./utils/fileExtensions";
import {
	buildNKBIP08TagsFor30041,
	applyNKBIP08TagsTo30041,
	mergeNKBIP08TagsFor30040,
	applyNKBIP08TagsTo30040,
	addNKBIP08TagsTo30040,
	NKBIP08_TAGS,
} from "./nostr/nkbip08Tags";
import {
	getTemplateById,
	resolveTemplate,
} from "./templateRegistry";

export async function buildSimpleEvent(
	file: TFile,
	content: string,
	metadata: TemplateMetadata,
	template: KindTemplate,
	privkey: string
): Promise<SignedEvent[]> {
	const cleanContent = stripMetadataFromContent(file, content);
	const tags = buildTagsFromTemplate(metadata, template, getPubkeyFromPrivkey(privkey));
	const event = createSignedEvent(template.kind, cleanContent, tags, privkey);
	return [event];
}

export async function buildStructuredEvents(
	file: TFile,
	content: string,
	metadata: TemplateMetadata,
	indexTemplate: KindTemplate,
	settings: ScriptoriumSettings,
	privkey: string
): Promise<EventCreationResult> {
	const errors: string[] = [];
	const events: SignedEvent[] = [];
	const pubkey = getPubkeyFromPrivkey(privkey);

	if (!indexTemplate.contentTemplateId) {
		return { events: [], structure: [], errors: ["Structured template missing contentTemplateId"] };
	}

	const contentTemplate = getTemplateById(indexTemplate.contentTemplateId, settings);
	if (!contentTemplate) {
		return { events: [], structure: [], errors: [`Content template not found: ${indexTemplate.contentTemplateId}`] };
	}

	const leafTemplate = contentTemplate;

	const indexKind = indexTemplate.kind;
	const contentKind = leafTemplate.kind;
	const cleanContent = stripMetadataFromContent(file, content);
	const header = parseAsciiDocStructure(cleanContent, metadata, indexKind, contentKind);

	if (header.length === 0) {
		return { events: [], structure: [], errors: ["Failed to parse AsciiDoc structure"] };
	}

	const rootNode = header[0];
	const structure: StructureNode[] = [rootNode];
	const rootBookTitle = rootNode.title;

	async function buildEventsFromNode(
		node: StructureNode,
		parentMetadata?: TemplateMetadata,
		bookTitle?: string,
		isParentRoot = false,
		rootMetadata?: TemplateMetadata
	): Promise<void> {
		const currentBookTitle = bookTitle || rootBookTitle;
		const currentRootMetadata = rootMetadata || metadata;

		if (node.kind === contentKind) {
			if (!parentMetadata) {
				errors.push(`${contentKind} event must have a parent index metadata`);
				return;
			}
			if (!node.title || typeof node.title !== "string") {
				errors.push(`${contentKind} event missing required title at level ${node.level}`);
				return;
			}

			const baseMetadata: TemplateMetadata = {
				templateId: leafTemplate.id,
				kind: contentKind,
				title: String(node.title),
			};

			const isChapter = isParentRoot;
			const nkbip08Tags = indexTemplate.useNKBIP08
				? buildNKBIP08TagsFor30041(
					parentMetadata,
					currentRootMetadata,
					currentBookTitle,
					isChapter ? node.title : String(parentMetadata.title || ""),
					node.title,
					isChapter
				)
				: {};
			const contentMetadata = indexTemplate.useNKBIP08
				? applyNKBIP08TagsTo30041(baseMetadata, nkbip08Tags)
				: baseMetadata;

			const tags = buildTagsFromTemplate(contentMetadata, leafTemplate, pubkey);
			const event = createSignedEvent(contentKind, node.content || "", tags, privkey);
			events.push(event);
			node.metadata = contentMetadata;
		} else if (node.kind === indexKind) {
			const childEvents: Array<{ kind: number; dTag: string; eventId?: string }> = [];

			if (!node.title || typeof node.title !== "string") {
				errors.push(`${indexKind} event missing required title at level ${node.level}`);
				return;
			}

			const baseMetadata = (node.metadata as TemplateMetadata | undefined) || {
				templateId: indexTemplate.id,
				kind: indexKind,
				title: String(node.title),
			};

			const mergedNKBIP08Tags = indexTemplate.useNKBIP08
				? mergeNKBIP08TagsFor30040(parentMetadata, baseMetadata, currentRootMetadata)
				: {};

			const mergedMetadata: TemplateMetadata = {
				...baseMetadata,
				templateId: indexTemplate.id,
				kind: indexKind,
				title: String(node.title),
				author: parentMetadata?.author ? String(parentMetadata.author) : baseMetadata.author ? String(baseMetadata.author) : undefined,
				type: parentMetadata?.type ? String(parentMetadata.type) : baseMetadata.type ? String(baseMetadata.type) : undefined,
				version: parentMetadata?.version ? String(parentMetadata.version) : baseMetadata.version ? String(baseMetadata.version) : undefined,
				published_on: parentMetadata?.published_on ? String(parentMetadata.published_on) : baseMetadata.published_on ? String(baseMetadata.published_on) : undefined,
				published_by: parentMetadata?.published_by ? String(parentMetadata.published_by) : baseMetadata.published_by ? String(baseMetadata.published_by) : undefined,
				summary: parentMetadata?.summary ? String(parentMetadata.summary) : baseMetadata.summary ? String(baseMetadata.summary) : undefined,
				source: parentMetadata?.source ? String(parentMetadata.source) : baseMetadata.source ? String(baseMetadata.source) : undefined,
				image: parentMetadata?.image ? String(parentMetadata.image) : baseMetadata.image ? String(baseMetadata.image) : undefined,
				auto_update: parentMetadata?.auto_update || baseMetadata.auto_update,
			};

			const finalMetadata = indexTemplate.useNKBIP08
				? applyNKBIP08TagsTo30040(mergedMetadata, mergedNKBIP08Tags)
				: mergedMetadata;

			const isBook = !parentMetadata;
			const isChapter = !!parentMetadata;
			const isRoot = !parentMetadata;

			for (const child of node.children) {
				await buildEventsFromNode(child, finalMetadata, currentBookTitle, isRoot, currentRootMetadata);

				const childEvent = events.find((e) => {
					const dTag = e.tags.find((t) => t[0] === "d")?.[1];
					return dTag === child.dTag;
				});

				if (childEvent) {
					childEvents.push({ kind: child.kind, dTag: child.dTag, eventId: childEvent.id });
				}
			}

			const tags = buildTagsFromTemplate(finalMetadata, indexTemplate, pubkey, childEvents);
			const filteredTags = indexTemplate.useNKBIP08
				? tags.filter(
					(t) =>
						t[0] !== NKBIP08_TAGS.COLLECTION &&
						t[0] !== NKBIP08_TAGS.TITLE &&
						t[0] !== NKBIP08_TAGS.CHAPTER &&
						t[0] !== NKBIP08_TAGS.VERSION
				)
				: tags;

			if (indexTemplate.useNKBIP08) {
				addNKBIP08TagsTo30040(filteredTags, finalMetadata, isBook, isChapter, currentBookTitle, currentRootMetadata);
			}

			const event = createSignedEvent(indexKind, "", filteredTags, privkey);
			events.push(event);
			node.metadata = finalMetadata;
		}
	}

	await buildEventsFromNode(rootNode, metadata, rootBookTitle, false, metadata);

	const rootDTag = normalizeDTag(String(metadata.title || rootBookTitle));
	events.sort((a, b) => {
		const aIsRoot = a.kind === indexKind && a.tags.find((t) => t[0] === "d")?.[1] === rootDTag;
		const bIsRoot = b.kind === indexKind && b.tags.find((t) => t[0] === "d")?.[1] === rootDTag;
		if (aIsRoot && !bIsRoot) return 1;
		if (!aIsRoot && bIsRoot) return -1;
		if (a.kind === contentKind && b.kind === indexKind) return -1;
		if (a.kind === indexKind && b.kind === contentKind) return 1;
		return 0;
	});

	return { events, structure, errors };
}

export async function buildEvents(
	file: TFile,
	content: string,
	metadata: TemplateMetadata,
	privkey: string,
	settings: ScriptoriumSettings
): Promise<EventCreationResult> {
	const template = resolveTemplate(metadata, settings);
	const hasStructure = isAsciiDocFile(file) && isAsciiDocDocument(content);

	if (hasStructure && template.structured) {
		const headerTitle = content.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
		const mergedMetadata = mergeWithHeaderTitle(metadata, headerTitle);
		return buildStructuredEvents(file, content, mergedMetadata, template, settings, privkey);
	}

	const events = await buildSimpleEvent(file, content, metadata, template, privkey);
	return { events, structure: [], errors: [] };
}
