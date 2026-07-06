import { describe, expect, it } from 'vitest';
import { isCommentOnlyMemo, normalizeMemoInput } from '../src/features/memos/model.js';

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
