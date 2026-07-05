export type Nip01KindClass = "regular" | "replaceable" | "ephemeral" | "addressable";

/** Human-readable summary of valid NIP-01 kind ranges for error messages. */
export const NIP01_KIND_RANGE_HINT =
	"NIP-01 kinds are integers 1–65535: regular (1–2, 4–999, 1000–9999, 40000–65535), " +
	"replaceable (3, 10000–19999), ephemeral (20000–29999), addressable (30000–39999)";

export function getNip01KindClass(kind: number): Nip01KindClass {
	if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) {
		return "replaceable";
	}
	if (kind >= 20000 && kind < 30000) {
		return "ephemeral";
	}
	if (kind >= 30000 && kind < 40000) {
		return "addressable";
	}
	if (kind === 1 || kind === 2 || (kind >= 4 && kind < 45) || (kind >= 1000 && kind < 10000)) {
		return "regular";
	}
	return "regular";
}

export function requiresDTag(kind: number): boolean {
	return getNip01KindClass(kind) === "addressable";
}

export function requiresPublishedAt(kind: number): boolean {
	const cls = getNip01KindClass(kind);
	return cls === "replaceable" || cls === "addressable";
}

/** Returns an error message when kind is invalid for templates, or null if valid. */
export function validateNip01Kind(kind: unknown): string | null {
	if (kind === undefined || kind === null) {
		return "kind is required";
	}
	if (typeof kind !== "number") {
		if (typeof kind === "string") {
			return `kind must be an integer, not a string ("${kind}"). Use a bare number like 30023. ${NIP01_KIND_RANGE_HINT}`;
		}
		return `kind must be an integer (NIP-01 event kind). ${NIP01_KIND_RANGE_HINT}`;
	}
	if (!Number.isInteger(kind)) {
		return `kind must be a whole number, got ${kind}. ${NIP01_KIND_RANGE_HINT}`;
	}
	if (kind === 0) {
		return "kind 0 is reserved for metadata events and cannot be used in templates";
	}
	if (kind < 1 || kind > 65535) {
		return `kind must be between 1 and 65535 (NIP-01 unsigned 16-bit), got ${kind}`;
	}
	return null;
}
