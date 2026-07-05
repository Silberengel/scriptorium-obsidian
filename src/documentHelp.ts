import { KindTemplate } from "./types";

export const SCRIPTORIUM_CALLOUT_TITLE = "Scriptorium";

export const SCRIPTORIUM_WORKFLOW_STEPS = [
	'Replace "place your content here" below with your note content',
	"Click the Nostr menu button (lightning bolt icon ⚡) in the left sidebar",
	'Select "Create Nostr events" to create and sign events',
	'Select "Publish events to relays" to publish to relays',
] as const;

export function getKindHelpSummary(template: KindTemplate): string {
	const base = template.description || template.name;
	return `${template.name} (kind ${template.kind}): ${base}`;
}

/** Collapsible Obsidian callout — native layout, stripped before Nostr publish. */
export function buildDocumentHelpCallout(template: KindTemplate): string[] {
	const lines = [
		`> [!info]- ${SCRIPTORIUM_CALLOUT_TITLE}`,
		`> ${getKindHelpSummary(template)}`,
	];
	for (let i = 0; i < SCRIPTORIUM_WORKFLOW_STEPS.length; i++) {
		lines.push(`> ${i + 1}. ${SCRIPTORIUM_WORKFLOW_STEPS[i]}`);
	}
	lines.push(">", "> *This help is not part of your note and will not be published.*");
	return lines;
}

/** AsciiDoc NOTE block equivalent for .adoc templates. */
export function buildDocumentHelpAsciiDoc(template: KindTemplate): string[] {
	const lines = ["[NOTE]", `.${SCRIPTORIUM_CALLOUT_TITLE}`, "====", getKindHelpSummary(template), ""];
	for (let i = 0; i < SCRIPTORIUM_WORKFLOW_STEPS.length; i++) {
		lines.push(`${i + 1}. ${SCRIPTORIUM_WORKFLOW_STEPS[i]}`);
	}
	lines.push("", "_This help is not part of your note and will not be published._", "====");
	return lines;
}

function stripScriptoriumCallout(body: string): string {
	const lines = body.split("\n");
	const out: string[] = [];
	let skipping = false;
	const calloutHeader = /^>\s*\[!info\][+-]?\s*Scriptorium\b/i;
	const calloutLine = /^>\s?/;

	for (const line of lines) {
		const trimmed = line.trim();
		if (calloutHeader.test(trimmed)) {
			skipping = true;
			continue;
		}
		if (skipping) {
			if (calloutLine.test(trimmed)) continue;
			skipping = false;
		}
		out.push(line);
	}

	return out.join("\n");
}

function stripScriptoriumAsciiDocNote(body: string): string {
	const pattern = /(?:^|\r?\n)\[NOTE\]\r?\n\.Scriptorium\r?\n====[\s\S]*?\r?\n====/;
	return body.replace(pattern, "");
}

function stripLegacyHelpBlock(body: string): string {
	const lines = body.split("\n");
	const helpHeading = /^(?:\*\*)?How to use this app:(?:\*\*)?/i;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== "---") continue;

		const tail = lines.slice(i + 1);
		if (!tail.some((line) => helpHeading.test(line.trim()))) continue;

		let start = i;
		while (start > 0 && lines[start - 1].trim() === "") start--;
		return lines.slice(0, start).join("\n").trimEnd();
	}

	return body;
}

/** Remove help callouts and legacy in-document help before building Nostr events. */
export function stripEmbeddedDocumentHelp(body: string): string {
	let result = stripLegacyHelpBlock(body);
	result = stripScriptoriumCallout(result);
	result = stripScriptoriumAsciiDocNote(result);
	return result.replace(/^\n+/, "").trimEnd();
}
