/**
 * Centralized console logging utilities
 * All logging goes through stderr for Obsidian plugin debugging
 */

import { sanitizeError, sanitizeString } from "./security";

/**
 * Log a message to stderr (Obsidian console)
 */
export function log(message: string): void {
	const safeMessage = sanitizeString(message);
	console.error(`[Scriptorium] ${safeMessage}`);
	if (typeof process !== "undefined" && process.stderr) {
		process.stderr.write(`[Scriptorium] ${safeMessage}\n`);
	}
}

/**
 * Log an error with optional stack trace
 */
export function logError(message: string, error?: any): void {
	const sanitized = error ? sanitizeError(error) : null;
	const errorMsg = sanitized?.message || (error ? sanitizeString(String(error)) : "");
	const stackTrace = sanitized?.stack || (error?.stack ? sanitizeString(error.stack) : "");

	log(`Error: ${message}${errorMsg ? ` - ${errorMsg}` : ""}`);
	if (stackTrace) {
		log(`Stack trace: ${stackTrace}`);
	}
}
