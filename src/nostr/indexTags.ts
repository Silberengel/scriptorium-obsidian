import { normalizeDTag } from "./eventBuilder";

/**
 * Add T (title) and N (author) index tags normalized like d-tags.
 */
export function addTitleAuthorIndexTags(
	tags: string[][],
	title?: string,
	author?: string
): void {
	if (title?.trim()) {
		const normalized = normalizeDTag(title);
		if (normalized) {
			tags.push(["T", normalized]);
		}
	}
	if (author?.trim()) {
		const normalized = normalizeDTag(author);
		if (normalized) {
			tags.push(["N", normalized]);
		}
	}
}
