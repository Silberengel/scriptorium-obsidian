import { Relay } from "nostr-tools";
import { safeConsoleError } from "../utils/security";

/**
 * User profile information
 */
export interface UserProfile {
	name?: string;
	display_name?: string;
	username?: string;
	nip05?: string; // NIP-05 identifier (handle)
	about?: string;
	picture?: string;
}

/**
 * Fetch user profile (kind 0) from relays
 */
export async function fetchUserProfile(
	pubkey: string,
	relayUrls: string[],
	timeout: number = 10000
): Promise<UserProfile | null> {
	if (relayUrls.length === 0) {
		return null;
	}
	
	// Try all relays in parallel for faster response
	const promises = relayUrls.map(relayUrl => 
		fetchProfileFromRelay(relayUrl, pubkey, timeout).catch(error => {
			safeConsoleError(`Error fetching profile from ${relayUrl}:`, error);
			return null;
		})
	);
	
	const results = await Promise.all(promises);
	
	// Return first successful result
	for (const profile of results) {
		if (profile) {
			return profile;
		}
	}
	
	return null;
}

/**
 * Fetch profile from a single relay
 */
async function fetchProfileFromRelay(
	relayUrl: string,
	pubkey: string,
	timeout: number
): Promise<UserProfile | null> {
	let relay: Relay | null = null;

	try {
		relay = new Relay(relayUrl);
		await relay.connect();

		return await new Promise<UserProfile | null>((resolve) => {
			let profileReceived = false;
			const timer = setTimeout(() => {
				relay?.close();
				resolve(null);
			}, timeout);

			const sub = relay!.subscribe(
				[
					{
						kinds: [0],
						authors: [pubkey],
						limit: 1,
					},
				],
				{
					onevent: (event) => {
						if (profileReceived) return;
						profileReceived = true;
						clearTimeout(timer);
						sub.close();
						relay?.close();
						try {
							const profile = JSON.parse(event.content) as UserProfile;
							if (profile && (profile.name || profile.display_name || profile.nip05 || profile.username)) {
								resolve(profile);
							} else {
								resolve(null);
							}
						} catch {
							resolve(null);
						}
					},
					oneose: () => {
						if (!profileReceived) {
							clearTimeout(timer);
							sub.close();
							relay?.close();
							resolve(null);
						}
					},
				}
			);

			setTimeout(() => {
				if (!profileReceived) {
					sub.close();
					relay?.close();
				}
			}, timeout);
		});
	} catch {
		if (relay) {
			relay.close();
		}
		return null;
	}
}
