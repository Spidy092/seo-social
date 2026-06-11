// Mock logger
vi.mock('../../src/utils/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

const aiHelper = require('../../src/utils/aiHelper');
const mockResilientLlmRequest = vi.fn();
aiHelper.resilientLlmRequest = mockResilientLlmRequest;

const { humanizeContent } = require('../../src/services/humanizerService');

describe('humanizerService', () => {
    beforeEach(() => {
        mockResilientLlmRequest.mockReset();
    });

    it('passes systemPrompt and user prompt separately to resilientLlmRequest', async () => {
        const mockModelResponse = JSON.stringify({
            refinedText: "This is a natural human rewrite of the text.",
            summary: "Made it sound more conversational.",
            changes: ["Varied sentence length", "Used contractions"],
            alternatives: [
                { label: "warmer", text: "Warm friendly rewrite" },
                { label: "sharper", text: "Sharp rewrite" }
            ]
        });

        mockResilientLlmRequest.mockResolvedValue(mockModelResponse);

        const result = await humanizeContent({
            text: "This is some text that needs to be humanized. It should not look like AI.",
            tone: "professional",
            audience: "general",
            brandVoice: "conversational",
            preserveKeywords: ["AI"],
            maxChange: 0.5,
            mode: "general"
        });

        expect(mockResilientLlmRequest).toHaveBeenCalled();
        const callArgs = mockResilientLlmRequest.mock.calls[0][0];
        
        expect(callArgs).toHaveProperty('systemPrompt');
        expect(callArgs).toHaveProperty('prompt');
        expect(callArgs.systemPrompt).toContain('Naturalness + detector-risk reduction target');
        expect(callArgs.prompt).toContain('This is some text that needs to be humanized');
        
        expect(result.refinedText).toBe("This is a natural human rewrite of the text.");
    });

    it('includes the writing sample in the prompt when provided', async () => {
        const mockModelResponse = JSON.stringify({
            refinedText: "This is a custom calibrated human rewrite.",
            summary: "Calibrated to sample voice.",
            changes: ["Matched style"],
            alternatives: []
        });

        mockResilientLlmRequest.mockResolvedValue(mockModelResponse);

        await humanizeContent({
            text: "This is some input text.",
            tone: "natural",
            sample: "Here is my custom writing style. I use lots of short sentences! And occasional exclamation marks."
        });

        expect(mockResilientLlmRequest).toHaveBeenCalled();
        const callArgs = mockResilientLlmRequest.mock.calls[0][0];
        expect(callArgs.systemPrompt).toContain('Here is my custom writing style');
        expect(callArgs.systemPrompt).toContain('I use lots of short sentences');
    });
});
