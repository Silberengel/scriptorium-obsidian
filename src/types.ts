import { Event as NostrEvent } from "nostr-tools";

export type TemplateType = "default" | "custom";
export type MarkupFormat = "markdown" | "asciidoc";
export type TemplateTagType = "text" | "topics" | "title";

/** Allowed section kind + source markup for a hierarchical publication. */
export interface PublicationSectionKind {
	kind: number;
	markup: MarkupFormat;
}

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
	markup?: MarkupFormat;
	structured: boolean;
	/** Allowed section kind + markup pairs for hierarchical publications. */
	contentKinds?: PublicationSectionKind[];
	folderName?: string;
	fields: KindTemplateField[];
}

export interface TemplateMetadata {
	templateId?: string;
	/** Selected section kind + markup when a publication allows multiple content kinds. */
	sectionKind?: number;
	sectionMarkup?: MarkupFormat;
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
 * Default relay always merged into the effective relay list.
 */
export const DEFAULT_RELAY_PRESET = "wss://thecitadel.nostr1.com";

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: ScriptoriumSettings = {
	relayList: [],
	defaultRelay: DEFAULT_RELAY_PRESET,
	kindTemplates: [],
	defaultTemplateId: "kind-1-default",
};
