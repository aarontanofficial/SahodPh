// js/government-rules.js
const RULE_TYPES = ['SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding Tax'];

async function loadGovernmentRules() {
    const container = document.getElementById('rules-container');

    const { data, error } = await supabaseClient.from('government_rules').select('*');

    if (error) {
        container.textContent = 'Failed to load: ' + error.message;
        return;
    }

    const byType = {};
    (data || []).forEach(r => { byType[r.rule_type] = r; });

    container.innerHTML = RULE_TYPES.map(type => {
        const rule = byType[type];
        const configured = rule && rule.is_configured;
        return `
            <div class="card-form" style="max-width:100%; margin-bottom:14px;">
                <h2 style="font-size:1rem; margin-top:0;">${type}
                    <span style="font-weight:400; font-size:0.85rem; color:${configured ? '#188038' : '#d93025'};">
                        ${configured ? '(Configured)' : '(Not configured)'}
                    </span>
                </h2>
                <div class="form-row">
                    <div>
                        <label>Rate (% of basic pay)</label>
                        <input type="number" step="0.01" min="0" max="100" id="rate-${type}" value="${rule?.rate_percent ?? ''}">
                    </div>
                    <div>
                        <label>OR Fixed Amount (₱ per period)</label>
                        <input type="number" step="0.01" min="0" id="fixed-${type}" value="${rule?.fixed_amount ?? ''}">
                    </div>
                </div>
                <label>Notes</label>
                <input type="text" id="notes-${type}" value="${rule?.notes ? escapeHtml(rule.notes) : ''}">
                <button type="button" class="btn btn-primary" style="margin-top:14px; width:auto;" onclick="saveRule('${type}')">Save ${type}</button>
                <button type="button" class="btn btn-secondary" style="margin-top:14px; width:auto; margin-left:8px;" onclick="clearRule('${type}')">Mark Not Configured</button>
            </div>
        `;
    }).join('');
}

async function saveRule(type) {
    const rate = document.getElementById(`rate-${type}`).value;
    const fixed = document.getElementById(`fixed-${type}`).value;
    const notes = document.getElementById(`notes-${type}`).value.trim() || null;

    if (!rate && !fixed) {
        showRuleMessage(false, 'Enter either a rate or a fixed amount.');
        return;
    }

    const session = await getSession();

    const { error } = await supabaseClient
        .from('government_rules')
        .upsert({
            rule_type: type,
            rate_percent: rate ? parseFloat(rate) : null,
            fixed_amount: fixed ? parseFloat(fixed) : null,
            is_configured: true,
            notes: notes,
            updated_by: session.user.id,
        }, { onConflict: 'rule_type' });

    if (error) {
        showRuleMessage(false, 'Save failed: ' + error.message);
        return;
    }

    await logAudit(session.user.id, 'government_rule_configured', type);
    showRuleMessage(true, type + ' saved.');
    await loadGovernmentRules();
}

async function clearRule(type) {
    const session = await getSession();

    const { error } = await supabaseClient
        .from('government_rules')
        .upsert({
            rule_type: type,
            rate_percent: null,
            fixed_amount: null,
            is_configured: false,
            updated_by: session.user.id,
        }, { onConflict: 'rule_type' });

    if (error) {
        showRuleMessage(false, 'Failed: ' + error.message);
        return;
    }

    showRuleMessage(true, type + ' marked not configured.');
    await loadGovernmentRules();
}

function showRuleMessage(success, text) {
    const box = document.getElementById(success ? 'success-box' : 'error-box');
    const other = document.getElementById(success ? 'error-box' : 'success-box');
    other.style.display = 'none';
    box.textContent = text;
    box.style.display = 'block';
}
