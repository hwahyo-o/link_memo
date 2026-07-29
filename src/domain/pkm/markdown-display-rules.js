const MIXED_MARKERS = ["ordered", "korean", "parenthesized", "circle"];
const KOREAN_ORDINALS = [..."가나다라마바사아자차카타파하"];

function isEscaped(text, index) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
}

function pairToken(text, token) {
    const ranges = [];
    let start = -1;
    for (let index = 0; index <= text.length - token.length; index += 1) {
        if (!text.startsWith(token, index) || isEscaped(text, index)) continue;
        if (start < 0) start = index + token.length;
        else {
            if (index > start) ranges.push({ from: start, to: index });
            start = -1;
        }
        index += token.length - 1;
    }
    return ranges;
}

function urlRanges(text) {
    return [...text.matchAll(/https?:\/\/\S+/giu)].map(match => ({ from: match.index, to: match.index + match[0].length }));
}

function pairHighlights(text) {
    const excluded = urlRanges(text);
    const insideUrl = index => excluded.some(range => index >= range.from && index < range.to);
    const ranges = [];
    let start = -1;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== "/" || isEscaped(text, index) || insideUrl(index)) continue;
        const previous = text[index - 1] || "";
        const next = text[index + 1] || "";
        if (start < 0) {
            if ((!previous || /[\s*([{>]/u.test(previous)) && next && !/[\s/]/u.test(next)) start = index + 1;
            continue;
        }
        if (previous && !/\s/u.test(previous) && (!next || /[\s*.,!?;:\])}]/u.test(next))) {
            if (index > start) ranges.push({ from: start, to: index });
            start = -1;
        }
    }
    return ranges;
}

function mergeMarkRanges(strongRanges, highlightRanges) {
    const boundaries = [...new Set([
        ...strongRanges.flatMap(range => [range.from, range.to]),
        ...highlightRanges.flatMap(range => [range.from, range.to])
    ])].sort((left, right) => left - right);
    const marks = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const from = boundaries[index];
        const to = boundaries[index + 1];
        const strong = strongRanges.some(range => from >= range.from && to <= range.to);
        const highlight = highlightRanges.some(range => from >= range.from && to <= range.to);
        if (!strong && !highlight) continue;
        const type = strong && highlight ? "combined" : strong ? "strong" : "highlight";
        const previous = marks.at(-1);
        if (previous?.type === type && previous.to === from) previous.to = to;
        else marks.push({ from, to, type });
    }
    return marks;
}

function indentationWidth(indent) {
    return [...indent].reduce((width, character) => width + (character === "\t" ? 4 : 1), 0);
}

function dingbatMarker(text) {
    const [first = ""] = typeof Intl?.Segmenter === "function"
        ? [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text)].map(part => part.segment)
        : Array.from(text);
    return first && /^[\p{Extended_Pictographic}\p{S}✓✔☑★☆→←↑↓➜➤◆◇■□●○◦▪▫※]$/u.test(first) ? first : null;
}

export function parseListItem(line) {
    const indent = line.match(/^[\t ]*/u)?.[0] || "";
    const body = line.slice(indent.length);
    const standard = body.match(/^([-*+]|\d+\.|[가-힣]\.|\d+\)|◦)\s+/u);
    let marker = standard?.[1] || null;
    let markerWidth = standard?.[0].length || 0;
    if (!marker) {
        marker = dingbatMarker(body);
        if (!marker || !/^\s/u.test(body.slice(marker.length))) return null;
        markerWidth = marker.length + (body.slice(marker.length).match(/^\s+/u)?.[0].length || 0);
    }
    const kind = /^\d+\.$/u.test(marker) ? "ordered"
        : /^[가-힣]\.$/u.test(marker) ? "korean"
            : /^\d+\)$/u.test(marker) ? "parenthesized"
                : marker === "◦" ? "circle"
                    : "bullet";
    return {
        indent,
        level: Math.floor(indentationWidth(indent) / 4),
        marker,
        kind,
        content: body.slice(markerWidth),
        contentFrom: indent.length + markerWidth
    };
}

export function analyzeMarkdownLine(text) {
    const heading = text.match(/^\s{0,3}(#{1,3})\s+/u);
    return {
        headingLevel: heading?.[1].length || 0,
        list: parseListItem(text),
        marks: mergeMarkRanges(pairToken(text, "**"), pairHighlights(text))
    };
}

function markerForLevel(level) {
    if (level <= 0) return "1.";
    if (level === 1) return "가.";
    if (level === 2) return "1)";
    return "◦";
}

export function continueListLine(line) {
    const item = parseListItem(line);
    if (!item) return null;
    if (!item.content.trim()) return { exit: true, prefix: "" };
    let marker = item.marker;
    if (item.kind === "ordered") marker = `${Number.parseInt(item.marker, 10) + 1}.`;
    if (item.kind === "parenthesized") marker = `${Number.parseInt(item.marker, 10) + 1})`;
    if (item.kind === "korean") {
        const current = KOREAN_ORDINALS.indexOf(item.marker[0]);
        marker = `${KOREAN_ORDINALS[Math.min(current + 1, KOREAN_ORDINALS.length - 1)] || item.marker[0]}.`;
    }
    return { exit: false, prefix: `${item.indent}${marker} ` };
}

export function indentListLine(line, direction) {
    const item = parseListItem(line);
    if (!item) return line;
    const nextLevel = Math.max(0, item.level + (direction > 0 ? 1 : -1));
    const indent = " ".repeat(nextLevel * 4);
    const marker = MIXED_MARKERS.includes(item.kind) ? markerForLevel(nextLevel) : item.marker;
    return `${indent}${marker} ${item.content}`;
}
