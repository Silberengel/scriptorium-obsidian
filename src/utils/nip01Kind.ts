export type Nip01KindClass = "regular" | "replaceable" | "ephemeral" | "addressable";

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
