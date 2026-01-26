import { Relay } from "nostr-tools";
import { safeConsoleError } from "../utils/security";

/**
 * User profile information
 */
export interface UserProfile {
	name?: string;
	display_name?: string;
	about?: string;
	picture?: string;
}

/**
 * Fetch user profile (kind 0) from relays
 */
export async function fetchUserProfile(
	pubkey: string,
	relayUrls: string[],
	timeout: number = 5000
): Promise<UserProfile | null> {
	for (const relayUrl of relayUrls) {
		try {
			const profile = await fetchProfileFromRelay(relayUrl, pubkey, timeout);
			if (profile) {
				return profile;
			}
		} catch (error) {
			safeConsoleError(`Error fetching profile from ${relayUrl}:`, error);
			continue;
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
						kinds: [0],
						authors: [pubkey],
					},
				],
				{
					onevent: (event) => {
						clearTimeout(timer);
						relay?.close();
						try {
							const profile = JSON.parse(event.content) as UserProfile;
							resolve(profile);
						} catch (error) {
							resolve(null);
						}
					},
					oneose: () => {
						clearTimeout(timer);
						relay?.close();
						resolve(null);
					},
				}
			);

			// Wait for response
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
			resolve(null);
		}
	});
}
