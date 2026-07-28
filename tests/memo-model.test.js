import { describe, expect, it } from 'vitest';
import { countCommentLines, countLineBreaks, getCommentDisplayMode, getMemoPreviewKind, hasLongComment, isCommentOnlyMemo, normalizeMemoInput } from '../src/domain/memos/memo-policy.js';

describe('normalizeMemoInput', () => {
    it('requires a title', () => {
        expect(normalizeMemoInput({ text: ' ', comment: 'memo' }).ok).toBe(false);
    });

    it.each([
        { url: 'example.com' },
        { hasImage: true },
        { comment: 'memo' }
    ])('accepts one content source: %o', input => {
        expect(normalizeMemoInput({ text: 'title', ...input }).ok).toBe(true);
    });

    it('rejects an empty memo', () => {
        expect(normalizeMemoInput({ text: 'title', url: '', comment: '  ' }).ok).toBe(false);
    });

    it('preserves the original comment including line breaks', () => {
        const comment = '  first line\nsecond line\n';
        const result = normalizeMemoInput({ text: 'title', comment });
        expect(result.value.comment).toBe(comment);
    });

    it('rejects non-http URL schemes', () => {
        const result = normalizeMemoInput({ text: 'title', url: 'javascript:alert(1)' });
        expect(result.ok).toBe(false);
    });
});

describe('isCommentOnlyMemo', () => {
    it('detects comment-only items', () => {
        expect(isCommentOnlyMemo({ comment: 'memo', url: '', imageId: null })).toBe(true);
    });

    it('keeps link and image items in card mode', () => {
        expect(isCommentOnlyMemo({ comment: 'memo', url: 'https://example.com' })).toBe(false);
        expect(isCommentOnlyMemo({ comment: 'memo', imageId: 'image_1' })).toBe(false);
    });
});

describe('comment display and preview policy', () => {
    it('uses three logical lines as the collapsed threshold', () => {
        expect(hasLongComment('first\nsecond')).toBe(false);
        expect(hasLongComment('first\nsecond\nthird')).toBe(true);
    });

    it('normalizes LF, CRLF and explicit blank lines', () => {
        expect(countLineBreaks('a\nb\r\nc')).toBe(2);
        expect(countCommentLines('a\r\n\r\nc')).toBe(3);
        expect(hasLongComment('a\r\nb\r\nc')).toBe(true);
    });

    it.each([
        [{ comment: 'one line' }, 'inline'],
        [{ comment: 'first\nsecond', url: 'https://example.com' }, 'inline'],
        [{ comment: 'first\nsecond\nthird', url: 'https://example.com' }, 'accordion'],
        [{ imageId: 'image_1', comment: 'first\nsecond\nthird' }, 'modal-only'],
        [{ imageId: 'image_1', comment: 'one line' }, 'inline'],
        [{ comment: '' }, 'none']
    ])('classifies card comment display', (item, expected) => {
        expect(getCommentDisplayMode(item)).toBe(expected);
    });

    it.each([
        [{ comment: 'first\nsecond\nthird' }, 'text'],
        [{ imageId: 'image_1' }, 'image'],
        [{ imageId: 'image_1', comment: 'one line' }, 'combined'],
        [{ imageId: 'image_1', comment: 'first\nsecond\nthird' }, 'combined'],
        [{ comment: 'short' }, 'none']
    ])('classifies preview content', (item, expected) => {
        expect(getMemoPreviewKind(item)).toBe(expected);
    });
});