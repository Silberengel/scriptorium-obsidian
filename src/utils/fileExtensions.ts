import { TFile } from "obsidian";

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
