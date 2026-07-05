import { Relay } from "nostr-tools";
import { SignedEvent, PublishingResult } from "../types";
import {
	ensureAuthenticated,
	handleAuthRequiredError,
	isAuthRequiredResponse,
	isPublishSuccess,
} from "./authHandler";
import { sanitizeErrorMessage } from "../utils/errorHandling";
import { deduplicateRelayUrls, normalizeRelayUrl } from "../relayManager";

const DEFAULT_TIMEOUT = 10000;

function publishWithTimeout(relay: Relay, event: SignedEvent, timeout: number): Promise<string> {
	return Promise.race([
		relay.publish(event),
		new Promise<string>((resolve) => {
			setTimeout(() => resolve("timeout"), timeout);
		}),
	]);
}

/**
 * Publish a single event to an already-connected relay, with AUTH retry
 */
async function publishEventOnRelay(
	relay: Relay,
	event: SignedEvent,
	privkey: string,
	timeout: number = DEFAULT_TIMEOUT
): Promise<PublishingResult> {
	const relayUrl = relay.url;

	try {
		let reason = await publishWithTimeout(relay, event, timeout);

		if (isAuthRequiredResponse(reason)) {
			reason = await handleAuthRequiredError(relay, privkey, () =>
				publishWithTimeout(relay, event, timeout)
			);
		}

		const success = isPublishSuccess(reason);
		return {
			eventId: event.id,
			relay: relayUrl,
			success,
			message: success ? undefined : reason,
		};
	} catch (error: any) {
		return {
			eventId: event.id,
			relay: relayUrl,
			success: false,
			message: sanitizeErrorMessage(error) || "Publish failed",
		};
	}
}

/**
 * Publish all events to a single relay sequentially (preserves dependency order)
 */
async function publishAllEventsToRelay(
	relayUrl: string,
	events: SignedEvent[],
	privkey: string,
	timeout: number = DEFAULT_TIMEOUT
): Promise<PublishingResult[]> {
	let relay: Relay | null = null;

	try {
		relay = new Relay(relayUrl);
		ensureAuthenticated(relay, privkey);
		await relay.connect();

		const results: PublishingResult[] = [];
		for (const event of events) {
			results.push(await publishEventOnRelay(relay, event, privkey, timeout));
		}
		return results;
	} catch (error: any) {
		return events.map((event) => ({
			eventId: event.id,
			relay: relayUrl,
			success: false,
			message: sanitizeErrorMessage(error) || "Failed to connect to relay",
		}));
	} finally {
		relay?.close();
	}
}

/**
 * Publish events to multiple relays in parallel
 */
export async function publishEventsToRelays(
	relayUrls: string[],
	events: SignedEvent[],
	privkey: string
): Promise<PublishingResult[][]> {
	return Promise.all(
		relayUrls.map((relayUrl) => publishAllEventsToRelay(relayUrl, events, privkey))
	);
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
	const normalizedUrls = deduplicateRelayUrls(relayUrls.map((url) => normalizeRelayUrl(url)));

	if (normalizedUrls.length === 0) {
		return [];
	}

	let attempts = 0;
	let results: PublishingResult[][] = [];

	while (attempts < maxRetries) {
		results = await publishEventsToRelays(normalizedUrls, events, privkey);

		const allSucceeded = results.some((relayResults) =>
			relayResults.every((r) => r.success)
		);

		if (allSucceeded) {
			break;
		}

		attempts++;
		if (attempts < maxRetries) {
			await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
		}
	}

	return results;
}
