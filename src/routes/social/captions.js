const { generateCaptions } = require('../../services/openrouter');

module.exports = async function (fastify, options) {
    fastify.post('/social/captions/generate', async (request, reply) => {
        const { caption, platforms } = request.body;
      
        if (!caption) {
            return reply.status(400).send({ error: 'Base caption is required.' });
        }
      
        // Fastify formbody might parse platforms as a single string if only one is selected
        let parsedPlatforms = platforms;
        if (typeof platforms === 'string') {
            parsedPlatforms = [platforms];
        } else if (!platforms) {
            parsedPlatforms = [];
        }

        if (parsedPlatforms.length === 0) {
            return reply.status(400).send({ error: 'At least one platform must be selected.' });
        }
      
        try {
            const captions = await generateCaptions(caption, parsedPlatforms);
            return { captions };
        } catch (err) {
            request.log.error(err, '[captions.js] Error generating captions');
            return reply.status(503).send({ error: err.message || 'Caption generation failed' });
        }
    });
};
