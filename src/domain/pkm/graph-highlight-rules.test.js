import { describe, expect, it } from "vitest";
import { classifyGraphMatches } from "./graph-highlight-rules.js";

describe("three-tier graph highlights", () => {
    it("includes inbound and outbound one-hop context", () => {
        const result = classifyGraphMatches(
            [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
            [{ source: "a", target: "b" }, { source: "c", target: "a" }],
            ["a"]
        );
        expect([...result.direct]).toEqual(["a"]);
        expect([...result.context].sort()).toEqual(["b", "c"]);
        expect([...result.dimmed]).toEqual(["d"]);
    });
});
