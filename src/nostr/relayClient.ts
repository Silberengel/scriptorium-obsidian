import { Relay } from "nostr-tools";
import { SignedEvent, PublishingResult } from "../types";
import { ensureAuthenticated, handleAuthRequiredError } from "./authHandler";

/**
 * Publish a single event to a relay
 */
export async function publishEventToRelay(
	relayUrl: string,
	event: SignedEvent,
	privkey: string,
	timeout: number = 10000
): Promise<PublishingResult> {
	let relay: Relay | null = null;

	try {
		relay = new Relay(relayUrl);
		await relay.connect();

		// Ensure authenticated if needed
		await ensureAuthenticated(relay, privkey, relayUrl);

		// Set up notice handler for auth-required messages
		const originalOnNotice = relay.onnotice;
		relay.onnotice = (notice: string) => {
			if (notice.includes("auth-required")) {
				handleAuthRequiredError(relay!, privkey, relayUrl, async () => {
					return await relay!.publish(event);
				}).catch((error) => {
					console.error("Auth failed:", error);
				});
			}
			if (originalOnNotice) {
				originalOnNotice(notice);
			}
		};

		// Publish event - returns a promise that resolves with the reason string
		// The reason indicates success (e.g., "seen", "duplicate") or failure
		try {
			const reason = await Promise.race([
				relay.publish(event),
				new Promise<string>((resolve) => {
					setTimeout(() => resolve("timeout"), timeout);
				}),
			]);

			relay.close();

			// Check if publish was successful
			// Reasons like "seen", "duplicate", "broadcast" indicate success
			// "blocked", "invalid", etc. indicate failure
			const success = reason !== "timeout" && 
				!reason.toLowerCase().includes("error") &&
				!reason.toLowerCase().includes("blocked") &&
				!reason.toLowerCase().includes("invalid") &&
				!reason.toLowerCase().includes("restricted");

			return {
				eventId: event.id,
				relay: relayUrl,
				success,
				message: success ? undefined : reason,
			};
		} catch (error: any) {
			relay.close();
			return {
				eventId: event.id,
				relay: relayUrl,
				success: false,
				message: error.message || "Publish failed",
			};
		}
	} catch (error: any) {
		if (relay) {
			relay.close();
		}
		return {
			eventId: event.id,
			relay: relayUrl,
			success: false,
			message: error.message || "Failed to connect to relay",
		};
	}
}

/**
 * Publish events to multiple relays
 */
export async function publishEventsToRelays(
	relayUrls: string[],
	events: SignedEvent[],
	privkey: string
): Promise<PublishingResult[][]> {
	const results: PublishingResult[][] = [];

	for (const relayUrl of relayUrls) {
		const relayResults: PublishingResult[] = [];
		for (const event of events) {
			const result = await publishEventToRelay(relayUrl, event, privkey);
			relayResults.push(result);
		}
		results.push(relayResults);
	}

	return results;
}

/**
 * Publish events to relays with retry logic
 */
export async function publishEventsWithRetry(
	relayUrls: string[],
	events: SignedEvent[],
	privkey: string,
	maxRetries: number = 3
): Promise<PublishingResult[][]> {
	let attempts = 0;
	let results: PublishingResult[][] = [];

	while (attempts < maxRetries) {
		results = await publishEventsToRelays(relayUrls, events, privkey);
		
		// Check if all events succeeded on at least one relay
		const allSucceeded = results.some((relayResults) =>
			relayResults.every((r) => r.success)
		);

		if (allSucceeded) {
			break;
		}

		attempts++;
		if (attempts < maxRetries) {
			// Wait before retry
			await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
		}
	}

	return results;
}
