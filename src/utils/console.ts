/**
 * Centralized console logging utilities
 * All logging goes through stderr for Obsidian plugin debugging
 */

/**
 * Log a message to stderr (Obsidian console)
 */
export function log(message: string): void {
	console.error(`[Scriptorium] ${message}`);
	if (typeof process !== "undefined" && process.stderr) {
		process.stderr.write(`[Scriptorium] ${message}\n`);
	}
}

/**
 * Log an error with optional stack trace
 */
export function logError(message: string, error?: any): void {
	const errorMsg = error?.message || String(error || "");
	const stackTrace = error?.stack || "";
	
	log(`Error: ${message} - ${errorMsg}`);
	if (stackTrace) {
		log(`Stack trace: ${stackTrace}`);
	}
}
