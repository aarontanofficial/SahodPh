// js/payslip.js
// Printable payslip view + release/receive workflow. Requires supabaseClient.js and auth.js.

let payslipRecordId = null;

async function initPayslip() {
    const params = new URLSearchParams(window.location.search);
    payslipRecordId = params.get('record_id');

    if (!payslipRecordId) {
        showPayslipError('No payroll record specified.');
        return;
    }

    document.getElementById('back-link').href = 'payroll-detail.html?record_id=' + payslipRecordId;
    await loadPayslip();
}

async function loadPayslip() {
    const { data: record, error } = await supabaseClient
        .from('payroll_records')
        .select('*, employees(first_name, last_name, employee_code, position, department), payroll_periods(period_start, period_end, release_date)')
        .eq('id', payslipRecordId)
        .single();

    if (error || !record) {
        showPayslipError('Could not load payroll record.');
        return;
    }

    const { data: earnings } = await supabaseClient
        .from('payroll_earnings').select('*').eq('payroll_record_id', payslipRecordId).order('created_at');
    const { data: deductions } = await supabaseClient
        .from('payroll_deductions').select('*').eq('payroll_record_id', payslipRecordId).order('created_at');

    const emp = record.employees;
    const period = record.payroll_periods;

    document.getElementById('ps-employee').textContent = `${emp.first_name} ${emp.last_name}`;
    document.getElementById('ps-code').textContent = emp.employee_code;
    document.getElementById('ps-position').textContent = [emp.position, emp.department].filter(Boolean).join(' / ') || '—';
    document.getElementById('ps-period').textContent = `${period.period_start} to ${period.period_end}`;
    document.getElementById('ps-cutoff').textContent = period.period_end;
    document.getElementById('ps-release').textContent = period.release_date;
    document.getElementById('ps-status').textContent = record.status;

    document.getElementById('ps-earnings').innerHTML = (earnings || []).map(e => `
        <tr><td>${escapeHtml(e.earning_type)}</td><td style="text-align:right;">₱${Number(e.amount).toFixed(2)}</td></tr>
    `).join('') || '<tr><td colspan="2" class="muted">No earnings recorded</td></tr>';

    document.getElementById('ps-deductions').innerHTML = (deductions || []).map(d => `
        <tr><td>${escapeHtml(d.deduction_type)}</td><td style="text-align:right;">₱${Number(d.amount).toFixed(2)}</td></tr>
    `).join('') || '<tr><td colspan="2" class="muted">No deductions recorded</td></tr>';

    document.getElementById('ps-gross').textContent = '₱' + Number(record.gross_pay).toFixed(2);
    document.getElementById('ps-total-deductions').textContent = '₱' + Number(record.total_deductions).toFixed(2);
    document.getElementById('ps-net').textContent = '₱' + Number(record.net_pay).toFixed(2);

    document.getElementById('payslip-content').style.display = 'block';

    // Release / receive buttons
    const releaseBtn = document.getElementById('release-btn');
    const receivedBtn = document.getElementById('received-btn');
    const infoLine = document.getElementById('release-info');

    if (record.status === 'FINALIZED' && window.canReleasePayroll) {
        releaseBtn.style.display = 'inline-block';
    }

        if (record.status === 'RELEASED') {
        infoLine.textContent = `Released ${new Date(record.released_at).toLocaleString()}`;
        if (!record.received_at && window.canReleasePayroll) {
            receivedBtn.style.display = 'inline-block';
        } else if (record.received_at) {
            infoLine.textContent += ` · Received ${new Date(record.received_at).toLocaleString()}`;
        }

        if (record.received_at) {
            const { data: existingIncome } = await supabaseClient
                .from('income')
                .select('id')
                .eq('payroll_record_id', payslipRecordId)
                .maybeSingle();

            if (!existingIncome) {
                document.getElementById('add-to-budget-btn').style.display = 'inline-block';
            } else {
                document.getElementById('release-info').textContent += ' · Already added to budget';
            }
        }
    }
function showPayslipError(msg) {
    const box = document.getElementById('error-box');
    box.textContent = msg;
    box.style.display = 'block';
}

async function releasePayroll() {
    if (!confirm('Mark this payroll as released? This should only be done once salary has actually been paid out.')) {
        return;
    }

    const session = await getSession();
    const { error } = await supabaseClient
        .from('payroll_records')
        .update({
            status: 'RELEASED',
            released_at: new Date().toISOString(),
            released_by: session.user.id,
        })
        .eq('id', payslipRecordId);

    if (error) {
        alert('Failed to release: ' + error.message);
        return;
    }

    await logAudit(session.user.id, 'salary_released', '', payslipRecordId);
    await loadPayslip();
}

async function markReceived() {
    const session = await getSession();
    const { error } = await supabaseClient
        .from('payroll_records')
        .update({
            received_at: new Date().toISOString(),
            received_by: session.user.id,
        })
        .eq('id', payslipRecordId);

    if (error) {
        alert('Failed to mark as received: ' + error.message);
        return;
    }

    await logAudit(session.user.id, 'salary_received', '', payslipRecordId);
    await loadPayslip();
}
