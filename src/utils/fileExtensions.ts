import { TFile } from "obsidian";
import { EventKind } from "../types";

/**
 * Check if file is a Markdown file
 */
export function isMarkdownFile(file: TFile): boolean {
	return file.extension === "md" || file.extension === "markdown";
}

/**
 * Check if file is an AsciiDoc file
 */
export function isAsciiDocFile(file: TFile): boolean {
	return file.extension === "adoc" || file.extension === "asciidoc";
}

/**
 * Get file extension type
 */
export function getFileType(file: TFile): "markdown" | "asciidoc" | "unknown" {
	if (isMarkdownFile(file)) return "markdown";
	if (isAsciiDocFile(file)) return "asciidoc";
	return "unknown";
}
