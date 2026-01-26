import { Relay, relayInit, getPublicKey } from "nostr-tools";
import { RelayInfo } from "./types";

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
			const url = tag[1];
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
			relay = relayInit(relayUrl);
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
						resolve(relayList.length > 0 ? relayList : null);
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
			console.error(`Error fetching relay list from ${relayUrl}:`, error);
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

	// If none found, return default fallback
	return [
		{
			url: DEFAULT_FALLBACK_RELAY,
			read: true,
			write: true,
		},
	];
}

/**
 * Get write relays from relay list
 */
export function getWriteRelays(relayList: RelayInfo[]): string[] {
	return relayList.filter((r) => r.write).map((r) => r.url);
}

/**
 * Get read relays from relay list
 */
export function getReadRelays(relayList: RelayInfo[]): string[] {
	return relayList.filter((r) => r.read).map((r) => r.url);
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

	return [
		...relayList,
		{
			url: DEFAULT_FALLBACK_RELAY,
			read: true,
			write: true,
		},
	];
}
