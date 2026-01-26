import { Relay, relayInit } from "nostr-tools";
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
		relay = relayInit(relayUrl);
		await relay.connect();

		// Ensure authenticated if needed
		await ensureAuthenticated(relay, privkey, relayUrl);

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (relay) {
					relay.close();
				}
				resolve({
					eventId: event.id,
					relay: relayUrl,
					success: false,
					message: "Timeout waiting for relay response",
				});
			}, timeout);

			const publishPromise = new Promise<PublishingResult>((innerResolve) => {
				relay!.on("ok", (ok) => {
					if (ok.id === event.id) {
						clearTimeout(timer);
						relay?.close();
						innerResolve({
							eventId: event.id,
							relay: relayUrl,
							success: ok.ok,
							message: ok.message || undefined,
						});
					}
				});

				relay!.on("error", (error) => {
					clearTimeout(timer);
					relay?.close();
					innerResolve({
						eventId: event.id,
						relay: relayUrl,
						success: false,
						message: error.message || "Relay error",
					});
				});

				// Handle auth-required errors
				relay!.on("notice", (notice) => {
					if (notice.includes("auth-required")) {
						handleAuthRequiredError(relay!, privkey, relayUrl, async () => {
							relay!.publish(event);
						}).catch((error) => {
							clearTimeout(timer);
							relay?.close();
							innerResolve({
								eventId: event.id,
								relay: relayUrl,
								success: false,
								message: `Auth failed: ${error.message}`,
							});
						});
					}
				});

				relay!.publish(event);
			});

			publishPromise.then(resolve);
		});
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
