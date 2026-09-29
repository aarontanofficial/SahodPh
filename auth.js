// js/auth.js
// Shared auth helpers used by index.html and dashboard.html.
// Requires supabaseClient.js to be loaded first.

async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
}

// Call at the top of any protected page. Redirects to login if not signed in.
async function requireAuth() {
    const session = await getSession();
    if (!session) {
        window.location.href = 'index.html';
        return null;
    }
    return session;
}

// Call at the top of the login page so an already-signed-in user skips it.
async function requireGuest() {
    const session = await getSession();
    if (session) {
        window.location.href = 'dashboard.html';
    }
}

async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        return { success: false, message: error.message };
    }

    await logAudit(data.user.id, 'login_success', '');
    return { success: true };
}

async function logout() {
    const session = await getSession();
    if (session) {
        await logAudit(session.user.id, 'logout', '');
    }
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
}

// Writes to audit_logs. Only logs actions for the currently authenticated
// user - RLS only allows a user to insert a row where user_id = their own
// auth.uid(), so this cannot be used to forge logs for other users.
async function logAudit(userId, action, details) {
    try {
        await supabaseClient.from('audit_logs').insert({
            user_id: userId,
            action: action,
            details: details,
        });
    } catch (e) {
        console.error('Audit log failed', e);
    }
}

async function getProfile(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('username, role, is_active')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Failed to load profile', error);
        return null;
    }
    return data;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}
