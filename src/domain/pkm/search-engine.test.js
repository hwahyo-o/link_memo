import { describe, expect, it } from "vitest";
import { searchMetadata } from "./search-engine.js";

const entries = [
    { path: "one.md", title: "지식 그래프", content: "검색 엔진", tags: ["PKM"], comments: [], links: [] },
    { path: "two.md", title: "일일 기록", content: "그래프 관찰", tags: [], comments: ["검색 제외"], links: [] }
];

describe("PKM search engine", () => {
    it("requires every token in AND mode", () => {
        expect(searchMetadata(entries, "지식 검색", "AND").map(item => item.path)).toEqual(["one.md"]);
    });

    it("accepts any token in OR mode across metadata fields", () => {
        expect(searchMetadata(entries, "PKM 기록", "OR").map(item => item.path)).toEqual(["one.md", "two.md"]);
    });
});
