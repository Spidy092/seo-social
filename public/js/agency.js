/**
 * Agency Settings & Members — Frontend logic
 * Loaded on the dashboard SPA.
 */

(function () {
    'use strict';

    // ─── Helpers ───
    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

    async function api(method, url, body) {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') return window.showToast(msg, type);
        console.log(`[${type || 'info'}] ${msg}`);
    }

    function roleBadge(role) {
        const colors = { owner: '#7c3aed', manager: '#2563eb', agent: '#059669' };
        const bg = colors[role] || '#64748b';
        return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:11px;font-weight:700;color:#fff;background:${bg};text-transform:uppercase;">${role}</span>`;
    }

    function formatDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // ─── Agency Settings Page ───
    async function loadAgencySettings() {
        try {
            const { agency, role } = await api('GET', '/api/agency/current');
            const nameInput = $('#agencyNameInput');
            if (nameInput) nameInput.value = agency.name || '';
            const status = $('#agencySettingsStatus');
            if (status) status.textContent = `Your role: ${role}`;
        } catch (err) {
            console.error('Failed to load agency:', err);
        }
    }

    async function saveAgencyName() {
        const nameInput = $('#agencyNameInput');
        if (!nameInput || !nameInput.value.trim()) return;
        try {
            await api('PUT', '/api/agency/current', { name: nameInput.value.trim() });
            toast('Agency name updated', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    // ─── Invite ───
    async function sendInvite() {
        const emailInput = $('#inviteEmailInput');
        const roleSelect = $('#inviteRoleSelect');
        const resultDiv = $('#inviteResult');
        if (!emailInput) return;

        const email = emailInput.value.trim();
        if (!email) { toast('Enter an email address', 'error'); return; }

        try {
            const data = await api('POST', '/api/agency/invite', {
                email,
                role: roleSelect ? roleSelect.value : 'agent',
            });
            resultDiv.innerHTML = `<span style="color:#059669;">${data.message}</span>`;
            if (data.inviteToken) {
                resultDiv.innerHTML += `<br><code style="font-size:12px;word-break:break-all;">/register?invite=${data.inviteToken}</code>`;
            }
            emailInput.value = '';
            loadPendingInvites();
        } catch (err) {
            resultDiv.innerHTML = `<span style="color:#dc2626;">${err.message}</span>`;
        }
    }

    // ─── Pending Invites ───
    async function loadPendingInvites() {
        const container = $('#pendingInvitesList');
        if (!container) return;
        try {
            const { invites } = await api('GET', '/api/agency/invites');
            if (!invites.length) {
                container.innerHTML = '<p class="text-muted">No pending invites.</p>';
                return;
            }
            container.innerHTML = `
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
                        <th style="padding:8px;">Email</th><th style="padding:8px;">Role</th>
                        <th style="padding:8px;">Expires</th><th style="padding:8px;">Status</th>
                        <th style="padding:8px;"></th>
                    </tr></thead>
                    <tbody>${invites.map(inv => `
                        <tr style="border-bottom:1px solid var(--border);">
                            <td style="padding:8px;">${inv.email}</td>
                            <td style="padding:8px;">${roleBadge(inv.role)}</td>
                            <td style="padding:8px;">${formatDate(inv.expires_at)}</td>
                            <td style="padding:8px;">${inv.accepted ? '<span style="color:#059669;">Accepted</span>' : '<span style="color:#d97706;">Pending</span>'}</td>
                            <td style="padding:8px;">${!inv.accepted ? `<button class="btn btn-sm btn-outline revoke-invite-btn" data-id="${inv.id}" style="font-size:11px;padding:2px 8px;">Revoke</button>` : ''}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        } catch (err) {
            container.innerHTML = `<p style="color:#dc2626;">${err.message}</p>`;
        }
    }

    async function revokeInvite(id) {
        try {
            await api('DELETE', `/api/agency/invites/${id}`);
            toast('Invite revoked', 'success');
            loadPendingInvites();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    // ─── Members Page ───
    async function loadMembers() {
        const container = $('#agencyMembersList');
        if (!container) return;
        try {
            const { members, currentUserId } = await api('GET', '/api/agency/members');
            if (!members.length) {
                container.innerHTML = '<p class="text-muted">No members found.</p>';
                return;
            }
            container.innerHTML = `
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
                        <th style="padding:10px;">Email</th><th style="padding:10px;">Role</th>
                        <th style="padding:10px;">Joined</th><th style="padding:10px;">Actions</th>
                    </tr></thead>
                    <tbody>${members.map(m => `
                        <tr style="border-bottom:1px solid var(--border);">
                            <td style="padding:10px;font-weight:600;">${m.email}${m.user_id === currentUserId ? ' <span style="color:#64748b;font-size:11px;">(you)</span>' : ''}</td>
                            <td style="padding:10px;">${roleBadge(m.role)}</td>
                            <td style="padding:10px;">${formatDate(m.joined_at)}</td>
                            <td style="padding:10px;">
                                ${m.role !== 'owner' && m.user_id !== currentUserId ? `
                                    <select class="member-role-select" data-user-id="${m.user_id}" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);margin-right:6px;">
                                        <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Manager</option>
                                        <option value="agent" ${m.role === 'agent' ? 'selected' : ''}>Agent</option>
                                    </select>
                                    <button class="btn btn-sm btn-outline remove-member-btn" data-user-id="${m.user_id}" style="font-size:11px;padding:4px 10px;color:#dc2626;">Remove</button>
                                ` : ''}
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        } catch (err) {
            container.innerHTML = `<p style="color:#dc2626;">${err.message}</p>`;
        }
    }

    async function changeMemberRole(userId, role) {
        try {
            await api('PUT', `/api/agency/members/${userId}/role`, { role });
            toast('Role updated', 'success');
            loadMembers();
        } catch (err) {
            toast(err.message, 'error');
            loadMembers();
        }
    }

    async function removeMember(userId) {
        if (!confirm('Remove this member from the agency?')) return;
        try {
            await api('DELETE', `/api/agency/members/${userId}`);
            toast('Member removed', 'success');
            loadMembers();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    // ─── Event Binding ───
    function bindEvents() {
        const saveBtn = $('#saveAgencyNameBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveAgencyName);

        const inviteBtn = $('#sendInviteBtn');
        if (inviteBtn) inviteBtn.addEventListener('click', sendInvite);

        const refreshInvites = $('#refreshInvitesBtn');
        if (refreshInvites) refreshInvites.addEventListener('click', loadPendingInvites);

        const refreshMembers = $('#refreshMembersBtn');
        if (refreshMembers) refreshMembers.addEventListener('click', loadMembers);

        // Delegated events for dynamic elements
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('revoke-invite-btn')) {
                revokeInvite(e.target.dataset.id);
            }
            if (e.target.classList.contains('remove-member-btn')) {
                removeMember(e.target.dataset.userId);
            }
        });

        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('member-role-select')) {
                changeMemberRole(e.target.dataset.userId, e.target.value);
            }
        });
    }

    // ─── Page Load Hooks ───
    // These functions are called by the SPA router when navigating to the page
    window.loadAgencySettingsPage = function () {
        loadAgencySettings();
        loadPendingInvites();
    };

    window.loadAgencyMembersPage = function () {
        loadMembers();
    };

    // Init
    bindEvents();
})();
