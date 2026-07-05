import { TFile } from "obsidian";
import { MarkupFormat, StructureNode, TemplateMetadata } from "./types";
import { parseAsciiDocStructure, isAsciiDocDocument } from "./asciidocParser";
import { parseMarkdownStructure, isMarkdownHierarchicalDocument } from "./markdownParser";
import { isAsciiDocFile, isMarkdownFile } from "./utils/fileExtensions";

export function isStructuredSourceDocument(
	content: string,
	markup: MarkupFormat,
	file?: TFile,
	metadata?: Partial<TemplateMetadata>
): boolean {
	if (markup === "asciidoc") {
		return (!file || isAsciiDocFile(file)) && isAsciiDocDocument(content);
	}
	return (!file || isMarkdownFile(file)) && isMarkdownHierarchicalDocument(content, metadata);
}

export function parseDocumentStructure(
	content: string,
	metadata: TemplateMetadata | undefined,
	indexKind: number,
	contentKind: number,
	markup: MarkupFormat
): StructureNode[] {
	if (markup === "markdown") {
		return parseMarkdownStructure(content, metadata, indexKind, contentKind);
	}
	return parseAsciiDocStructure(content, metadata, indexKind, contentKind);
}
