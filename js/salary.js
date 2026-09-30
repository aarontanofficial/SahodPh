// js/salary.js
// Salary history view + add-rate logic. Requires supabaseClient.js and auth.js.

async function initSalaryHistory() {
    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get('id');

    if (!employeeId) {
        document.getElementById('error-box').textContent = 'No employee specified.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    document.getElementById('employee-id').value = employeeId;

    const { data: employee, error: empError } = await supabaseClient
        .from('employees')
        .select('first_name, last_name, employee_code')
        .eq('id', employeeId)
        .single();

    if (empError || !employee) {
        document.getElementById('error-box').textContent = 'Could not load employee.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    document.getElementById('page-title').textContent =
        'Salary History — ' + employee.first_name + ' ' + employee.last_name +
        ' (' + employee.employee_code + ')';

    // Default the effective_date field to today
    document.getElementById('effective_date').valueAsDate = new Date();

    await loadSalaryHistory(employeeId);

    document.getElementById('rate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitRateChange(employeeId);
    });
}

async function loadSalaryHistory(employeeId) {
    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('empty-state');
    const table = document.getElementById('history-table');
    const tbody = document.getElementById('history-tbody');
    const currentRateEl = document.getElementById('current-rate');

    loading.style.display = 'block';
    emptyState.style.display = 'none';
    table.style.display = 'none';

    const { data, error } = await supabaseClient
        .from('salary_history')
        .select('id, previous_rate, new_rate, rate_type, effective_date, reason, created_at')
        .eq('employee_id', employeeId)
        .order('effective_date', { ascending: false });

    loading.style.display = 'none';

    if (error) {
        emptyState.textContent = 'Failed to load history: ' + error.message;
        emptyState.style.display = 'block';
        currentRateEl.textContent = 'Unknown';
        return;
    }

    if (!data || data.length === 0) {
        emptyState.textContent = 'No salary rate has been set yet. Add the initial rate below.';
        emptyState.style.display = 'block';
        currentRateEl.textContent = 'Not set';
        return;
    }

    // Current rate = the entry with the latest effective_date that isn't in the future
    const today = new Date().toISOString().slice(0, 10);
    const applicable = data.find(r => r.effective_date <= today) || data[data.length - 1];
    currentRateEl.textContent = applicable
        ? '₱' + Number(applicable.new_rate).toFixed(2) + ' / ' + applicable.rate_type
        : 'Not set';

    tbody.innerHTML = data.map(r => `
        <tr>
            <td>${escapeHtml(r.effective_date)}</td>
            <td>${r.previous_rate !== null ? '₱' + Number(r.previous_rate).toFixed(2) : '—'}</td>
            <td>₱${Number(r.new_rate).toFixed(2)}</td>
            <td>${escapeHtml(r.rate_type)}</td>
            <td>${escapeHtml(r.reason || '—')}</td>
            <td>${escapeHtml(new Date(r.created_at).toLocaleDateString())}</td>
        </tr>
    `).join('');

    table.style.display = 'table';
}

async function submitRateChange(employeeId) {
    const errorBox = document.getElementById('error-box');
    const successBox = document.getElementById('success-box');
    const submitBtn = document.getElementById('submit-btn');

    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const newRate = parseFloat(document.getElementById('new_rate').value);
    const rateType = document.getElementById('rate_type').value;
    const effectiveDate = document.getElementById('effective_date').value;
    const reason = document.getElementById('reason').value.trim() || null;

    if (isNaN(newRate) || newRate <= 0 || !effectiveDate) {
        errorBox.textContent = 'Please enter a valid rate and effective date.';
        errorBox.style.display = 'block';
        return;
    }

    // Find the most recent existing rate to record as previous_rate
    const { data: existing } = await supabaseClient
        .from('salary_history')
        .select('new_rate')
        .eq('employee_id', employeeId)
        .order('effective_date', { ascending: false })
        .limit(1);

    const previousRate = (existing && existing.length > 0) ? existing[0].new_rate : null;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const session = await getSession();

    const { data, error } = await supabaseClient
        .from('salary_history')
        .insert({
            employee_id: employeeId,
            previous_rate: previousRate,
            new_rate: newRate,
            rate_type: rateType,
            effective_date: effectiveDate,
            reason: reason,
            created_by: session.user.id,
        })
        .select()
        .single();

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Rate Change';

    if (error) {
        errorBox.textContent = 'Save failed: ' + error.message;
        errorBox.style.display = 'block';
        return;
    }

    await logAudit(session.user.id, 'salary_changed',
        `${previousRate ?? 'none'} -> ${newRate} effective ${effectiveDate}`, data.id);

    successBox.textContent = 'Rate change saved.';
    successBox.style.display = 'block';

    document.getElementById('rate-form').reset();
    document.getElementById('effective_date').valueAsDate = new Date();

    await loadSalaryHistory(employeeId);
}
