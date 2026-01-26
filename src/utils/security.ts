/**
 * Security utilities to prevent private key leaks
 */

/**
 * Check if a hex string is likely a private key based on context
 * Private keys are 64 hex characters, but so are public keys and event IDs.
 * We can only identify private keys by context (error messages, variable names, etc.)
 */
function isLikelyPrivateKey(context: string, hexString: string): boolean {
	const lowerContext = context.toLowerCase();
	
	// Check for explicit private key indicators
	const privateKeyIndicators = [
		'privkey', 'private_key', 'privatekey', 'secret', 'nsec',
		'private key', 'secret key', 'signing key'
	];
	
	// Check if context mentions private key concepts
	for (const indicator of privateKeyIndicators) {
		if (lowerContext.includes(indicator)) {
			return true;
		}
	}
	
	// If it's in an error message about keys, it's likely a private key
	if (lowerContext.includes('key') && 
	    (lowerContext.includes('invalid') || lowerContext.includes('error') || lowerContext.includes('failed'))) {
		return true;
	}
	
	return false;
}

/**
 * Sanitize a string to remove any private key patterns
 * 
 * Distinguishes between:
 * - Private keys: nsec1... (bech32) or hex in private key context
 * - Public keys: npub1... (bech32) or hex (64 chars) - these are SAFE to log
 * - Event IDs: hex (64 chars) - these are SAFE to log
 */
export function sanitizeString(str: string): string {
	if (!str) return str;
	
	let sanitized = str;
	
	// Remove nsec bech32 keys (nsec1...) - these are ALWAYS private keys
	const nsecPattern = /nsec1[a-z0-9]{58,}/gi;
	sanitized = sanitized.replace(nsecPattern, "[PRIVATE_KEY_REDACTED]");
	
	// For hex strings (64 chars), only remove if context suggests it's a private key
	// Public keys (npub1... or hex) and event IDs (hex) should NOT be removed
	const hexPattern = /(?:^|\s|"|'|`)([0-9a-f]{64})(?:\s|"|'|`|$)/gi;
	sanitized = sanitized.replace(hexPattern, (match, hexString, offset) => {
		// Get surrounding context (50 chars before and after)
		const start = Math.max(0, offset - 50);
		const end = Math.min(str.length, offset + match.length + 50);
		const context = str.substring(start, end);
		
		// Only redact if context suggests it's a private key
		if (isLikelyPrivateKey(context, hexString)) {
			return match.replace(hexString, "[PRIVATE_KEY_REDACTED]");
		}
		
		// Otherwise, it's likely a public key or event ID - keep it
		return match;
	});
	
	return sanitized;
}

/**
 * Sanitize an error object to remove private keys
 */
export function sanitizeError(error: any): any {
	if (!error) return error;
	
	// If it's a string, sanitize it
	if (typeof error === "string") {
		return sanitizeString(error);
	}
	
	// If it's an Error object, sanitize the message
	if (error instanceof Error) {
		const sanitized = new Error(sanitizeString(error.message));
		sanitized.name = error.name;
		sanitized.stack = error.stack ? sanitizeString(error.stack) : undefined;
		return sanitized;
	}
	
	// If it's an object, sanitize string properties
	if (typeof error === "object") {
		const sanitized: any = {};
		for (const [key, value] of Object.entries(error)) {
			if (typeof value === "string") {
				sanitized[key] = sanitizeString(value);
			} else if (value instanceof Error) {
				sanitized[key] = sanitizeError(value);
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}
	
	return error;
}

/**
 * Safe console.error that never logs private keys
 */
export function safeConsoleError(message: string, ...args: any[]): void {
	const sanitizedArgs = args.map(arg => sanitizeError(arg));
	console.error(sanitizeString(message), ...sanitizedArgs);
}

/**
 * Safe console.log that never logs private keys
 */
export function safeConsoleLog(message: string, ...args: any[]): void {
	const sanitizedArgs = args.map(arg => sanitizeError(arg));
	console.log(sanitizeString(message), ...sanitizedArgs);
}

/**
 * Verify that an event doesn't contain private key in content or tags
 * 
 * Note: Public keys and event IDs are EXPECTED in events and should NOT be flagged.
 * Only private keys (nsec1...) should be detected.
 */
export function verifyEventSecurity(event: any): boolean {
	if (!event) return false;
	
	// Check content for nsec bech32 private keys
	if (event.content && typeof event.content === "string") {
		// Only check for nsec1... bech32 private keys
		// Public keys (npub1... or hex) and event IDs (hex) are safe
		if (event.content.includes("nsec1")) {
			return false;
		}
		
		// Check for hex strings that might be private keys in content
		// This is tricky - we can't distinguish hex private keys from public keys/event IDs
		// But if content contains "nsec" or "private key" context, flag it
		const contentLower = event.content.toLowerCase();
		if ((contentLower.includes("nsec") || 
		     contentLower.includes("private key") || 
		     contentLower.includes("privkey")) &&
		    /[0-9a-f]{64}/i.test(event.content)) {
			// Context suggests private key - flag it
			return false;
		}
	}
	
	// Check tags for nsec bech32 private keys
	if (event.tags && Array.isArray(event.tags)) {
		for (const tag of event.tags) {
			if (Array.isArray(tag)) {
				for (const value of tag) {
					if (typeof value === "string") {
						// Only flag nsec1... bech32 private keys
						// Public keys in "p" tags and event IDs in "e" tags are EXPECTED
						if (value.includes("nsec1")) {
							return false;
						}
					}
				}
			}
		}
	}
	
	return true;
}
