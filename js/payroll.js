// js/payroll.js
// Payroll run (per-period, all employees) + payroll detail (single employee).
// Requires supabaseClient.js and auth.js.

async function initPayrollRun() {
    const params = new URLSearchParams(window.location.search);
    const periodId = params.get('period_id');

    if (!periodId) {
        document.getElementById('error-box').textContent = 'No payroll period specified.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    const { data: period } = await supabaseClient
        .from('payroll_periods')
        .select('*')
        .eq('id', periodId)
        .single();

    if (!period) {
        document.getElementById('error-box').textContent = 'Payroll period not found.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    document.getElementById('page-title').textContent =
        `Payroll Run — ${period.period_start} to ${period.period_end}`;

    await loadRunTable(periodId);

    document.getElementById('calculate-btn').addEventListener('click', async () => {
        await calculateAllForPeriod(period);
    });
}

async function loadRunTable(periodId) {
    const loading = document.getElementById('loading');
    const table = document.getElementById('run-table');
    const tbody = document.getElementById('run-tbody');

    loading.style.display = 'block';
    table.style.display = 'none';

    const { data: employees } = await supabaseClient
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('is_active', 1)
        .order('last_name');

    const { data: records } = await supabaseClient
        .from('payroll_records')
        .select('*')
        .eq('payroll_period_id', periodId);

    const byEmployee = {};
    (records || []).forEach(r => { byEmployee[r.employee_id] = r; });

    loading.style.display = 'none';

    tbody.innerHTML = (employees || []).map(emp => {
        const rec = byEmployee[emp.id];
        return `
            <tr>
                <td>${escapeHtml(emp.last_name + ', ' + emp.first_name)} (${escapeHtml(emp.employee_code)})</td>
                <td>${rec ? '₱' + Number(rec.basic_pay).toFixed(2) : '—'}</td>
                <td>${rec ? '₱' + Number(rec.gross_pay).toFixed(2) : '—'}</td>
                <td>${rec ? '₱' + Number(rec.total_deductions).toFixed(2) : '—'}</td>
                <td>${rec ? '₱' + Number(rec.net_pay).toFixed(2) : '—'}</td>
                <td>${rec ? escapeHtml(rec.status) : '<span class="muted">Not calculated</span>'}</td>
                <td>${rec ? `<a href="payroll-detail.html?record_id=${rec.id}" class="btn btn-secondary" style="padding:4px 10px; font-size:0.8rem;">Open</a>` : ''}</td>
            </tr>
        `;
    }).join('');

    table.style.display = 'table';
}

async function calculateAllForPeriod(period) {
    const btn = document.getElementById('calculate-btn');
    const errorBox = document.getElementById('error-box');
    const successBox = document.getElementById('success-box');
    errorBox.style.display = 'none';
    successBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Calculating...';

    const session = await getSession();

    const { data: employees, error: empError } = await supabaseClient
        .from('employees')
        .select('id')
        .eq('is_active', 1);

    if (empError) {
        errorBox.textContent = empError.message;
        errorBox.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Calculate / Recalculate All';
        return;
    }

    for (const emp of employees) {
        await calculateOneEmployee(emp.id, period, session.user.id);
    }

    btn.disabled = false;
    btn.textContent = 'Calculate / Recalculate All';
    successBox.textContent = `Calculated payroll for ${employees.length} employee(s).`;
    successBox.style.display = 'block';

    await loadRunTable(period.id);
}

async function calculateOneEmployee(employeeId, period, userId) {
    // Get all attendance for this employee within the period
    const { data: attendance } = await supabaseClient
        .from('attendance')
        .select('date, status, regular_hours, overtime_hours, scheduled_workday')
        .eq('employee_id', employeeId)
        .gte('date', period.period_start)
        .lte('date', period.period_end);

    // Get full salary history to resolve the applicable rate per date locally
    const { data: history } = await supabaseClient
        .from('salary_history')
        .select('new_rate, effective_date')
        .eq('employee_id', employeeId)
        .order('effective_date', { ascending: false });

    const rateForDate = (dateStr) => {
        if (!history) return 0;
        const applicable = history.find(h => h.effective_date <= dateStr);
        return applicable ? Number(applicable.new_rate) : 0;
    };

    const payableStatuses = ['Present', 'Late', 'Undertime', 'Half Day', 'Work From Home'];
    let basicPay = 0;
    let overtimePay = 0;

    (attendance || []).forEach(a => {
        const rate = rateForDate(a.date);
        if (a.scheduled_workday && payableStatuses.includes(a.status)) {
            const fraction = Math.min((Number(a.regular_hours) || 0) / 8, 1);
            basicPay += rate * fraction;
        }
        if (Number(a.overtime_hours) > 0) {
            overtimePay += (rate / 8) * Number(a.overtime_hours);
        }
    });

    // Upsert the payroll_records row for this employee+period
    const { data: existingRecord } = await supabaseClient
        .from('payroll_records')
        .select('id, status')
        .eq('employee_id', employeeId)
        .eq('payroll_period_id', period.id)
        .maybeSingle();

    // Don't touch already-finalized/released records
    if (existingRecord && (existingRecord.status === 'FINALIZED' || existingRecord.status === 'RELEASED')) {
        return;
    }

    let recordId;
    if (existingRecord) {
        recordId = existingRecord.id;
        await supabaseClient
            .from('payroll_records')
            .update({ basic_pay: basicPay, status: 'PROCESSING' })
            .eq('id', recordId);
    } else {
        const { data: inserted } = await supabaseClient
            .from('payroll_records')
            .insert({
                employee_id: employeeId,
                payroll_period_id: period.id,
                basic_pay: basicPay,
                status: 'PROCESSING',
            })
            .select()
            .single();
        recordId = inserted.id;
    }

    // Replace auto-generated earning rows (Basic Pay, Overtime) without touching manual ones
    await supabaseClient
        .from('payroll_earnings')
        .delete()
        .eq('payroll_record_id', recordId)
        .in('earning_type', ['Basic Pay', 'Overtime']);

    const newEarnings = [{ payroll_record_id: recordId, earning_type: 'Basic Pay', amount: basicPay }];
    if (overtimePay > 0) {
        newEarnings.push({ payroll_record_id: recordId, earning_type: 'Overtime', amount: overtimePay });
    }
    await supabaseClient.from('payroll_earnings').insert(newEarnings);

    await recomputeTotals(recordId);
    await logAudit(userId, 'payroll_calculated', `basic=${basicPay.toFixed(2)} ot=${overtimePay.toFixed(2)}`, recordId);
}

async function recomputeTotals(recordId) {
    const { data: earnings } = await supabaseClient
        .from('payroll_earnings').select('amount').eq('payroll_record_id', recordId);
    const { data: deductions } = await supabaseClient
        .from('payroll_deductions').select('amount').eq('payroll_record_id', recordId);

    const gross = (earnings || []).reduce((sum, e) => sum + Number(e.amount), 0);
    const totalDeductions = (deductions || []).reduce((sum, d) => sum + Number(d.amount), 0);
    const net = gross - totalDeductions;

    await supabaseClient
        .from('payroll_records')
        .update({ gross_pay: gross, total_deductions: totalDeductions, net_pay: net })
        .eq('id', recordId);
}

// ---------- Detail page ----------

let currentRecordId = null;
let currentPeriodId = null;

async function initPayrollDetail() {
    const params = new URLSearchParams(window.location.search);
    currentRecordId = params.get('record_id');

    if (!currentRecordId) {
        document.getElementById('error-box').textContent = 'No payroll record specified.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    await reloadDetail();
}

async function reloadDetail() {
    const { data: record, error } = await supabaseClient
        .from('payroll_records')
        .select('*, employees(first_name, last_name, employee_code), payroll_periods(period_start, period_end)')
        .eq('id', currentRecordId)
        .single();

    if (error || !record) {
        document.getElementById('error-box').textContent = 'Could not load payroll record.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    currentPeriodId = record.payroll_period_id;
    document.getElementById('back-link').href = 'payroll-run.html?period_id=' + currentPeriodId;
    document.getElementById('page-title').textContent =
        `${record.employees.first_name} ${record.employees.last_name} (${record.employees.employee_code}) — ${record.payroll_periods.period_start} to ${record.payroll_periods.period_end}`;

    document.getElementById('status-badge').textContent = record.status;
    document.getElementById('gross-pay').textContent = Number(record.gross_pay).toFixed(2);
    document.getElementById('total-deductions').textContent = Number(record.total_deductions).toFixed(2);
    document.getElementById('net-pay').textContent = Number(record.net_pay).toFixed(2);

    const locked = record.status === 'FINALIZED' || record.status === 'RELEASED';
    const canEdit = window.canEditPayroll && !locked;

    document.getElementById('add-earning-row').style.display = canEdit ? 'block' : 'none';
    document.getElementById('add-deduction-row').style.display = canEdit ? 'block' : 'none';
    document.getElementById('finalize-btn').style.display =
        (window.canEditPayroll && !locked) ? 'inline-block' : 'none';

    const { data: earnings } = await supabaseClient
        .from('payroll_earnings').select('*').eq('payroll_record_id', currentRecordId).order('created_at');
    document.getElementById('earnings-tbody').innerHTML = (earnings || []).map(e => `
        <tr>
            <td>${escapeHtml(e.earning_type)}</td>
            <td>₱${Number(e.amount).toFixed(2)}</td>
            <td>${escapeHtml(e.notes || '')}</td>
            <td>${canEdit ? `<button type="button" class="btn btn-secondary" style="padding:2px 8px;" onclick="removeEarning('${e.id}')">Remove</button>` : ''}</td>
        </tr>
    `).join('');

    const { data: deductions } = await supabaseClient
        .from('payroll_deductions').select('*').eq('payroll_record_id', currentRecordId).order('created_at');
    document.getElementById('deductions-tbody').innerHTML = (deductions || []).map(d => `
        <tr>
            <td>${escapeHtml(d.deduction_type)}</td>
            <td>₱${Number(d.amount).toFixed(2)}</td>
            <td>${escapeHtml(d.notes || '')}</td>
            <td>${canEdit ? `<button type="button" class="btn btn-secondary" style="padding:2px 8px;" onclick="removeDeduction('${d.id}')">Remove</button>` : ''}</td>
        </tr>
    `).join('');

    // Show which statutory types have no deduction row AND no configured rule
    const { data: rules } = await supabaseClient.from('government_rules').select('rule_type, is_configured');
    const configuredTypes = new Set((rules || []).filter(r => r.is_configured).map(r => r.rule_type));
    const enteredTypes = new Set((deductions || []).map(d => d.deduction_type));
    const statutory = ['SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding Tax'];
    const missing = statutory.filter(t => !enteredTypes.has(t) && !configuredTypes.has(t));

    document.getElementById('not-configured-list').textContent = missing.length > 0
        ? 'Not configured (no amount applied): ' + missing.join(', ')
        : '';
}

async function addEarning() {
    const type = document.getElementById('new-earning-type').value;
    const amount = parseFloat(document.getElementById('new-earning-amount').value);
    const notes = document.getElementById('new-earning-notes').value.trim() || null;

    if (isNaN(amount) || amount < 0) {
        alert('Enter a valid amount.');
        return;
    }

    const session = await getSession();
    const { error } = await supabaseClient.from('payroll_earnings').insert({
        payroll_record_id: currentRecordId, earning_type: type, amount, notes,
    });

    if (error) { alert('Failed: ' + error.message); return; }

    await recomputeTotals(currentRecordId);
    await logAudit(session.user.id, 'payroll_earning_added', `${type}: ${amount}`, currentRecordId);
    document.getElementById('new-earning-amount').value = '';
    document.getElementById('new-earning-notes').value = '';
    await reloadDetail();
}

async function removeEarning(id) {
    const session = await getSession();
    await supabaseClient.from('payroll_earnings').delete().eq('id', id);
    await recomputeTotals(currentRecordId);
    await logAudit(session.user.id, 'payroll_earning_removed', id, currentRecordId);
    await reloadDetail();
}

async function addDeduction() {
    const type = document.getElementById('new-deduction-type').value;
    const amount = parseFloat(document.getElementById('new-deduction-amount').value);
    const notes = document.getElementById('new-deduction-notes').value.trim() || null;

    if (isNaN(amount) || amount < 0) {
        alert('Enter a valid amount.');
        return;
    }

    const session = await getSession();
    const { error } = await supabaseClient.from('payroll_deductions').insert({
        payroll_record_id: currentRecordId, deduction_type: type, amount, notes,
    });

    if (error) { alert('Failed: ' + error.message); return; }

    await recomputeTotals(currentRecordId);
    await logAudit(session.user.id, 'payroll_deduction_added', `${type}: ${amount}`, currentRecordId);
    document.getElementById('new-deduction-amount').value = '';
    document.getElementById('new-deduction-notes').value = '';
    await reloadDetail();
}

async function removeDeduction(id) {
    const session = await getSession();
    await supabaseClient.from('payroll_deductions').delete().eq('id', id);
    await recomputeTotals(currentRecordId);
    await logAudit(session.user.id, 'payroll_deduction_removed', id, currentRecordId);
    await reloadDetail();
}

async function finalizeRecord() {
    if (!confirm('Finalize this payroll record? Once finalized, earnings and deductions can no longer be changed directly — corrections will require an adjustment record.')) {
        return;
    }

    const session = await getSession();
    const { error } = await supabaseClient
        .from('payroll_records')
        .update({ status: 'FINALIZED', finalized_at: new Date().toISOString(), finalized_by: session.user.id })
        .eq('id', currentRecordId);

    if (error) { alert('Failed to finalize: ' + error.message); return; }

    await logAudit(session.user.id, 'payroll_finalized', '', currentRecordId);
    await reloadDetail();
}
