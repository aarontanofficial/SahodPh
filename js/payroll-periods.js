// js/payroll-periods.js
// Dynamic weekly payroll period generation: Friday-Thursday cycle,
// cutoff = Thursday (inclusive), release = the following Saturday.
// Requires supabaseClient.js and auth.js.
//
// All date math below works on YYYY-MM-DD strings via UTC midnight,
// so it's never affected by the browser's local timezone offset
// (important since PH is UTC+8 - using local Date/toISOString()
// directly was silently shifting dates back by a day).

function todayDateStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Given a YYYY-MM-DD string, returns the Thursday (as YYYY-MM-DD) that
// ends the Friday-Thursday cycle containing that date.
function thursdayEndingCycleFor(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const dow = d.getUTCDay(); // Sun=0 ... Sat=6
    const daysUntilThursday = (4 - dow + 7) % 7; // Thu=4
    return addDays(dateStr, daysUntilThursday);
}

async function initPayrollPeriods() {
    await loadPeriods();

    document.getElementById('generate-btn').addEventListener('click', async () => {
        await generateNextPeriod();
    });
}

async function loadPeriods() {
    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('empty-state');
    const table = document.getElementById('periods-table');
    const tbody = document.getElementById('periods-tbody');

    loading.style.display = 'block';
    emptyState.style.display = 'none';
    table.style.display = 'none';

    const { data, error } = await supabaseClient
        .from('payroll_periods')
        .select('id, period_start, period_end, release_date, status')
        .order('period_end', { ascending: false });

    loading.style.display = 'none';

    if (error) {
        document.getElementById('error-box').textContent = 'Failed to load periods: ' + error.message;
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    if (!data || data.length === 0) {
        emptyState.textContent = 'No payroll periods yet. Click "Generate Next Period" to create the current one.';
        emptyState.style.display = 'block';
        return;
    }

    const today = todayDateStr();

    tbody.innerHTML = data.map(p => {
        const isCurrent = p.period_start <= today && today <= p.period_end;
        return `
            <tr ${isCurrent ? 'style="background:#e8f0fe;"' : ''}>
                <td>${p.period_start} &ndash; ${p.period_end}${isCurrent ? ' <strong>(current)</strong>' : ''}</td>
                <td>${p.period_end}</td>
                <td>${p.release_date}</td>
                <td>${escapeHtml(p.status)}</td>
                <td><a href="payroll-run.html?period_id=${p.id}" class="btn btn-secondary" style="padding:4px 10px; font-size:0.8rem;">Run Payroll</a></td>
            </tr>
        `;
    }).join('');

    table.style.display = 'table';
}

async function generateNextPeriod() {
    const errorBox = document.getElementById('error-box');
    const successBox = document.getElementById('success-box');
    const btn = document.getElementById('generate-btn');

    errorBox.style.display = 'none';
    successBox.style.display = 'none';
    btn.disabled = true;

    // Find the latest existing period, if any
    const { data: latest, error: fetchError } = await supabaseClient
        .from('payroll_periods')
        .select('period_end')
        .order('period_end', { ascending: false })
        .limit(1);

    if (fetchError) {
        errorBox.textContent = 'Failed to check existing periods: ' + fetchError.message;
        errorBox.style.display = 'block';
        btn.disabled = false;
        return;
    }

    let periodEnd;
    if (latest && latest.length > 0) {
        // Next cycle starts the day after the last one ended
        periodEnd = addDays(latest[0].period_end, 7);
    } else {
        // First period ever: the cycle containing today
        periodEnd = thursdayEndingCycleFor(todayDateStr());
    }

    const periodStart = addDays(periodEnd, -6);
    const releaseDate = addDays(periodEnd, 2);

    const session = await getSession();

    const { data, error } = await supabaseClient
        .from('payroll_periods')
        .insert({
            period_start: periodStart,
            period_end: periodEnd,
            release_date: releaseDate,
            status: 'OPEN',
            created_by: session.user.id,
        })
        .select()
        .single();

    btn.disabled = false;

    if (error) {
        errorBox.textContent = 'Failed to generate period: ' + error.message;
        errorBox.style.display = 'block';
        return;
    }

    await logAudit(session.user.id, 'payroll_period_generated',
        `${periodStart} to ${periodEnd}, release ${releaseDate}`, data.id);

    successBox.textContent = `Period generated: ${periodStart} to ${periodEnd} (release ${releaseDate}).`;
    successBox.style.display = 'block';

    await loadPeriods();
}
