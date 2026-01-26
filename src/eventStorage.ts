import { TFile } from "obsidian";
import { SignedEvent } from "./types";

/**
 * Get events file path for a given file
 */
export function getEventsFilePath(file: TFile): string {
	const path = file.path;
	const ext = file.extension;
	const basePath = path.slice(0, -(ext.length + 1)); // Remove extension and dot
	return `${basePath}_events.jsonl`;
}

/**
 * Save events to .jsonl file
 */
export async function saveEvents(
	file: TFile,
	events: SignedEvent[],
	app: any
): Promise<void> {
	const eventsPath = getEventsFilePath(file);
	const lines = events.map((event) => JSON.stringify(event));
	const content = lines.join("\n") + "\n";
	await app.vault.adapter.write(eventsPath, content);
}

/**
 * Load events from .jsonl file
 */
export async function loadEvents(
	file: TFile,
	app: any
): Promise<SignedEvent[]> {
	const eventsPath = getEventsFilePath(file);
	try {
		const eventsFile = app.vault.getAbstractFileByPath(eventsPath);
		if (!eventsFile || !(eventsFile instanceof TFile)) {
			return [];
		}
		const content = await app.vault.read(eventsFile);
		const lines = content.split("\n").filter((line: string) => line.trim().length > 0);
		return lines.map((line: string) => JSON.parse(line) as SignedEvent);
	} catch (error) {
		console.error("Error loading events:", error);
		return [];
	}
}

/**
 * Check if events file exists
 */
export async function eventsFileExists(file: TFile, app: any): Promise<boolean> {
	const eventsPath = getEventsFilePath(file);
	const eventsFile = app.vault.getAbstractFileByPath(eventsPath);
	return eventsFile instanceof TFile;
}

/**
 * Delete events file
 */
export async function deleteEvents(file: TFile, app: any): Promise<void> {
	const eventsPath = getEventsFilePath(file);
	try {
		const eventsFile = app.vault.getAbstractFileByPath(eventsPath);
		if (eventsFile && eventsFile instanceof TFile) {
			await app.vault.delete(eventsFile);
		}
	} catch (error) {
		console.error("Error deleting events file:", error);
	}
}
