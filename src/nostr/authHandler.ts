import { Relay, finalizeEvent, getPublicKey } from "nostr-tools";
import { normalizeSecretKey } from "./eventBuilder";

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
		const pubkey = getPublicKey(normalizedKey);

		// Create kind 22242 AUTH event
		const authEvent = finalizeEvent(
			{
				kind: 22242,
				pubkey,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					["relay", relayUrl],
					["challenge", challenge],
				],
				content: "",
			},
			normalizedKey
		);

		// Send AUTH event
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				resolve(false);
			}, 10000);

			relay.on("ok", (ok) => {
				if (ok.id === authEvent.id && ok.ok) {
					clearTimeout(timeout);
					resolve(true);
				}
			});

			relay.on("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});

			relay.send(["AUTH", authEvent]);

			// Also listen for OK message directly
			setTimeout(() => {
				clearTimeout(timeout);
				resolve(false);
			}, 5000);
		});
	} catch (error) {
		console.error("Error handling AUTH challenge:", error);
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
	return new Promise((resolve) => {
		let challengeReceived = false;
		let authHandled = false;

		const timeout = setTimeout(() => {
			if (!authHandled) {
				resolve(true); // Assume no AUTH required if no challenge received
			}
		}, 2000);

		// Listen for AUTH challenge
		relay.on("auth", async (challenge: string) => {
			challengeReceived = true;
			clearTimeout(timeout);
			const success = await handleAuthChallenge(relay, challenge, privkey, relayUrl);
			authHandled = true;
			resolve(success);
		});

		// If no challenge received within timeout, assume no AUTH required
		setTimeout(() => {
			if (!challengeReceived) {
				clearTimeout(timeout);
				authHandled = true;
				resolve(true);
			}
		}, 2000);
	});
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
	// Try to authenticate
	const authenticated = await ensureAuthenticated(relay, privkey, relayUrl);
	if (!authenticated) {
		throw new Error("Failed to authenticate with relay");
	}

	// Retry original operation
	return originalOperation();
}
