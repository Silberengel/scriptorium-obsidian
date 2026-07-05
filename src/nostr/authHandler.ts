import { Relay, finalizeEvent } from "nostr-tools";
import { normalizeSecretKey } from "./eventBuilder";

/**
 * Set up NIP-42 auth handler on a relay before connecting
 */
export function ensureAuthenticated(
	relay: Relay,
	privkey: string
): void {
	const normalizedKey = normalizeSecretKey(privkey);
	relay.onauth = async (eventTemplate) => {
		return finalizeEvent(eventTemplate, normalizedKey);
	};
}

/**
 * Handle auth-required error and retry with AUTH
 */
export async function handleAuthRequiredError(
	relay: Relay,
	privkey: string,
	originalOperation: () => Promise<string>
): Promise<string> {
	const normalizedKey = normalizeSecretKey(privkey);

	await relay.auth(async (eventTemplate) => {
		return finalizeEvent(eventTemplate, normalizedKey);
	});

	return originalOperation();
}

/**
 * Check if a publish response indicates auth is required
 */
export function isAuthRequiredResponse(reason: string): boolean {
	const lower = reason.toLowerCase();
	return (
		lower.includes("auth-required") ||
		lower.includes("auth required") ||
		lower.includes("not authorized") ||
		lower.includes("unauthorized")
	);
}

/**
 * Check if a publish response indicates success (NIP-20 OK message).
 * Only an empty message or a duplicate prefix means the relay accepted the event.
 */
export function isPublishSuccess(reason: string): boolean {
	const trimmed = reason.trim();
	if (trimmed === "") return true;

	const lower = trimmed.toLowerCase();
	if (lower === "ok") return true;
	if (lower.startsWith("duplicate:")) return true;

	return false;
}
