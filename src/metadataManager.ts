import * as yaml from "js-yaml";
import { TFile } from "obsidian";
import { EventKind, EventMetadata } from "./types";
import { safeConsoleError } from "./utils/security";

/**
 * Get metadata file path for a given file
 */
export function getMetadataFilePath(file: TFile): string {
	const path = file.path;
	const ext = file.extension;
	const basePath = path.slice(0, -(ext.length + 1)); // Remove extension and dot
	return `${basePath}_metadata.yml`;
}

/**
 * Read metadata from YAML file
 */
export async function readMetadata(
	file: TFile,
	app: any
): Promise<EventMetadata | null> {
	const metadataPath = getMetadataFilePath(file);
	try {
		const metadataFile = app.vault.getAbstractFileByPath(metadataPath);
		if (!metadataFile || !(metadataFile instanceof TFile)) {
			return null;
		}
		const content = await app.vault.read(metadataFile);
		const parsed = yaml.load(content) as any;
		return parsed as EventMetadata;
	} catch (error) {
		safeConsoleError("Error reading metadata:", error);
		return null;
	}
}

/**
 * Write metadata to YAML file
 */
export async function writeMetadata(
	file: TFile,
	metadata: EventMetadata,
	app: any
): Promise<void> {
	const metadataPath = getMetadataFilePath(file);
	const yamlContent = yaml.dump(metadata, {
		indent: 2,
		lineWidth: -1,
	});
	
	// Check if metadata file already exists
	const existingMetadataFile = app.vault.getAbstractFileByPath(metadataPath);
	if (existingMetadataFile && existingMetadataFile instanceof TFile) {
		// Update existing file
		await app.vault.modify(existingMetadataFile, yamlContent);
	} else {
		// Create new file using vault.create() so it shows up in Obsidian
		await app.vault.create(metadataPath, yamlContent);
	}
}

/**
 * Validate metadata for a specific event kind
 */
export function validateMetadata(
	metadata: EventMetadata,
	kind: EventKind
): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	// Check that kind matches
	if (metadata.kind !== kind) {
		errors.push(`Metadata kind ${metadata.kind} does not match expected kind ${kind}`);
	}

	// Validate based on kind
	switch (kind) {
		case 1:
		case 11:
			// No special requirements
			break;

		case 30023:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 30023");
			}
			break;

		case 30040:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 30040");
			}
			break;

		case 30041:
			if (!metadata.title) {
				errors.push("Title is mandatory for kind 30041");
			}
			break;

		case 30817:
		case 30818:
			if (!metadata.title) {
				errors.push(`Title is mandatory for kind ${kind}`);
			}
			break;
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Create default metadata for a given kind
 */
export function createDefaultMetadata(kind: EventKind): EventMetadata {
	switch (kind) {
		case 1:
			return { kind: 1 };
		case 11:
			return { kind: 11 };
		case 30023:
			return {
				kind: 30023,
				title: "",
			};
		case 30040:
			return {
				kind: 30040,
				title: "",
				type: "book",
				auto_update: "ask",
			};
		case 30041:
			return {
				kind: 30041,
				title: "",
			};
		case 30817:
			return {
				kind: 30817,
				title: "",
			};
		case 30818:
			return {
				kind: 30818,
				title: "",
			};
	}
}

/**
 * Merge metadata with document header title (for 30040)
 */
export function mergeWithHeaderTitle(
	metadata: EventMetadata,
	headerTitle: string
): EventMetadata {
	if (metadata.kind === 30040) {
		// Only use header title if metadata doesn't have a title
		if (!metadata.title || metadata.title.trim() === "") {
			return {
				...metadata,
				title: headerTitle,
			};
		}
	}
	return metadata;
}
