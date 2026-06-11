/**
 * 🛠️ SEO Task Routes — Agency-scoped
 */

const {
    autoGenerateTasks,
    generateTaskAssistant,
    getTasks,
    createTask,
    updateTask,
    deleteTask,
} = require('../services/taskService');
const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:tasks');

async function taskRoutes(fastify, options) {
    const { db } = options;

    // ─── List Tasks for a Project ───
    fastify.get('/api/projects/:projectId/tasks', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { projectId } = request.params;

        try {
            const tasks = await getTasks(projectId, ctx.userId);
            return { success: true, tasks, generatedCount: tasks.length };
        } catch (err) {
            log.error({ err: err.message, projectId }, 'Failed to fetch tasks');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Auto-generate Tasks using AI ───
    fastify.post('/api/projects/:projectId/tasks/auto-generate', {
        schema: {
            body: {
                type: 'object',
                additionalProperties: true,
            },
        },
        handler: async (request, reply) => {
            const ctx = await getAgencyContext(request, db);
            if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

            const { projectId } = request.params;

            try {
                const tasks = await autoGenerateTasks(projectId, ctx.userId);
                return { success: true, tasks, generatedCount: tasks.length };
            } catch (err) {
                log.error({ err: err.message, projectId }, 'Failed to auto-generate tasks');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Create a Manual Task ───
    fastify.post('/api/tasks', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const body = request.body || {};

        if (!body.title || !body.projectId) {
            return reply.code(400).send({ error: 'title and projectId are required' });
        }

        try {
            const task = await createTask(body, ctx.userId);
            return { success: true, task };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to create task');
            return reply.code(500).send({ error: err.message });
        }
    });


    // ─── Task AI Assistant ───
    fastify.post('/api/tasks/:id/ai-assist', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    mode: { type: 'string', default: 'full' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await getAgencyContext(request, db);
            if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

            const { id } = request.params;
            const { mode = 'full' } = request.body || {};

            try {
                const assistant = await generateTaskAssistant(id, ctx.userId, mode);
                return { success: true, assistant };
            } catch (err) {
                log.error({ err: err.message, taskId: id }, 'Failed to generate task AI assistant');
                return reply.code(err.message.includes('not found') ? 404 : 500).send({ error: err.message });
            }
        },
    });

    // ─── Update an Existing Task ───
    fastify.put('/api/tasks/:id', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const body = request.body || {};

        try {
            const task = await updateTask(id, body, ctx.userId);
            if (!task) {
                return reply.code(404).send({ error: 'Task not found or access denied' });
            }
            return { success: true, task };
        } catch (err) {
            log.error({ err: err.message, taskId: id }, 'Failed to update task');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete a Task ───
    fastify.delete('/api/tasks/:id', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;

        try {
            const task = await deleteTask(id, ctx.userId);
            if (!task) {
                return reply.code(404).send({ error: 'Task not found or access denied' });
            }
            return { success: true };
        } catch (err) {
            log.error({ err: err.message, taskId: id }, 'Failed to delete task');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = taskRoutes;
