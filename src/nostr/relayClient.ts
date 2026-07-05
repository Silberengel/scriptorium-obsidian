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
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout")), timeout);
		relay.publish(event).then(
			(reason) => {
				clearTimeout(timer);
				resolve(reason);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
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
	const priorNotice = relay.onnotice;
	let relayNotice: string | undefined;
	relay.onnotice = (msg: string) => {
		relayNotice = msg;
		priorNotice?.(msg);
	};

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
			message: success ? undefined : reason || relayNotice,
		};
	} catch (error: any) {
		const message = sanitizeErrorMessage(error) || relayNotice || "Publish failed";
		if (isAuthRequiredResponse(message)) {
			try {
				const reason = await handleAuthRequiredError(relay, privkey, () =>
					publishWithTimeout(relay, event, timeout)
				);
				const success = isPublishSuccess(reason);
				return {
					eventId: event.id,
					relay: relayUrl,
					success,
					message: success ? undefined : reason || relayNotice,
				};
			} catch (retryError: any) {
				return {
					eventId: event.id,
					relay: relayUrl,
					success: false,
					message: sanitizeErrorMessage(retryError) || relayNotice || "Publish failed after auth retry",
				};
			}
		}
		return {
			eventId: event.id,
			relay: relayUrl,
			success: false,
			message,
		};
	} finally {
		relay.onnotice = priorNotice;
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
 * Publish events to all configured write relays (single attempt).
 * Events remain in the local _events.jsonl file; adjust relays in settings
 * and run Publish again manually if some relays fail.
 */
export async function publishEventsWithRetry(
	relayUrls: string[],
	events: SignedEvent[],
	privkey: string
): Promise<PublishingResult[][]> {
	const normalizedUrls = deduplicateRelayUrls(relayUrls.map((url) => normalizeRelayUrl(url)));

	if (normalizedUrls.length === 0) {
		return [];
	}

	return publishEventsToRelays(normalizedUrls, events, privkey);
}
