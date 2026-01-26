import { Relay, getPublicKey } from "nostr-tools";
import { RelayInfo } from "./types";
import { normalizeSecretKey } from "./nostr/eventBuilder";
import { safeConsoleError } from "./utils/security";

/**
 * Default relay URLs to query for kind 10002
 */
const DEFAULT_RELAY_URLS = [
	"wss://profiles.nostr1.com",
	"wss://relay.damus.io",
	"wss://thecitadel.nostr1.com",
];

/**
 * Default fallback relay
 */
const DEFAULT_FALLBACK_RELAY = "wss://thecitadel.nostr1.com";

/**
 * Parse kind 10002 event to extract relay list
 */
export function parseRelayList(event: any): RelayInfo[] {
	const relays: RelayInfo[] = [];
	
	if (!event.tags) {
		return relays;
	}

	for (const tag of event.tags) {
		if (tag[0] === "r" && tag[1]) {
			const url = normalizeRelayUrl(tag[1]);
			const read = tag.length > 2 ? tag[2] === "read" || tag[2] === undefined : true;
			const write = tag.length > 2 ? tag[2] === "write" || tag[2] === undefined : true;
			
			relays.push({
				url,
				read: read || (tag[2] === undefined && tag.length === 2),
				write: write || (tag[2] === undefined && tag.length === 2),
			});
		}
	}

	return relays;
}

/**
 * Fetch kind 10002 relay list from a specific relay
 */
export async function fetchRelayListFromRelay(
	relayUrl: string,
	pubkey: string,
	timeout: number = 5000
): Promise<RelayInfo[] | null> {
	return new Promise(async (resolve) => {
		let relay: Relay | null = null;
		const timer = setTimeout(() => {
			if (relay) {
				relay.close();
			}
			resolve(null);
		}, timeout);

		try {
			relay = new Relay(relayUrl);
			await relay.connect();

			const sub = relay.subscribe(
				[
					{
						kinds: [10002],
						authors: [pubkey],
					},
				],
				{
					onevent: (event) => {
						clearTimeout(timer);
						relay?.close();
						const relayList = parseRelayList(event);
						const normalized = normalizeRelayList(relayList);
						resolve(normalized.length > 0 ? normalized : null);
					},
					oneose: () => {
						clearTimeout(timer);
						relay?.close();
						resolve(null);
					},
				}
			);

			// Wait a bit for response
			setTimeout(() => {
				sub.close();
				if (relay) {
					relay.close();
				}
			}, timeout - 100);
		} catch (error) {
			clearTimeout(timer);
			if (relay) {
				relay.close();
			}
			safeConsoleError(`Error fetching relay list from ${relayUrl}:`, error);
			resolve(null);
		}
	});
}

/**
 * Fetch kind 10002 relay list from multiple relays
 */
export async function fetchRelayList(
	pubkey: string,
	relayUrls: string[] = DEFAULT_RELAY_URLS
): Promise<RelayInfo[]> {
	// Try each relay in parallel
	const promises = relayUrls.map((url) => fetchRelayListFromRelay(url, pubkey));
	const results = await Promise.all(promises);

	// Find first non-null result
	for (const result of results) {
		if (result && result.length > 0) {
			return result;
		}
	}

	// If none found, return default fallback (normalized)
	return [
		{
			url: normalizeRelayUrl(DEFAULT_FALLBACK_RELAY),
			read: true,
			write: true,
		},
	];
}

/**
 * Normalize a relay URL
 * - Removes trailing slashes
 * - Ensures lowercase
 * - Validates wss:// or ws:// protocol
 */
export function normalizeRelayUrl(url: string): string {
	if (!url) return url;
	
	let normalized = url.trim().toLowerCase();
	
	// Remove trailing slashes
	normalized = normalized.replace(/\/+$/, "");
	
	// Ensure protocol is present
	if (!normalized.startsWith("wss://") && !normalized.startsWith("ws://")) {
		// Default to wss:// if no protocol
		normalized = "wss://" + normalized;
	}
	
	return normalized;
}

/**
 * Deduplicate relay URLs by normalizing and comparing
 */
export function deduplicateRelayUrls(urls: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	
	for (const url of urls) {
		const normalized = normalizeRelayUrl(url);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			unique.push(normalized);
		}
	}
	
	return unique;
}

/**
 * Normalize and deduplicate relay list
 */
export function normalizeRelayList(relayList: RelayInfo[]): RelayInfo[] {
	const seen = new Set<string>();
	const normalized: RelayInfo[] = [];
	
	for (const relay of relayList) {
		const normalizedUrl = normalizeRelayUrl(relay.url);
		if (!seen.has(normalizedUrl)) {
			seen.add(normalizedUrl);
			normalized.push({
				url: normalizedUrl,
				read: relay.read,
				write: relay.write,
			});
		}
	}
	
	return normalized;
}

/**
 * Get write relays from relay list (normalized and deduplicated)
 */
export function getWriteRelays(relayList: RelayInfo[]): string[] {
	const writeRelays = relayList.filter((r) => r.write).map((r) => r.url);
	return deduplicateRelayUrls(writeRelays);
}

/**
 * Get read relays from relay list (normalized and deduplicated)
 */
export function getReadRelays(relayList: RelayInfo[]): string[] {
	const readRelays = relayList.filter((r) => r.read).map((r) => r.url);
	return deduplicateRelayUrls(readRelays);
}

/**
 * Check if relay list includes TheCitadel
 */
export function includesTheCitadel(relayList: RelayInfo[]): boolean {
	return relayList.some((r) => r.url.includes("thecitadel.nostr1.com"));
}

/**
 * Add TheCitadel to relay list if not present
 */
export function addTheCitadelIfMissing(relayList: RelayInfo[]): RelayInfo[] {
	if (includesTheCitadel(relayList)) {
		return relayList;
	}

	return normalizeRelayList([
		...relayList,
		{
			url: normalizeRelayUrl(DEFAULT_FALLBACK_RELAY),
			read: true,
			write: true,
		},
	]);
}
