import { finalizeEvent, getEventHash, getPublicKey, nip19 } from "nostr-tools";
import { EventKind, EventMetadata, SignedEvent, Kind30041Metadata } from "../types";
import { sanitizeString } from "../utils/security";

/**
 * Normalize secret key from bech32 nsec or hex format to hex
 */
export function normalizeSecretKey(key: string): Uint8Array {
	if (key.startsWith("nsec")) {
		try {
			const decoded = nip19.decode(key);
			if (decoded.type === "nsec") {
				return decoded.data;
			}
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			throw new Error(`Invalid nsec format: ${sanitizeString(errorMsg)}`);
		}
	}
	// Assume hex format (64 chars)
	if (key.length === 64) {
		const hex = key.toLowerCase();
		const bytes = new Uint8Array(32);
		for (let i = 0; i < 32; i++) {
			bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
		}
		return bytes;
	}
	throw new Error("Invalid key format. Expected nsec bech32 or 64-char hex string.");
}

/**
 * Get public key from private key
 */
export function getPubkeyFromPrivkey(privkey: string): string {
	const normalized = normalizeSecretKey(privkey);
	return getPublicKey(normalized);
}

/**
 * Get public key from private key (Uint8Array version)
 */
export function getPubkeyFromPrivkeyBytes(privkey: Uint8Array): string {
	return getPublicKey(privkey);
}

/**
 * Convert public key to npub (bech32 encoded)
 */
export function pubkeyToNpub(pubkey: string): string {
	try {
		return nip19.npubEncode(pubkey);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to encode pubkey to npub: ${sanitizeString(errorMsg)}`);
	}
}

/**
 * Get npub from private key
 */
export function getNpubFromPrivkey(privkey: string): string {
	const pubkey = getPubkeyFromPrivkey(privkey);
	return pubkeyToNpub(pubkey);
}

/**
 * Build tags array from metadata
 */
export function buildTagsFromMetadata(
	metadata: EventMetadata,
	pubkey: string,
	childEvents?: Array<{ kind: number; dTag: string; eventId?: string }>
): string[][] {
	const tags: string[][] = [];

	switch (metadata.kind) {
		case 1:
			// No special tags required (title is optional)
			if (metadata.title) {
				tags.push(["title", metadata.title]);
			}
			// Topics available for all events
			if (metadata.topics) {
				metadata.topics.forEach((topic) => tags.push(["t", topic]));
			}
			break;

		case 11:
			// Thread OP
			if (!metadata.title) {
				throw new Error("Title is mandatory for kind 11");
			}
			if (metadata.title) tags.push(["title", metadata.title]);
			// Topics available for all events
			if (metadata.topics) {
				metadata.topics.forEach((topic) => tags.push(["t", topic]));
			}
			break;

		case 30023:
			// Long-form article
			if (!metadata.title) {
				throw new Error("Title is mandatory for kind 30023");
			}
			tags.push(["d", normalizeDTag(metadata.title)]);
			if (metadata.title) tags.push(["title", metadata.title]);
			if (metadata.image) tags.push(["image", metadata.image]);
			if (metadata.summary) tags.push(["summary", metadata.summary]);
			if (metadata.published_at) tags.push(["published_at", metadata.published_at]);
			if (metadata.topics) {
				metadata.topics.forEach((topic) => tags.push(["t", topic]));
			}
			break;

		case 30040:
			// Publication index
			if (!metadata.title) {
				throw new Error("Title is mandatory for kind 30040");
			}
			tags.push(["d", normalizeDTag(metadata.title)]);
			if (metadata.title) tags.push(["title", metadata.title]);
			if (metadata.author) tags.push(["author", metadata.author]);
			if (metadata.type) tags.push(["type", metadata.type]);
			if (metadata.version) tags.push(["version", metadata.version]);
			if (metadata.published_on) tags.push(["published_on", metadata.published_on]);
			if (metadata.published_by) tags.push(["published_by", metadata.published_by]);
			if (metadata.summary) tags.push(["summary", metadata.summary]);
			if (metadata.source) tags.push(["source", metadata.source]);
			if (metadata.image) tags.push(["image", metadata.image]);
			if (metadata.auto_update) {
				tags.push(["auto-update", metadata.auto_update]);
			}
			if (metadata.derivative_author) {
				tags.push(["p", metadata.derivative_author]);
			}
			if (metadata.derivative_event) {
				const eTag = ["E", metadata.derivative_event];
				if (metadata.derivative_relay) eTag.push(metadata.derivative_relay);
				if (metadata.derivative_pubkey) eTag.push(metadata.derivative_pubkey);
				tags.push(eTag);
			}
			// Topics available for all events
			if (metadata.topics) {
				metadata.topics.forEach((topic) => tags.push(["t", topic]));
			}
			// NKBIP-08 tags
			if (metadata.collection_id) tags.push(["C", metadata.collection_id]);
			if (metadata.version_tag) tags.push(["v", metadata.version_tag]);
			// Additional tags
			if (metadata.additional_tags) {
				metadata.additional_tags.forEach((tag) => tags.push(tag));
			}
			// a tags for child events
			if (childEvents) {
				childEvents.forEach((child) => {
					const aTag = ["a", `${child.kind}:${pubkey}:${child.dTag}`];
					if (child.eventId) aTag.push("", child.eventId);
					tags.push(aTag);
				});
			}
			break;

		case 30041:
			// Publication content
			if (!metadata.title) {
				throw new Error("Title is mandatory for kind 30041");
			}
			tags.push(["d", normalizeDTag(metadata.title)]);
			if (metadata.title) tags.push(["title", metadata.title]);
			
			const meta30041 = metadata as Kind30041Metadata;
			// Stand-alone 30041 can have same tags as 30023
			if (meta30041.image) tags.push(["image", meta30041.image]);
			if (meta30041.summary) tags.push(["summary", meta30041.summary]);
			if (meta30041.published_at) tags.push(["published_at", meta30041.published_at]);
			if (meta30041.topics) {
				meta30041.topics.forEach((topic) => tags.push(["t", topic]));
			}
			
			// NKBIP-08 tags (only for nested 30041 under 30040)
			if (meta30041.collection_id) tags.push(["C", meta30041.collection_id]);
			if (meta30041.title_id) tags.push(["T", meta30041.title_id]);
			if (meta30041.chapter_id) tags.push(["c", meta30041.chapter_id]);
			if (meta30041.section_id) tags.push(["s", meta30041.section_id]);
			if (meta30041.version_tag) tags.push(["v", meta30041.version_tag]);
			break;

		case 30817:
			// Wiki page (Markdown)
			if (!metadata.title) {
				throw new Error("Title is mandatory for kind 30817");
			}
			tags.push(["d", normalizeDTag(metadata.title)]);
			if (metadata.title) tags.push(["title", metadata.title]);
			if (metadata.summary) tags.push(["summary", metadata.summary]);
			const meta30817 = metadata as any;
			if (meta30817.image) tags.push(["image", meta30817.image]);
			if (metadata.topics) {
				metadata.topics.forEach((topic) => tags.push(["t", topic]));
			}
			break;

		case 30818:
			// Wiki page (AsciiDoc)
			if (!metadata.title) {
				throw new Error("Title is mandatory for kind 30818");
			}
			tags.push(["d", normalizeDTag(metadata.title)]);
			if (metadata.title) tags.push(["title", metadata.title]);
			if (metadata.summary) tags.push(["summary", metadata.summary]);
			const meta30818 = metadata as any;
			if (meta30818.image) tags.push(["image", meta30818.image]);
			if (metadata.topics) {
				metadata.topics.forEach((topic) => tags.push(["t", topic]));
			}
			break;
	}

	return tags;
}

/**
 * Normalize d-tag per NIP-54 rules
 */
export function normalizeDTag(title: string): string {
	// All letters with uppercase/lowercase variants → lowercase
	let normalized = title.toLowerCase();

	// Whitespace → `-`
	normalized = normalized.replace(/\s+/g, "-");

	// Punctuation and symbols → removed (except hyphens)
	normalized = normalized.replace(/[^\p{L}\p{N}-]/gu, "");

	// Multiple consecutive `-` → single `-`
	normalized = normalized.replace(/-+/g, "-");

	// Leading and trailing `-` → removed
	normalized = normalized.replace(/^-+|-+$/g, "");

	// Non-ASCII letters and numbers are preserved (already handled by regex above)

	return normalized;
}

/**
 * Create and sign a Nostr event
 */
export function createSignedEvent(
	kind: EventKind,
	content: string,
	tags: string[][],
	privkey: string,
	createdAt?: number
): SignedEvent {
	const normalizedKey = normalizeSecretKey(privkey);
	const pubkey = getPublicKey(normalizedKey);
	const created_at = createdAt || Math.floor(Date.now() / 1000);

	const eventTemplate = {
		kind,
		created_at,
		tags,
		content,
	};

	const signedEvent = finalizeEvent(eventTemplate, normalizedKey);

	return {
		...signedEvent,
		kind: kind as EventKind,
	};
}
