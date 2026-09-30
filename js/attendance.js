// js/attendance.js
// Monthly attendance list + single-day entry form. Requires supabaseClient.js and auth.js.

async function initAttendancePage() {
    const employeeSelect = document.getElementById('employee-select');
    const monthSelect = document.getElementById('month-select');

    const { data: employees, error } = await supabaseClient
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('is_active', 1)
        .order('last_name');

    if (error) {
        document.getElementById('error-box').textContent = 'Failed to load employees: ' + error.message;
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    employeeSelect.innerHTML = '<option value="">Select an employee...</option>' +
        employees.map(e => `<option value="${e.id}">${escapeHtml(e.last_name + ', ' + e.first_name)} (${escapeHtml(e.employee_code)})</option>`).join('');

    const now = new Date();
    monthSelect.value = now.toISOString().slice(0, 7);

    const reload = () => {
        if (employeeSelect.value && monthSelect.value) {
            loadAttendanceMonth(employeeSelect.value, monthSelect.value);
        }
    };

    employeeSelect.addEventListener('change', reload);
    monthSelect.addEventListener('change', reload);

    // Restore selection from URL if navigated back here
    const params = new URLSearchParams(window.location.search);
    if (params.get('employee_id')) employeeSelect.value = params.get('employee_id');
    if (params.get('month')) monthSelect.value = params.get('month');

    reload();
}

async function loadAttendanceMonth(employeeId, yearMonth) {
    const loading = document.getElementById('loading');
    const table = document.getElementById('attendance-table');
    const tbody = document.getElementById('attendance-tbody');
    const errorBox = document.getElementById('error-box');

    loading.style.display = 'block';
    table.style.display = 'none';
    errorBox.style.display = 'none';

    const [year, month] = yearMonth.split('-').map(Number);
    const startDate = `${yearMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

    const { data, error } = await supabaseClient
        .from('attendance')
        .select('date, day, scheduled_workday, status, time_in, time_out, regular_hours, overtime_hours')
        .eq('employee_id', employeeId)
        .gte('date', startDate)
        .lte('date', endDate);

    loading.style.display = 'none';

    if (error) {
        errorBox.textContent = 'Failed to load attendance: ' + error.message;
        errorBox.style.display = 'block';
        return;
    }

    const byDate = {};
    (data || []).forEach(r => { byDate[r.date] = r; });

    const rows = [];
    for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
        const dayName = new Date(year, month - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
        const isSunday = new Date(year, month - 1, d).getDay() === 0;
        const record = byDate[dateStr];

        const editUrl = `attendance-form.html?employee_id=${employeeId}&date=${dateStr}&month=${yearMonth}`;
        const canEdit = window.canEditAttendance;

        rows.push(`
            <tr>
                <td>${dateStr}</td>
                <td>${dayName}</td>
                <td>${isSunday ? 'Rest Day' : 'Workday'}</td>
                <td>${record ? escapeHtml(record.status) : '<span class="muted">—</span>'}</td>
                <td>${record?.time_in || '—'}</td>
                <td>${record?.time_out || '—'}</td>
                <td>${record ? Number(record.regular_hours).toFixed(2) : '—'}</td>
                <td>${record ? Number(record.overtime_hours).toFixed(2) : '—'}</td>
                <td>${canEdit ? `<a href="${editUrl}" class="btn btn-secondary" style="padding:4px 10px; font-size:0.8rem;">${record ? 'Edit' : 'Add'}</a>` : ''}</td>
            </tr>
        `);
    }

    tbody.innerHTML = rows.join('');
    table.style.display = 'table';
}

async function initAttendanceForm() {
    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get('employee_id');
    const date = params.get('date');
    const month = params.get('month') || (date ? date.slice(0, 7) : '');

    if (!employeeId || !date) {
        document.getElementById('error-box').textContent = 'Missing employee or date.';
        document.getElementById('error-box').style.display = 'block';
        return;
    }

    document.getElementById('back-link').href = `attendance.html?employee_id=${employeeId}&month=${month}`;

    const { data: employee } = await supabaseClient
        .from('employees')
        .select('first_name, last_name, employee_code')
        .eq('id', employeeId)
        .single();

    const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    const isSunday = new Date(date + 'T00:00:00').getDay() === 0;

    document.getElementById('context-line').textContent =
        (employee ? `${employee.first_name} ${employee.last_name} (${employee.employee_code})` : 'Employee') +
        ` — ${date} (${dayName}, ${isSunday ? 'Rest Day' : 'Scheduled Workday'})`;

    // Load existing record if one exists for this employee+date
    const { data: existing } = await supabaseClient
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('date', date)
        .maybeSingle();

    if (existing) {
        document.getElementById('form-title').textContent = 'Edit Attendance';
        document.getElementById('status').value = existing.status;
        document.getElementById('time_in').value = existing.time_in || '';
        document.getElementById('time_out').value = existing.time_out || '';
        document.getElementById('break_minutes').value = existing.break_minutes;
        document.getElementById('late_minutes').value = existing.late_minutes;
        document.getElementById('undertime_minutes').value = existing.undertime_minutes;
        document.getElementById('regular_hours').value = existing.regular_hours;
        document.getElementById('overtime_hours').value = existing.overtime_hours;
        document.getElementById('notes').value = existing.notes || '';
    } else if (isSunday) {
        document.getElementById('status').value = 'Rest Day';
    }

    const recalc = () => {
        const timeIn = document.getElementById('time_in').value;
        const timeOut = document.getElementById('time_out').value;
        const breakMin = parseFloat(document.getElementById('break_minutes').value) || 0;

        if (!timeIn || !timeOut) {
            document.getElementById('regular_hours').value = '0.00';
            return;
        }

        const [inH, inM] = timeIn.split(':').map(Number);
        const [outH, outM] = timeOut.split(':').map(Number);
        let minutesWorked = (outH * 60 + outM) - (inH * 60 + inM) - breakMin;
        if (minutesWorked < 0) minutesWorked += 24 * 60; // overnight shift

        const hoursWorked = minutesWorked / 60;
        const regular = Math.min(hoursWorked, 8);
        const autoOt = Math.max(hoursWorked - 8, 0);

        document.getElementById('regular_hours').value = regular.toFixed(2);
        if (!existing) {
            document.getElementById('overtime_hours').value = autoOt.toFixed(2);
        }
    };

    document.getElementById('time_in').addEventListener('change', recalc);
    document.getElementById('time_out').addEventListener('change', recalc);
    document.getElementById('break_minutes').addEventListener('input', recalc);
    recalc();

    document.getElementById('attendance-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitAttendance(employeeId, date, existing ? existing.id : null);
    });
}

async function submitAttendance(employeeId, date, existingId) {
    const errorBox = document.getElementById('error-box');
    const successBox = document.getElementById('success-box');
    const submitBtn = document.getElementById('submit-btn');

    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const payload = {
        employee_id: employeeId,
        date: date,
        status: document.getElementById('status').value,
        time_in: document.getElementById('time_in').value || null,
        time_out: document.getElementById('time_out').value || null,
        break_minutes: parseInt(document.getElementById('break_minutes').value) || 0,
        late_minutes: parseInt(document.getElementById('late_minutes').value) || 0,
        undertime_minutes: parseInt(document.getElementById('undertime_minutes').value) || 0,
        regular_hours: parseFloat(document.getElementById('regular_hours').value) || 0,
        overtime_hours: parseFloat(document.getElementById('overtime_hours').value) || 0,
        notes: document.getElementById('notes').value.trim() || null,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const session = await getSession();
    let result;

    if (existingId) {
        payload.updated_by = session.user.id;
        result = await supabaseClient
            .from('attendance')
            .update(payload)
            .eq('id', existingId)
            .select()
            .single();
    } else {
        payload.created_by = session.user.id;
        payload.updated_by = session.user.id;
        result = await supabaseClient
            .from('attendance')
            .insert(payload)
            .select()
            .single();
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Attendance';

    if (result.error) {
        errorBox.textContent = 'Save failed: ' + result.error.message;
        errorBox.style.display = 'block';
        return;
    }

    await logAudit(session.user.id, 'attendance_changed', `${date}: ${payload.status}`, result.data.id);

    successBox.textContent = 'Attendance saved.';
    successBox.style.display = 'block';
}
