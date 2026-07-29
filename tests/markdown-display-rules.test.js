import { describe, expect, it } from "vitest";
import {
    analyzeMarkdownLine,
    continueListLine,
    indentListLine,
    parseListItem
} from "../src/domain/pkm/markdown-display-rules.js";

describe("markdown display rules", () => {
    it.each([
        ["# 제목", 1],
        ["## 대주제", 2],
        ["### 소주제", 3],
        ["#### 기본 본문", 0]
    ])("classifies heading level for %s", (line, level) => {
        expect(analyzeMarkdownLine(line).headingLevel).toBe(level);
    });

    it("keeps highlight regular unless it overlaps strong emphasis", () => {
        expect(analyzeMarkdownLine("/하이라이트/").marks).toEqual([
            { from: 1, to: 6, type: "highlight" }
        ]);
        expect(analyzeMarkdownLine("**/강조 하이라이트/**").marks).toEqual([
            { from: 2, to: 3, type: "strong" },
            { from: 3, to: 12, type: "combined" },
            { from: 12, to: 13, type: "strong" }
        ]);
    });

    it.each([
        "/**일반 텍스트/**/",
        "**/일반 텍스트/**",
        "/**일반/ 텍스트**",
        "**/일반/ 텍스트**",
        "**/일반** 텍스트/",
        "/**일반** 텍스트/"
    ])("finds a combined segment in %s", line => {
        expect(analyzeMarkdownLine(line).marks.some(mark => mark.type === "combined")).toBe(true);
    });

    it("does not treat URL slashes as highlights", () => {
        expect(analyzeMarkdownLine("https://example.com/path").marks).toEqual([]);
    });
});

describe("markdown list rules", () => {
    it.each(["- 항목", "* 항목", "+ 항목", "✓ 완료", "★ 중요", "→ 다음", "1. 첫째"])("recognizes %s", line => {
        expect(parseListItem(line)).not.toBeNull();
    });

    it("continues and exits list items", () => {
        expect(continueListLine("2. 둘째")).toEqual({ exit: false, prefix: "3. " });
        expect(continueListLine("    가. 세부")).toEqual({ exit: false, prefix: "    나. " });
        expect(continueListLine("- ")).toEqual({ exit: true, prefix: "" });
    });

    it("applies the mixed 1. to 가. to 1) to ◦ hierarchy", () => {
        const level1 = indentListLine("1. 항목", 1);
        const level2 = indentListLine(level1, 1);
        const level3 = indentListLine(level2, 1);
        expect(level1).toBe("    가. 항목");
        expect(level2).toBe("        1) 항목");
        expect(level3).toBe("            ◦ 항목");
        expect(indentListLine(level3, -1)).toBe("        1) 항목");
    });
});
