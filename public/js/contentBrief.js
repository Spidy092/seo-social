let contentBriefState = null;
async function initContentBriefPage() {
    const select = document.getElementById("briefProjectSelect");
    if (select && !select.dataset.bound) {
        select.dataset.bound = "1";
        select.addEventListener("change", hydrateBriefFromProject);
    }
    await loadContentBriefProjects();
    hydrateBriefFromProject();
}

async function loadContentBriefProjects() {
    const select = document.getElementById("briefProjectSelect");
    if (!select) return;

    const current = select.value;
    try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || "Could not load projects");
        const projects = data.projects || [];
        select.innerHTML = "<option value=\"\">Do not attach to project</option>" + projects.map(project =>
            "<option value=\"" + escapeHtml(project.id) + "\" data-url=\"" + escapeHtml(project.website_url || "") + "\" data-location=\"" + escapeHtml(project.target_location || "") + "\">" + escapeHtml(project.client_name || "Client") + " · " + escapeHtml(project.name) + "</option>"
        ).join("");
        if (current && projects.some(project => String(project.id) === String(current))) select.value = current;
    } catch (err) {
        select.innerHTML = "<option value=\"\">Could not load projects</option>";
        console.error("Failed to load content brief projects:", err);
    }
}

function hydrateBriefFromProject() {
    const select = document.getElementById("briefProjectSelect");
    const selected = select?.options[select.selectedIndex];
    if (!selected || !select.value) return;

    const domainInput = document.getElementById("briefDomain");
    const locationInput = document.getElementById("briefLocation");
    const website = selected.dataset.url || "";
    const location = selected.dataset.location || "";

    if (website && domainInput && !domainInput.value.trim()) domainInput.value = website;
    if (location && locationInput && (!locationInput.value.trim() || locationInput.value.trim() === "India")) {
        locationInput.value = location;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('generateBriefBtn')?.addEventListener('click', generateContentBrief);
    document.getElementById('sendBriefToHumanizerBtn')?.addEventListener('click', sendBriefToHumanizer);
    initContentBriefPage();
});

async function generateContentBrief() {
    const keyword = document.getElementById('briefKeyword')?.value.trim() || '';
    const location = document.getElementById('briefLocation')?.value.trim() || 'India';
    const myDomain = document.getElementById('briefDomain')?.value.trim() || '';
    const audience = document.getElementById('briefAudience')?.value.trim() || '';
    const brandVoice = document.getElementById('briefBrandVoice')?.value.trim() || '';
    const numResults = Number(document.getElementById('briefNumResults')?.value || 10);
    const projectId = document.getElementById('briefProjectSelect')?.value || null;
    const useAi = document.getElementById('briefUseAi')?.checked !== false;

    if (!keyword) {
        showError('Enter a keyword to generate a brief.');
        return;
    }

    try {
        const data = await api('/api/content/brief', {
            method: 'POST',
            body: JSON.stringify({ keyword, location, myDomain, audience, brandVoice, projectId, numResults, useAi }),
        });

        if (!data.success) {
            showError(data.error || 'Could not generate content brief.');
            return;
        }

        contentBriefState = data.brief;
        latestContentBrief = data.brief;
        renderContentBrief(data.brief);
        showSuccess('Content brief generated.');
    } catch (err) {
        console.error('Content brief generation failed:', err);
        showError('Could not generate content brief right now.');
    }
}

function renderContentBrief(brief) {
    document.getElementById('contentBriefResults').style.display = 'block';
    document.getElementById('contentBriefResults').scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('briefIntent').textContent = capitalize(brief.searchIntent?.primary || '-');
    document.getElementById('briefPageType').textContent = (brief.searchIntent?.pageType || '-').replaceAll('-', ' ');
    document.getElementById('briefWordCount').textContent = `${brief.targetWordCount?.ideal || 0}`;
    document.getElementById('briefAiStatus').textContent = brief.aiEnhanced ? 'Yes' : 'No';

    document.getElementById('briefSummary').innerHTML = `
        <div class="recommendation-item" style="margin-bottom:12px;">
            <i class="fas fa-heading"></i>
            <span><strong>Title:</strong> ${escapeHtml(brief.suggestedTitle || '')}</span>
        </div>
        <div class="recommendation-item" style="margin-bottom:12px;">
            <i class="fas fa-align-left"></i>
            <span><strong>Meta:</strong> ${escapeHtml(brief.metaDescription || '')}</span>
        </div>
        <div class="recommendation-item" style="margin-bottom:12px;">
            <i class="fas fa-bullseye"></i>
            <span><strong>Intent:</strong> ${escapeHtml(brief.searchIntent?.description || brief.searchIntent?.stage || '')}</span>
        </div>
        <div class="recommendation-item">
            <i class="fas fa-file-word"></i>
            <span><strong>Word count:</strong> ${brief.targetWordCount?.min || 0}-${brief.targetWordCount?.max || 0} words. ${escapeHtml(brief.targetWordCount?.basis || '')}</span>
        </div>
        ${brief.aiWarning ? `<p class="text-muted" style="margin-top:12px;">${escapeHtml(brief.aiWarning)}</p>` : ''}
    `;

    const h2 = brief.outline?.h2 || [];
    document.getElementById('briefOutline').innerHTML = h2.length
        ? h2.map(section => `
            <div class="recommendation-item" style="display:block;margin-bottom:12px;">
                <strong>${escapeHtml(section.heading || '')}</strong>
                <p class="text-muted" style="margin:6px 0 0;">${escapeHtml(section.purpose || '')}</p>
                ${(section.h3 || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${section.h3.map(item => `<span class="tag tag-outline">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
            </div>
        `).join('')
        : '<p class="text-muted">No outline sections generated.</p>';

    renderTagList('briefEntities', brief.entitiesAndTopics || [], 'No entities or topics found.');
    renderTagList('briefFaqs', brief.faqs || [], 'No FAQ candidates found.');

    const schema = brief.schemaRecommendation || {};
    const links = brief.internalLinkSuggestions || [];
    document.getElementById('briefSchemaLinks').innerHTML = `
        <div class="recommendation-item" style="display:block;margin-bottom:14px;">
            <strong>Primary schema: ${escapeHtml(schema.primary || '-')}</strong>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
                ${(schema.recommendedTypes || []).map(type => `<span class="tag">${escapeHtml(type)}</span>`).join('')}
            </div>
            <p class="text-muted" style="margin:8px 0 0;">${escapeHtml(schema.notes || '')}</p>
        </div>
        ${links.map(link => `
            <div class="recommendation-item" style="display:block;margin-bottom:10px;">
                <strong>${escapeHtml(link.anchorText || '')}</strong>
                <p class="text-muted" style="margin:4px 0 0;">${escapeHtml(link.target || '')} - ${escapeHtml(link.reason || '')}</p>
            </div>
        `).join('')}
    `;

    const competitors = brief.competitorExamples || [];
    document.getElementById('briefCompetitors').innerHTML = competitors.length
        ? competitors.map(item => `
            <div class="recommendation-item" style="display:block;margin-bottom:12px;">
                <strong>#${escapeHtml(item.position || '')} ${escapeHtml(item.domain || '')}</strong>
                <p style="margin:6px 0;">${escapeHtml(item.title || '')}</p>
                <p class="text-muted" style="margin:0 0 6px;">${escapeHtml(item.description || '')}</p>
                <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener">${escapeHtml(item.url || '')}</a>
            </div>
        `).join('')
        : '<p class="text-muted">No competitor examples available.</p>';
}

function renderTagList(containerId, values, emptyText) {
    const container = document.getElementById(containerId);
    container.innerHTML = values.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${values.map(value => `<span class="tag tag-outline">${escapeHtml(value)}</span>`).join('')}</div>`
        : `<p class="text-muted">${emptyText}</p>`;
}

function sendBriefToHumanizer() {
    const brief = contentBriefState || latestContentBrief;
    if (!brief) {
        showError('Generate a brief first.');
        return;
    }

    const settings = brief.humanizerSettings || {};
    const draftPrompt = [
        `Write a complete SEO draft for: ${brief.keyword}`,
        `Suggested title: ${brief.suggestedTitle}`,
        `Meta description: ${brief.metaDescription}`,
        '',
        'Outline:',
        ...(brief.outline?.h2 || []).map(section => `- ${section.heading}`),
        '',
        `Target word count: ${brief.targetWordCount?.ideal || ''}`,
        `Topics to include: ${(brief.entitiesAndTopics || []).slice(0, 12).join(', ')}`,
        `FAQs: ${(brief.faqs || []).slice(0, 6).join(' | ')}`,
    ].join('\n');

    navigateTo('humanizer');
    document.getElementById('humanizerInput').value = draftPrompt;
    document.getElementById('humanizerMode').value = 'seo-blog';
    document.getElementById('humanizerTone').value = settings.tone || 'natural';
    document.getElementById('humanizerAudience').value = settings.audience || '';
    document.getElementById('humanizerVoice').value = settings.brandVoice || '';
    document.getElementById('humanizerPrimaryKeyword').value = settings.primaryKeyword || brief.keyword || '';
    document.getElementById('humanizerRelatedKeywords').value = (settings.relatedKeywords || []).join(', ');
    document.getElementById('humanizerKeywords').value = (settings.preserveKeywords || []).join(', ');
    document.getElementById('humanizerMaxChange').value = settings.maxChange || 'balanced';
    toggleHumanizerModeFields();
    showSuccess('Brief loaded into the humanizer.');
}
