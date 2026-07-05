import { KindTemplate } from "./types";

export const SCRIPTORIUM_WORKFLOW_STEPS = [
	"Edit your content above",
	"Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar",
	'Select "Create Nostr events" to create and sign events',
	'Select "Publish events to relays" to publish to relays',
] as const;

export function getKindHelpSummary(template: KindTemplate): string {
	const base = template.description || template.name;
	return `${template.name} (kind ${template.kind}): ${base}`;
}

/** Strip legacy in-document help blocks from older templates. */
export function stripEmbeddedDocumentHelp(body: string): string {
	const pattern = /\r?\n---\r?\n[\s\S]*?(?:\*\*)?How to use this app:(?:\*\*)?[\s\S]*$/;
	const match = body.match(pattern);
	if (match?.index !== undefined) {
		return body.slice(0, match.index).trimEnd();
	}
	return body;
}
