import { Relay, finalizeEvent, getPublicKey } from "nostr-tools";
import { normalizeSecretKey } from "./eventBuilder";
import { safeConsoleError } from "../utils/security";

/**
 * Handle AUTH challenge from relay (NIP-42)
 */
export async function handleAuthChallenge(
	relay: Relay,
	challenge: string,
	privkey: string,
	relayUrl: string
): Promise<boolean> {
	try {
		const normalizedKey = normalizeSecretKey(privkey);

		// Use relay.auth() method which handles the AUTH flow
		// auth() returns a promise that resolves with a string (challenge response)
		// We consider it successful if it doesn't throw
		await relay.auth(async (eventTemplate) => {
			return finalizeEvent(eventTemplate, normalizedKey);
		});
		return true;
	} catch (error) {
		safeConsoleError("Error handling AUTH challenge:", error);
		return false;
	}
}

/**
 * Check if relay requires AUTH and handle it
 */
export async function ensureAuthenticated(
	relay: Relay,
	privkey: string,
	relayUrl: string
): Promise<boolean> {
	try {
		const normalizedKey = normalizeSecretKey(privkey);
		
		// Set up auth handler if relay sends challenge
		relay.onauth = async (eventTemplate) => {
			return finalizeEvent(eventTemplate, normalizedKey);
		};

		// Try to authenticate - this will only run if relay requires it
		// The relay will call onauth if it needs authentication
		return true;
	} catch (error) {
		safeConsoleError("Error ensuring authentication:", error);
		return false;
	}
}

/**
 * Handle auth-required error and retry with AUTH
 */
export async function handleAuthRequiredError(
	relay: Relay,
	privkey: string,
	relayUrl: string,
	originalOperation: () => Promise<any>
): Promise<any> {
	try {
		const normalizedKey = normalizeSecretKey(privkey);
		
		// Authenticate using relay.auth()
		await relay.auth(async (eventTemplate) => {
			return finalizeEvent(eventTemplate, normalizedKey);
		});

		// Retry original operation
		return originalOperation();
	} catch (error: any) {
		// Sanitize error message to prevent private key leaks
		const safeMessage = error?.message ? String(error.message).replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]").replace(/[0-9a-f]{64}/gi, "[REDACTED]") : "Unknown error";
		throw new Error(`Failed to authenticate with relay: ${safeMessage}`);
	}
}
