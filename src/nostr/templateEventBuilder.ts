import { KindTemplate, TemplateMetadata } from "../types";
import { uniqueDTag } from "./eventBuilder";
import { requiresDTag, requiresPublishedAt } from "../utils/nip01Kind";
import { addNKBIP08TagsTo30040, addNKBIP08TagsTo30041 } from "./nkbip08Tags";

export interface BuildTagsOptions {
	createdAt?: number;
	dTag?: string;
}

function normalizeTopics(topics: string | string[] | undefined): string[] {
	if (!topics) return [];
	if (Array.isArray(topics)) return topics;
	if (typeof topics === "string") {
		return topics.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
	}
	return [];
}

function getMetaValue(metadata: TemplateMetadata, key: string): unknown {
	return metadata[key];
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build tags array from metadata using a kind template
 */
export function buildTagsFromTemplate(
	metadata: TemplateMetadata,
	template: KindTemplate,
	pubkey: string,
	childEvents?: Array<{ kind: number; dTag: string; eventId?: string }>,
	options?: BuildTagsOptions
): string[][] {
	const tags: string[][] = [];
	const meta = metadata as Record<string, unknown>;
	const createdAt = options?.createdAt ?? Math.floor(Date.now() / 1000);

	if (requiresPublishedAt(template.kind)) {
		tags.push(["published_at", String(createdAt)]);
	}

	const titleValue = meta.title;
	if (isNonEmptyString(titleValue)) {
		if (requiresDTag(template.kind)) {
			const dTag = options?.dTag ?? uniqueDTag(titleValue, createdAt);
			tags.push(["d", dTag]);
		}
	}

	for (const field of template.fields) {
		const value = getMetaValue(metadata, field.key);
		if (value === undefined || value === null || value === "") continue;

		switch (field.tagType) {
			case "title":
				if (isNonEmptyString(value)) {
					tags.push(["title", value]);
				}
				break;
			case "topics":
				normalizeTopics(value as string | string[]).forEach((topic) => tags.push(["t", topic]));
				break;
			case "text": {
				const tagName = field.nostrTag ?? field.key;
				if (Array.isArray(value)) {
					tags.push([tagName, ...value.map((v) => String(v))]);
				} else {
					tags.push([tagName, String(value)]);
				}
				break;
			}
		}
	}

	// Legacy 30040 special tags not in field definitions
	if (meta.derivative_author && isNonEmptyString(meta.derivative_author)) {
		tags.push(["p", meta.derivative_author]);
	}
	if (meta.derivative_event && isNonEmptyString(meta.derivative_event)) {
		const eTag: string[] = ["E", meta.derivative_event];
		if (isNonEmptyString(meta.derivative_relay)) eTag.push(meta.derivative_relay);
		if (isNonEmptyString(meta.derivative_pubkey)) eTag.push(meta.derivative_pubkey);
		tags.push(eTag);
	}
	if (Array.isArray(meta.additional_tags)) {
		meta.additional_tags.forEach((tag) => {
			if (Array.isArray(tag) && tag.length > 0) {
				tags.push(tag.map((val) => String(val ?? "")));
			}
		});
	}

	if (template.useNKBIP08 && template.kind === 30040 && !childEvents) {
		addNKBIP08TagsTo30040(tags, metadata as Parameters<typeof addNKBIP08TagsTo30040>[1], true, false, undefined, metadata as Parameters<typeof addNKBIP08TagsTo30040>[5]);
	}
	if (template.useNKBIP08 && template.kind === 30041) {
		addNKBIP08TagsTo30041(tags, metadata as Parameters<typeof addNKBIP08TagsTo30041>[1]);
	}

	if (childEvents) {
		childEvents.forEach((child) => {
			const aTag: string[] = ["a", `${child.kind}:${pubkey}:${child.dTag}`];
			if (child.eventId) {
				aTag.push("", String(child.eventId));
			}
			tags.push(aTag);
		});
	}

	return tags;
}
