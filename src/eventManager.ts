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
	createDTagAllocator,
} from "./nostr/eventBuilder";
import { buildTagsFromTemplate } from "./nostr/templateEventBuilder";
import { parseDocumentStructure } from "./structureParser";
import { mergeWithHeaderTitle, stripMetadataFromContent } from "./metadataManager";
import { getMarkdownBody, parseMarkdownDocumentHeader } from "./markdownParser";
import {
	getDocumentMarkup,
	resolveSectionTemplate,
	getPublicationContentKinds,
} from "./templateRegistry";
import { resolveTemplateForFile } from "./utils/eventKind";

function resolveAuthor(
	metadata?: TemplateMetadata,
	rootMetadata?: TemplateMetadata
): string | undefined {
	const author = metadata?.author ?? rootMetadata?.author;
	return author ? String(author) : undefined;
}

export async function buildSimpleEvent(
	file: TFile,
	content: string,
	metadata: TemplateMetadata,
	template: KindTemplate,
	privkey: string
): Promise<SignedEvent[]> {
	const cleanContent = stripMetadataFromContent(file, content);
	const allocateDTag = createDTagAllocator();
	const title = String(metadata.title || "untitled");
	const dTag = allocateDTag(title);
	const createdAt = Math.floor(Date.now() / 1000);
	const tags = buildTagsFromTemplate(
		metadata,
		template,
		getPubkeyFromPrivkey(privkey),
		undefined,
		{ createdAt, dTag }
	);
	const event = createSignedEvent(template.kind, cleanContent, tags, privkey, createdAt);
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

	if (!getPublicationContentKinds(indexTemplate, settings).length) {
		return { events: [], structure: [], errors: ["Publication template has no contentKinds defined"] };
	}

	const contentTemplate = resolveSectionTemplate(indexTemplate, settings, metadata);
	if (!contentTemplate) {
		return { events: [], structure: [], errors: ["No section template found for this publication"] };
	}

	const leafTemplate = contentTemplate;

	const indexKind = indexTemplate.kind;
	const contentKind = leafTemplate.kind;
	const markup = getDocumentMarkup(indexTemplate, settings, metadata);
	const cleanContent = stripMetadataFromContent(file, content);
	const header = parseDocumentStructure(cleanContent, metadata, indexKind, contentKind, markup);

	if (header.length === 0) {
		return {
			events: [],
			structure: [],
			errors: [`Failed to parse ${markup} document structure`],
		};
	}

	const rootNode = header[0];
	const structure: StructureNode[] = [rootNode];

	async function buildEventsFromNode(
		node: StructureNode,
		parentMetadata?: TemplateMetadata,
		rootMetadata?: TemplateMetadata
	): Promise<void> {
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

			const contentMetadata: TemplateMetadata = {
				templateId: leafTemplate.id,
				kind: contentKind,
				title: String(node.title),
				author: resolveAuthor(parentMetadata, currentRootMetadata),
			};

			const dTag = node.dTag;
			const createdAt = Math.floor(Date.now() / 1000);
			const tags = buildTagsFromTemplate(contentMetadata, leafTemplate, pubkey, undefined, {
				createdAt,
				dTag,
			});
			const event = createSignedEvent(contentKind, node.content || "", tags, privkey, createdAt);
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
			};

			for (const child of node.children) {
				await buildEventsFromNode(child, mergedMetadata, currentRootMetadata);

				const childEvent = events.find((e) => {
					const dTag = e.tags.find((t) => t[0] === "d")?.[1];
					return dTag === child.dTag;
				});

				if (childEvent) {
					childEvents.push({ kind: child.kind, dTag: child.dTag, eventId: childEvent.id });
				}
			}

			const dTag = node.dTag;
			const createdAt = Math.floor(Date.now() / 1000);
			const tags = buildTagsFromTemplate(mergedMetadata, indexTemplate, pubkey, childEvents, {
				createdAt,
				dTag,
			});

			const event = createSignedEvent(indexKind, "", tags, privkey, createdAt);
			events.push(event);
			node.metadata = mergedMetadata;
		}
	}

	await buildEventsFromNode(rootNode, metadata, metadata);

	const rootDTag = rootNode.dTag;
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
	const template = resolveTemplateForFile(metadata, settings, file, content);
	const cleanContent = stripMetadataFromContent(file, content);
	const markup = getDocumentMarkup(template, settings, metadata);

	if (template.structured) {
		let mergedMetadata = metadata;
		if (markup === "asciidoc") {
			const headerTitle = cleanContent.split("\n")[0]?.replace(/^=+\s*/, "").trim() || "";
			mergedMetadata = mergeWithHeaderTitle(metadata, headerTitle);
		} else if (markup === "markdown") {
			const header = parseMarkdownDocumentHeader(getMarkdownBody(content));
			if (header) mergedMetadata = mergeWithHeaderTitle(metadata, header.title);
		}

		const result = await buildStructuredEvents(
			file,
			content,
			mergedMetadata,
			template,
			settings,
			privkey
		);

		if (result.events.length === 0 && result.errors.length === 0) {
			result.errors.push(
				`Could not parse hierarchical ${markup} structure. ` +
					(markup === "markdown"
						? "Use # publication title and ## section headings."
						: "Use = publication title and == section headings.")
			);
		}
		return result;
	}

	const events = await buildSimpleEvent(file, content, metadata, template, privkey);
	return { events, structure: [], errors: [] };
}
