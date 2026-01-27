import { Notice } from "obsidian";
import { sanitizeString } from "./security";

/**
 * Sanitize error message for display (removes private keys)
 */
export function sanitizeErrorMessage(error: any): string {
	if (!error) return "Unknown error";
	
	const message = error?.message || String(error);
	return sanitizeString(message)
		.replace(/nsec1[a-z0-9]{58,}/gi, "[REDACTED]")
		.replace(/[0-9a-f]{64}/gi, "[REDACTED]");
}

/**
 * Show a notice with sanitized error message
 */
export function showErrorNotice(message: string, error?: any): void {
	const safeMessage = error ? sanitizeErrorMessage(error) : message;
	new Notice(safeMessage);
}
