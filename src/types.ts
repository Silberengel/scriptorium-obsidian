import { Event as NostrEvent } from "nostr-tools";

export type TemplateType = "default" | "custom";
export type MarkupFormat = "markdown" | "asciidoc";
export type TemplateTagType = "text" | "topics" | "title";

export interface KindTemplateField {
	key: string;
	label?: string;
	description: string;
	required: boolean;
	tagType: TemplateTagType;
	nostrTag?: string;
}

export interface KindTemplate {
	id: string;
	type: TemplateType;
	kind: number;
	name: string;
	description?: string;
	markup: MarkupFormat;
	structured: boolean;
	contentTemplateId?: string;
	useNKBIP08?: boolean;
	folderName?: string;
	fields: KindTemplateField[];
}

export interface TemplateMetadata {
	templateId?: string;
	kind: number;
	title?: string;
	author?: string;
	summary?: string;
	topics?: string | string[];
	image?: string;
	type?: string;
	version?: string;
	published_on?: string;
	published_by?: string;
	source?: string;
	auto_update?: string;
	collection_id?: string;
	version_tag?: string;
	title_id?: string;
	chapter_id?: string;
	section_id?: string;
	derivative_author?: string;
	derivative_event?: string;
	derivative_relay?: string;
	derivative_pubkey?: string;
	additional_tags?: string[][];
	[key: string]: unknown;
}

/** @deprecated Use TemplateMetadata */
export type EventMetadata = TemplateMetadata;

/**
 * Nostr event with additional metadata
 */
export interface SignedEvent extends NostrEvent {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	tags: string[][];
	content: string;
	sig: string;
}

/**
 * Plugin settings
 */
export interface ScriptoriumSettings {
	relayList: RelayInfo[];
	suggestTheCitadel: boolean;
	defaultRelay: string;
	kindTemplates: KindTemplate[];
	defaultTemplateId: string;
}

/**
 * Relay information
 */
export interface RelayInfo {
	url: string;
	read: boolean;
	write: boolean;
}

/**
 * Document structure node for preview
 */
export interface StructureNode {
	level: number;
	title: string;
	dTag: string;
	kind: number;
	content?: string;
	children: StructureNode[];
	metadata?: TemplateMetadata;
}

/**
 * Event creation result
 */
export interface EventCreationResult {
	events: SignedEvent[];
	structure: StructureNode[];
	errors: string[];
}

/**
 * Publishing result
 */
export interface PublishingResult {
	eventId: string;
	relay: string;
	success: boolean;
	message?: string;
}

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: ScriptoriumSettings = {
	relayList: [],
	suggestTheCitadel: true,
	defaultRelay: "wss://thecitadel.nostr1.com",
	kindTemplates: [],
	defaultTemplateId: "kind-1-default",
};
