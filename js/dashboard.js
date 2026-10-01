// js/dashboard.js
// Requires supabaseClient.js and auth.js.

function addDaysLocal(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function thursdayEndingCycle(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const dow = d.getUTCDay();
    const daysUntilThursday = (4 - dow + 7) % 7;
    return addDaysLocal(dateStr, daysUntilThursday);
}

function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function initDashboard(userId, profile) {
    const today = todayStr();
    const periodEnd = thursdayEndingCycle(today);
    const periodStart = addDaysLocal(periodEnd, -6);
    const releaseDate = addDaysLocal(periodEnd, 2);

    document.getElementById('d-period').textContent = `${periodStart} to ${periodEnd}`;
    document.getElementById('d-cutoff').textContent = periodEnd;
    document.getElementById('d-release').textContent = releaseDate;

    // Employee-linked stats
    const employeeId = profile.employee_id;

    if (!employeeId) {
        document.getElementById('no-employee-note').textContent =
            'Your account isn\'t linked to an employee record yet, so salary and attendance stats aren\'t shown. Ask an admin to set this in Supabase.';
        document.getElementById('no-employee-note').style.display = 'block';
    } else {
        document.getElementById('employee-section').style.display = 'block';
        await loadEmployeeStats(employeeId, periodStart, periodEnd, today);
    }

    await loadBudgetSummary(userId);
}

async function loadEmployeeStats(employeeId, periodStart, periodEnd, today) {
    // Current daily rate via the Stage 3 helper function
    const { data: rate } = await supabaseClient.rpc('get_applicable_rate', {
        p_employee_id: employeeId, p_date: today,
    });
    document.getElementById('d-rate').textContent = rate != null ? '₱' + Number(rate).toFixed(2) : 'Not set';

    // Estimated current salary: this period's payroll_records row, if calculated yet
    const { data: period } = await supabaseClient
        .from('payroll_periods')
        .select('id')
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle();

    if (period) {
        const { data: record } = await supabaseClient
            .from('payroll_records')
            .select('net_pay')
            .eq('employee_id', employeeId)
            .eq('payroll_period_id', period.id)
            .maybeSingle();
        document.getElementById('d-estimated').textContent = record ? '₱' + Number(record.net_pay).toFixed(2) : 'Not yet calculated';
    } else {
        document.getElementById('d-estimated').textContent = 'Period not generated yet';
    }

    // Latest released salary (most recent RELEASED record for this employee, any period)
    const { data: latest } = await supabaseClient
        .from('payroll_records')
        .select('net_pay, payroll_periods(period_end)')
        .eq('employee_id', employeeId)
        .eq('status', 'RELEASED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    document.getElementById('d-latest-released').textContent = latest ? '₱' + Number(latest.net_pay).toFixed(2) : 'None yet';

    // Attendance summary for the current period
    const { data: attendance } = await supabaseClient
        .from('attendance')
        .select('status, overtime_hours')
        .eq('employee_id', employeeId)
        .gte('date', periodStart)
        .lte('date', periodEnd);

    const present = (attendance || []).filter(a => a.status === 'Present').length;
    const absent = (attendance || []).filter(a => a.status === 'Absent').length;
    const totalOt = (attendance || []).reduce((sum, a) => sum + Number(a.overtime_hours || 0), 0);

    document.getElementById('d-present').textContent = present;
    document.getElementById('d-absent').textContent = absent;
    document.getElementById('d-overtime').textContent = totalOt.toFixed(2) + ' hrs';
}

async function loadBudgetSummary(userId) {
    const { data: income } = await supabaseClient
        .from('income').select('amount').eq('created_by', userId);
    const { data: expenses } = await supabaseClient
        .from('expenses').select('amount').eq('created_by', userId);

    const totalIncome = (income || []).reduce((sum, i) => sum + Number(i.amount), 0);
    const totalExpenses = (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);

    document.getElementById('d-income').textContent = '₱' + totalIncome.toFixed(2);
    document.getElementById('d-expenses').textContent = '₱' + totalExpenses.toFixed(2);
    document.getElementById('d-remaining').textContent = '₱' + (totalIncome - totalExpenses).toFixed(2);
}
