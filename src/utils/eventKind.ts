import { TFile } from "obsidian";
import { EventKind } from "../types";
import { isAsciiDocFile, isMarkdownFile } from "./fileExtensions";
import { isAsciiDocDocument } from "../asciidocParser";

/**
 * Determine event kind from file extension and content
 */
export function determineEventKind(
	file: TFile,
	content: string,
	defaultKind: EventKind,
	metadataKind?: EventKind
): EventKind {
	if (isAsciiDocFile(file)) {
		if (isAsciiDocDocument(content)) {
			return 30040;
		}
		return 30818;
	}
	
	if (isMarkdownFile(file)) {
		return metadataKind || defaultKind;
	}
	
	return defaultKind;
}

/**
 * Get folder name for an event kind
 */
export function getFolderNameForKind(kind: EventKind): string {
	const folderMap: Record<EventKind, string> = {
		1: "kind-1-notes",
		11: "kind-11-threads",
		30023: "kind-30023-articles",
		30040: "kind-30040-publications",
		30041: "kind-30041-chapters",
		30817: "kind-30817-wiki-md",
		30818: "kind-30818-wiki-adoc",
	};
	return folderMap[kind];
}

/**
 * Check if event kind requires a title
 */
export function requiresTitle(kind: EventKind): boolean {
	return kind !== 1;
}
