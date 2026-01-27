import { Event as NostrEvent } from "nostr-tools";

/**
 * Supported Nostr event kinds
 */
export type EventKind = 1 | 11 | 30023 | 30040 | 30041 | 30817 | 30818;

/**
 * File content type
 */
export type ContentType = "markdown" | "asciidoc";

/**
 * Nostr event with additional metadata
 */
export interface SignedEvent extends NostrEvent {
	id: string;
	pubkey: string;
	created_at: number;
	kind: EventKind;
	tags: string[][];
	content: string;
	sig: string;
}

/**
 * Base metadata structure
 */
export interface BaseMetadata {
	title?: string;
	author?: string;
	published_on?: string;
	summary?: string;
	topics?: string[]; // t tags (available for all event kinds)
}

/**
 * Metadata for kind 1 (normal notes)
 */
export interface Kind1Metadata extends BaseMetadata {
	kind: 1;
}

/**
 * Metadata for kind 11 (discussion thread OPs)
 */
export interface Kind11Metadata extends BaseMetadata {
	kind: 11;
}

/**
 * Metadata for kind 30023 (long-form articles)
 */
export interface Kind30023Metadata extends BaseMetadata {
	kind: 30023;
	title: string; // mandatory
	image?: string;
	published_at?: string;
	topics?: string[]; // t tags
}

/**
 * Metadata for kind 30040 (publication index)
 */
export interface Kind30040Metadata extends BaseMetadata {
	kind: 30040;
	title: string; // mandatory (derived from header, can be overridden)
	author?: string;
	type?: string; // book, illustrated, magazine, documentation, academic, blog
	version?: string;
	published_on?: string;
	published_by?: string;
	summary?: string;
	source?: string;
	image?: string;
	auto_update?: "yes" | "ask" | "no";
	derivative_author?: string; // p tag
	derivative_event?: string; // E tag
	derivative_relay?: string;
	derivative_pubkey?: string;
	additional_tags?: string[][]; // custom tags
	// NKBIP-08 tags
	collection_id?: string; // C tag (optional - for compendiums, digests, libraries of related books)
	version_tag?: string; // v tag
}

/**
 * Metadata for kind 30041 (publication content)
 */
export interface Kind30041Metadata extends BaseMetadata {
	kind: 30041;
	title: string; // mandatory
	// Stand-alone 30041 can have same tags as 30023
	image?: string;
	published_at?: string;
	topics?: string[]; // t tags
	// NKBIP-08 tags (only for nested 30041 under 30040)
	collection_id?: string; // C tag (inherited from root 30040)
	title_id?: string; // T tag
	chapter_id?: string; // c tag
	section_id?: string; // s tag
	version_tag?: string; // v tag
}

/**
 * Metadata for kind 30817 (wiki pages - Markdown)
 */
export interface Kind30817Metadata extends BaseMetadata {
	kind: 30817;
	title: string; // mandatory
	image?: string;
	topics?: string[]; // t tags
}

/**
 * Metadata for kind 30818 (wiki pages - AsciiDoc)
 */
export interface Kind30818Metadata extends BaseMetadata {
	kind: 30818;
	title: string; // mandatory
	image?: string;
	topics?: string[]; // t tags
}

/**
 * Union type for all metadata types
 */
export type EventMetadata =
	| Kind1Metadata
	| Kind11Metadata
	| Kind30023Metadata
	| Kind30040Metadata
	| Kind30041Metadata
	| Kind30817Metadata
	| Kind30818Metadata;

/**
 * Plugin settings
 */
export interface ScriptoriumSettings {
	// Relay settings
	relayList: RelayInfo[];
	suggestTheCitadel: boolean;
	defaultRelay: string;

	// Event settings
	defaultEventKind: EventKind;

	// Key management
	privateKey?: string; // from SCRIPTORIUM_OBSIDIAN_KEY env var

	// AUTH preferences
	autoAuth: boolean;
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
	kind: 30040 | 30041;
	content?: string;
	children: StructureNode[];
	metadata?: EventMetadata;
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
	defaultEventKind: 1,
	autoAuth: true,
};
