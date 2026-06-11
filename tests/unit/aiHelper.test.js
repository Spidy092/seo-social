const { extractJson } = require('../../src/utils/aiHelper');

describe('extractJson', () => {
    it('parses plain JSON object', () => {
        const result = extractJson('{"key": "value"}');
        expect(result).toEqual({ key: 'value' });
    });

    it('parses plain JSON array', () => {
        const result = extractJson('[1, 2, 3]');
        expect(result).toEqual([1, 2, 3]);
    });

    it('extracts JSON from fenced code block', () => {
        const input = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
        const result = extractJson(input);
        expect(result).toEqual({ key: 'value' });
    });

    it('extracts JSON from text with embedded object', () => {
        const input = 'The analysis shows {"score": 85, "grade": "A"} for this domain.';
        const result = extractJson(input);
        expect(result).toEqual({ score: 85, grade: 'A' });
    });

    it('extracts JSON array from text', () => {
        const input = 'Results: ["keyword1", "keyword2"] end.';
        const result = extractJson(input);
        expect(result).toEqual(['keyword1', 'keyword2']);
    });

    it('throws on no JSON found', () => {
        expect(() => extractJson('no json here')).toThrow('No JSON object or array found');
    });

    it('throws on empty input', () => {
        expect(() => extractJson('')).toThrow();
    });

    it('handles nested JSON', () => {
        const obj = { a: { b: [1, 2, { c: 3 }] } };
        const result = extractJson(JSON.stringify(obj));
        expect(result).toEqual(obj);
    });
});
