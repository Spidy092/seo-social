/**
 * 🎯 SEO Tasks Prioritization and Kanban Board Javascript
 */

// ─── State ───
let activeProjectId = null;
let activeClientId = null;
let projectTasks = [];
const taskAiCache = new Map();

// ─── Initialize ───
function initTasksPage() {
    loadClientsForTasks();
    setupTaskEventListeners();
    setupDragAndDrop();
}

// ─── Event Listeners Setup ───
function setupTaskEventListeners() {
    const clientSelect = document.getElementById('taskClientSelect');
    const projectSelect = document.getElementById('taskProjectSelect');
    const autoGenBtn = document.getElementById('autoGenTasksBtn');
    const addCustomBtn = document.getElementById('addCustomTaskBtn');

    if (clientSelect) {
        clientSelect.addEventListener('change', async () => {
            activeClientId = clientSelect.value;
            activeProjectId = null;
            projectSelect.innerHTML = '<option value="">Choose a project...</option>';
            projectSelect.disabled = true;
            autoGenBtn.disabled = true;
            addCustomBtn.disabled = true;
            clearBoard();

            if (activeClientId) {
                await loadProjectsForTasks(activeClientId);
            }
        });
    }

    if (projectSelect) {
        projectSelect.addEventListener('change', async () => {
            activeProjectId = projectSelect.value;
            if (activeProjectId) {
                autoGenBtn.disabled = false;
                addCustomBtn.disabled = false;
                await loadTasksForProject(activeProjectId);
            } else {
                autoGenBtn.disabled = true;
                addCustomBtn.disabled = true;
                clearBoard();
            }
        });
    }

    if (autoGenBtn) {
        autoGenBtn.addEventListener('click', async () => {
            if (!activeProjectId) return;
            
            showLoading();
            const originalText = autoGenBtn.innerHTML;
            autoGenBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing & Generating...';
            autoGenBtn.disabled = true;

            try {
                const res = await fetch(`/api/projects/${activeProjectId}/tasks/auto-generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                
                const data = await res.json();
                hideLoading();
                
                if (data.success) {
                    showSuccess(`Successfully generated ${data.generatedCount || 0} prioritized tasks with AI!`);
                    await loadTasksForProject(activeProjectId);
                } else {
                    showError(data.error || 'AI generation failed');
                }
            } catch (err) {
                hideLoading();
                console.error(err);
                showError('Server error generating tasks.');
            } finally {
                autoGenBtn.innerHTML = originalText;
                autoGenBtn.disabled = false;
            }
        });
    }

    if (addCustomBtn) {
        addCustomBtn.addEventListener('click', () => {
            openTaskModal();
        });
    }
}

// ─── Drag and Drop ───
function setupDragAndDrop() {
    const columns = document.querySelectorAll('.task-column-container');
    
    columns.forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            col.classList.add('drag-over');
        });

        col.addEventListener('dragleave', () => {
            col.classList.remove('drag-over');
        });

        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            
            const taskId = e.dataTransfer.getData('text/plain');
            const targetStatus = col.dataset.status;
            
            if (!taskId || !targetStatus) return;

            // Optimistic updates
            const task = projectTasks.find(t => t.id === taskId);
            if (task && task.status !== targetStatus) {
                const oldStatus = task.status;
                task.status = targetStatus;
                renderBoardTasks(); // Re-render immediately
                
                try {
                    const res = await fetch(`/api/tasks/${taskId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: targetStatus })
                    });
                    
                    const data = await res.json();
                    if (!data.success) {
                        // Rollback
                        task.status = oldStatus;
                        renderBoardTasks();
                        showError(data.error || 'Failed to update task status');
                    } else {
                        // Refresh metrics counters
                        calculateStats();
                    }
                } catch (err) {
                    task.status = oldStatus;
                    renderBoardTasks();
                    showError('Network error updating task.');
                }
            }
        });
    });
}

// ─── Load Clients ───
async function loadClientsForTasks() {
    try {
        const res = await fetch('/api/clients');
        const { clients = [] } = await res.json();
        const select = document.getElementById('taskClientSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">Choose a client...</option>';
        clients.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.name}${c.website_url ? ' — ' + c.website_url : ''}`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Error loading clients for tasks:', err);
    }
}

// ─── Load Projects ───
async function loadProjectsForTasks(clientId) {
    try {
        const res = await fetch(`/api/clients/${clientId}/projects`);
        const { projects = [] } = await res.json();
        const select = document.getElementById('taskProjectSelect');
        if (!select) return;

        select.innerHTML = '<option value="">Choose a project...</option>';
        projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
        select.disabled = false;
    } catch (err) {
        console.error('Error loading projects for tasks:', err);
    }
}

// ─── Load Tasks ───
async function loadTasksForProject(projectId) {
    try {
        showLoading();
        const res = await fetch(`/api/projects/${projectId}/tasks`);
        const data = await res.json();
        hideLoading();

        if (data.success) {
            projectTasks = data.tasks || [];
            renderBoardTasks();
        } else {
            showError(data.error || 'Could not load tasks');
            clearBoard();
        }
    } catch (err) {
        hideLoading();
        console.error('Error loading project tasks:', err);
        showError('Server error fetching tasks.');
        clearBoard();
    }
}

// ─── Render Tasks ───
function renderBoardTasks() {
    const colTodo = document.getElementById('columnTodo');
    const colInProgress = document.getElementById('columnInProgress');
    const colCompleted = document.getElementById('columnCompleted');

    if (!colTodo || !colInProgress || !colCompleted) return;

    colTodo.innerHTML = '';
    colInProgress.innerHTML = '';
    colCompleted.innerHTML = '';

    projectTasks.forEach(task => {
        const card = createTaskCard(task);
        if (task.status === 'todo') {
            colTodo.appendChild(card);
        } else if (task.status === 'in_progress') {
            colInProgress.appendChild(card);
        } else if (task.status === 'completed') {
            colCompleted.appendChild(card);
        }
    });

    calculateStats();
}

// ─── Create Single Task Card ───
function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = `task-card priority-${task.priority}`;
    card.draggable = true;
    card.dataset.id = task.id;

    // Drag start handler
    card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', task.id);
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });

    // Icon mapping for categories
    const icons = {
        'on-page': 'fa-file-invoice',
        'technical': 'fa-spider',
        'content': 'fa-pen-nib',
        'link-building': 'fa-link',
        'local-seo': 'fa-map-marker-alt',
        'general': 'fa-tasks'
    };
    const catIcon = icons[task.category] || 'fa-tasks';
    const prioLabel = task.priority.toUpperCase();

    // Setup action buttons for status movement
    let moveStatusBtn = '';
    if (task.status === 'todo') {
        moveStatusBtn = `<button class="task-action-btn btn-status-move" title="Start Task" onclick="event.stopPropagation(); changeTaskStatus('${task.id}', 'in_progress')"><i class="fas fa-play"></i></button>`;
    } else if (task.status === 'in_progress') {
        moveStatusBtn = `<button class="task-action-btn btn-status-move" title="Complete Task" onclick="event.stopPropagation(); changeTaskStatus('${task.id}', 'completed')"><i class="fas fa-check"></i></button>`;
    } else if (task.status === 'completed') {
        moveStatusBtn = `<button class="task-action-btn btn-status-move" title="Reopen Task" onclick="event.stopPropagation(); changeTaskStatus('${task.id}', 'todo')"><i class="fas fa-undo"></i></button>`;
    }

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <h5 class="task-card-title">${escapeHtml(task.title)}</h5>
            <button class="task-action-btn btn-delete" style="position: absolute; top: 12px; right: 12px;" title="Delete Task" onclick="event.stopPropagation(); deleteTask('${task.id}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <p class="task-card-desc">${escapeHtml(task.description || '')}</p>
        ${renderSavedTaskAiNotes(task)}
        <div class="task-badges">
            <span class="task-badge task-badge-cat">
                <i class="fas ${catIcon}"></i> ${escapeHtml(task.category)}
            </span>
            <span class="task-badge task-badge-prio-${task.priority}">
                ${prioLabel}
            </span>
            <span class="task-badge task-badge-impact-${task.impact}">
                Impact: ${escapeHtml(task.impact)}
            </span>
            <span class="task-badge task-badge-effort-${task.effort}">
                Effort: ${escapeHtml(task.effort)}
            </span>
        </div>
        <div class="task-card-footer">
            <span class="task-card-date">${formatTaskDate(task.created_at)}</span>
            <div class="task-card-actions">
                <button class="task-action-btn btn-ai-assist" title="AI Assistant" onclick="event.stopPropagation(); openTaskAiAssistant('${task.id}')">
                    <i class="fas fa-wand-magic-sparkles"></i>
                </button>
                <button class="task-action-btn" title="Edit Task" onclick="event.stopPropagation(); editTask('${task.id}')">
                    <i class="fas fa-edit"></i>
                </button>
                ${moveStatusBtn}
            </div>
        </div>
    `;

    return card;
}

// ─── Change Task Status (button action) ───
async function changeTaskStatus(id, newStatus) {
    const task = projectTasks.find(t => t.id === id);
    if (!task) return;
    
    const oldStatus = task.status;
    task.status = newStatus;
    renderBoardTasks();

    try {
        const res = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (!data.success) {
            task.status = oldStatus;
            renderBoardTasks();
            showError(data.error || 'Failed to update task status');
        } else {
            calculateStats();
        }
    } catch (err) {
        task.status = oldStatus;
        renderBoardTasks();
        showError('Network error updating task status');
    }
}

// ─── Delete Task ───
async function deleteTask(id) {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
        showLoading();
        const res = await fetch(`/api/tasks/${id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        hideLoading();

        if (data.success) {
            showSuccess('Task deleted successfully');
            projectTasks = projectTasks.filter(t => t.id !== id);
            renderBoardTasks();
        } else {
            showError(data.error || 'Could not delete task');
        }
    } catch (err) {
        hideLoading();
        console.error(err);
        showError('Error deleting task');
    }
}

// ─── Add/Edit Task Modal Handling ───
function openTaskModal(task = null) {
    const modal = document.getElementById('taskModal');
    const form = document.getElementById('taskForm');
    const titleEl = document.getElementById('taskModalTitle');
    
    if (!modal || !form) return;

    // Reset form
    form.reset();
    document.getElementById('taskFormId').value = '';

    if (task) {
        titleEl.textContent = '✏️ Edit Task';
        document.getElementById('taskFormId').value = task.id;
        document.getElementById('taskFormTitle').value = task.title;
        document.getElementById('taskFormDesc').value = task.description || '';
        document.getElementById('taskFormCategory').value = task.category;
        document.getElementById('taskFormPriority').value = task.priority;
        document.getElementById('taskFormImpact').value = task.impact;
        document.getElementById('taskFormEffort').value = task.effort;
        document.getElementById('taskFormStatus').value = task.status;
    } else {
        titleEl.textContent = '➕ Add Custom Task';
        document.getElementById('taskFormStatus').value = 'todo';
    }

    modal.classList.add('active');
}

function closeTaskModal() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.classList.remove('active');
}

async function saveTask(event) {
    event.preventDefault();
    if (!activeProjectId) return;

    const id = document.getElementById('taskFormId').value;
    const taskData = {
        title: document.getElementById('taskFormTitle').value.trim(),
        description: document.getElementById('taskFormDesc').value.trim(),
        category: document.getElementById('taskFormCategory').value,
        priority: document.getElementById('taskFormPriority').value,
        impact: document.getElementById('taskFormImpact').value,
        effort: document.getElementById('taskFormEffort').value,
        status: document.getElementById('taskFormStatus').value
    };

    const isEdit = !!id;
    const url = isEdit ? `/api/tasks/${id}` : '/api/tasks';
    const method = isEdit ? 'PUT' : 'POST';

    if (!isEdit) {
        taskData.projectId = activeProjectId;
    }

    try {
        showLoading();
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData)
        });
        const data = await res.json();
        hideLoading();

        if (data.success) {
            showSuccess(isEdit ? 'Task updated' : 'Task added successfully');
            closeTaskModal();
            await loadTasksForProject(activeProjectId);
        } else {
            showError(data.error || 'Failed to save task');
        }
    } catch (err) {
        hideLoading();
        console.error(err);
        showError('Network error saving task');
    }
}

function editTask(id) {
    const task = projectTasks.find(t => t.id === id);
    if (task) {
        openTaskModal(task);
    }
}

// ─── Stats Calculator ───
function calculateStats() {
    const total = projectTasks.length;
    const critical = projectTasks.filter(t => t.priority === 'critical').length;
    const todo = projectTasks.filter(t => t.status === 'todo').length;
    const inProgress = projectTasks.filter(t => t.status === 'in_progress').length;
    const completed = projectTasks.filter(t => t.status === 'completed').length;

    document.getElementById('statTotalTasks').textContent = total;
    document.getElementById('statCriticalTasks').textContent = critical;
    document.getElementById('statInProgressTasks').textContent = inProgress;
    document.getElementById('statCompletedTasks').textContent = completed;

    document.getElementById('countTodo').textContent = todo;
    document.getElementById('countInProgress').textContent = inProgress;
    document.getElementById('countCompleted').textContent = completed;
}

// ─── Helpers ───
function clearBoard() {
    projectTasks = [];
    renderBoardTasks();
}

function formatTaskDate(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
        return '';
    }
}

function normalizeTaskAiNotes(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (err) {
            return null;
        }
    }
    return typeof value === 'object' ? value : null;
}

function renderSavedTaskAiNotes(task) {
    const notes = normalizeTaskAiNotes(task.ai_notes);
    const checklist = Array.isArray(notes?.checklist) ? notes.checklist.filter(Boolean).slice(0, 3) : [];
    const steps = Array.isArray(notes?.steps) ? notes.steps.filter(Boolean).slice(0, 2) : [];
    const items = checklist.length ? checklist : steps;
    if (!items.length && !notes?.summary) return '';

    return `
        <div class="task-saved-ai">
            <div class="task-saved-ai-title">
                <i class="fas fa-clipboard-check"></i> Saved AI checklist
            </div>
            ${notes?.summary ? `<p>${escapeHtml(notes.summary)}</p>` : ''}
            ${items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        </div>
    `;
}

// Initialize on DOMContentLoaded if DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // If the active page is already tasks, initialize
    if (window.location.hash === '#tasks') {
        initTasksPage();
    }
});

// ─── Task AI Assistant ───
async function openTaskAiAssistant(id) {
    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (!card) return;

    const existing = card.querySelector('.task-ai-panel');
    if (existing) {
        existing.remove();
        return;
    }

    const cached = taskAiCache.get(id);
    if (cached) {
        renderTaskAiAssistant(card, id, cached);
        return;
    }

    renderTaskAiLoading(card);

    try {
        const res = await fetch(`/api/tasks/${id}/ai-assist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'full' })
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || 'AI assistant failed');
        }

        taskAiCache.set(id, data.assistant);
        renderTaskAiAssistant(card, id, data.assistant);
    } catch (err) {
        console.error('Task AI assistant failed:', err);
        renderTaskAiError(card, err.message || 'Could not generate task guidance.');
    }
}

function renderTaskAiLoading(card) {
    removeTaskAiPanel(card);
    card.insertAdjacentHTML('beforeend', `
        <div class="task-ai-panel task-ai-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>Generating implementation guidance...</span>
        </div>
    `);
}

function renderTaskAiError(card, message) {
    removeTaskAiPanel(card);
    card.insertAdjacentHTML('beforeend', `
        <div class="task-ai-panel task-ai-error">
            <strong>AI assistant unavailable</strong>
            <p>${escapeHtml(message)}</p>
        </div>
    `);
}

function renderTaskAiAssistant(card, taskId, assistant) {
    removeTaskAiPanel(card);
    const steps = assistant.steps || [];
    const checklist = assistant.checklist || [];
    const risks = assistant.risks || [];

    card.insertAdjacentHTML('beforeend', `
        <div class="task-ai-panel">
            <div class="task-ai-header">
                <div><i class="fas fa-wand-magic-sparkles"></i> AI Assistant</div>
                <button class="task-action-btn" title="Close" onclick="event.stopPropagation(); this.closest('.task-ai-panel').remove();">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <p class="task-ai-summary">${escapeHtml(assistant.summary || '')}</p>
            ${renderTaskAiList('Implementation steps', steps, 'fa-list-check')}
            ${renderTaskAiList('Acceptance checklist', checklist, 'fa-square-check')}
            ${assistant.implementationNotes ? `
                <div class="task-ai-section">
                    <h6><i class="fas fa-screwdriver-wrench"></i> Notes</h6>
                    <p>${escapeHtml(assistant.implementationNotes)}</p>
                </div>
            ` : ''}
            ${renderTaskAiList('Risks', risks, 'fa-triangle-exclamation')}
            <div class="task-ai-actions">
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); copyTaskAiText('${taskId}')">
                    <i class="fas fa-copy"></i> Copy
                </button>
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); saveTaskAiChecklist('${taskId}')">
                    <i class="fas fa-clipboard-check"></i> Save checklist
                </button>
                <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); applyTaskAiUpdate('${taskId}')">
                    <i class="fas fa-pen-to-square"></i> Use suggested update
                </button>
            </div>
        </div>
    `);
}

function renderTaskAiList(title, items, icon) {
    if (!items || !items.length) return '';
    return `
        <div class="task-ai-section">
            <h6><i class="fas ${icon}"></i> ${escapeHtml(title)}</h6>
            <ol>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
        </div>
    `;
}

function removeTaskAiPanel(card) {
    card.querySelector('.task-ai-panel')?.remove();
}

async function copyTaskAiText(taskId) {
    const assistant = taskAiCache.get(taskId);
    if (!assistant) return;

    const text = [
        assistant.summary,
        '',
        'Implementation steps:',
        ...(assistant.steps || []).map((item, index) => `${index + 1}. ${item}`),
        '',
        'Acceptance checklist:',
        ...(assistant.checklist || []).map(item => `- ${item}`),
        assistant.implementationNotes ? `\nNotes:\n${assistant.implementationNotes}` : '',
        (assistant.risks || []).length ? `\nRisks:\n${assistant.risks.map(item => `- ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    try {
        await navigator.clipboard.writeText(text);
        showSuccess('AI guidance copied.');
    } catch (err) {
        showError('Could not copy AI guidance.');
    }
}

async function saveTaskAiChecklist(taskId) {
    const assistant = taskAiCache.get(taskId);
    const task = projectTasks.find(item => item.id === taskId);
    if (!assistant || !task) return;

    const aiNotes = {
        summary: assistant.summary || '',
        steps: Array.isArray(assistant.steps) ? assistant.steps.slice(0, 8) : [],
        checklist: Array.isArray(assistant.checklist) ? assistant.checklist.slice(0, 8) : [],
        implementationNotes: assistant.implementationNotes || '',
        risks: Array.isArray(assistant.risks) ? assistant.risks.slice(0, 8) : [],
        savedAt: new Date().toISOString(),
    };

    try {
        showLoading();
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ai_notes: aiNotes })
        });
        const data = await res.json();
        hideLoading();

        if (!data.success) {
            showError(data.error || 'Could not save AI checklist.');
            return;
        }

        task.ai_notes = data.task?.ai_notes || aiNotes;
        showSuccess('AI checklist saved to task.');
        renderBoardTasks();
    } catch (err) {
        hideLoading();
        console.error('Failed to save AI checklist:', err);
        showError('Network error saving AI checklist.');
    }
}

async function applyTaskAiUpdate(taskId) {
    const assistant = taskAiCache.get(taskId);
    const update = assistant?.suggestedUpdate;
    const task = projectTasks.find(item => item.id === taskId);
    if (!update || !task) return;

    const payload = {
        title: update.title || task.title,
        description: update.description || task.description,
        category: update.category || task.category,
        priority: update.priority || task.priority,
        impact: update.impact || task.impact,
        effort: update.effort || task.effort,
    };

    try {
        showLoading();
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        hideLoading();

        if (!data.success) {
            showError(data.error || 'Could not update task.');
            return;
        }

        taskAiCache.delete(taskId);
        showSuccess('Task updated with AI suggestion.');
        await loadTasksForProject(activeProjectId);
    } catch (err) {
        hideLoading();
        console.error('Failed to apply AI update:', err);
        showError('Network error applying AI update.');
    }
}
