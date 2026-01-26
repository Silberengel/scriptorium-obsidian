import { Relay } from "nostr-tools";
import { SignedEvent, PublishingResult } from "../types";
import { ensureAuthenticated, handleAuthRequiredError } from "./authHandler";
import { safeConsoleError } from "../utils/security";
import { deduplicateRelayUrls, normalizeRelayUrl } from "../relayManager";

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
					safeConsoleError("Auth failed:", error);
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
			const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Publish failed";
			return {
				eventId: event.id,
				relay: relayUrl,
				success: false,
				message: safeMessage,
			};
		}
	} catch (error: any) {
		if (relay) {
			relay.close();
		}
		const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Failed to connect to relay";
		return {
			eventId: event.id,
			relay: relayUrl,
			success: false,
			message: safeMessage,
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
	// Normalize and deduplicate relay URLs before publishing
	const normalizedUrls = deduplicateRelayUrls(relayUrls.map(url => normalizeRelayUrl(url)));
	
	if (normalizedUrls.length === 0) {
		return [];
	}
	
	let attempts = 0;
	let results: PublishingResult[][] = [];

	while (attempts < maxRetries) {
		results = await publishEventsToRelays(normalizedUrls, events, privkey);
		
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
