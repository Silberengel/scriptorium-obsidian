import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { SignedEvent } from "../types";
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
			bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
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
 * Normalize d-tag per NIP-54 rules
 */
export function normalizeDTag(title: string): string {
	let normalized = title.toLowerCase();

	// Whitespace → `-`
	normalized = normalized.replace(/\s+/g, "-");

	// Periods → `-` before other punctuation is stripped, so "1.5" → "1-5" not "15"
	normalized = normalized.replace(/\./g, "-");

	// Punctuation and symbols → removed (except hyphens)
	normalized = normalized.replace(/[^\p{L}\p{N}-]/gu, "");

	// Multiple consecutive `-` → single `-`
	normalized = normalized.replace(/-+/g, "-");

	// Leading and trailing `-` → removed
	normalized = normalized.replace(/^-+|-+$/g, "");

	return normalized;
}

/**
 * Create a stable d-tag allocator for one event batch.
 * Uses normalizeDTag(title) so re-creating the same document yields the same
 * d-tags and replaces prior events on relays (NIP-01 addressable kinds).
 * Duplicate titles within one batch get suffixes -2, -3, …
 */
export function createDTagAllocator(): (title: string) => string {
	const usedCounts = new Map<string, number>();

	return (title: string): string => {
		const base = normalizeDTag(title) || "untitled";
		const seen = usedCounts.get(base) ?? 0;
		usedCounts.set(base, seen + 1);
		if (seen === 0) {
			return base;
		}
		return `${base}-${seen + 1}`;
	};
}

/**
 * Create and sign a Nostr event
 */
export function createSignedEvent(
	kind: number,
	content: string,
	tags: string[][],
	privkey: string,
	createdAt?: number
): SignedEvent {
	const normalizedKey = normalizeSecretKey(privkey);
	const created_at = createdAt || Math.floor(Date.now() / 1000);

	// Ensure tags is always an array (never undefined or null)
	const safeTags = Array.isArray(tags) ? tags : [];
	// Ensure all tag values are strings (required by Nostr spec)
	const normalizedTags = safeTags.map(tag => 
		Array.isArray(tag) ? tag.map(val => String(val ?? "")) : tag
	);
	// Ensure content is always a string (never undefined or null)
	const safeContent = typeof content === "string" ? content : "";

	const eventTemplate = {
		kind: Number(kind),
		created_at: Number(created_at),
		tags: normalizedTags,
		content: safeContent,
	};

	const signedEvent = finalizeEvent(eventTemplate, normalizedKey);

	// Ensure all required properties are present
	return {
		id: signedEvent.id,
		pubkey: signedEvent.pubkey,
		created_at: signedEvent.created_at,
		kind: signedEvent.kind,
		tags: signedEvent.tags,
		content: signedEvent.content,
		sig: signedEvent.sig,
	};
}
