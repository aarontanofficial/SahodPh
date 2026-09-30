// js/employees.js
// Employee list + add/edit form logic. Requires supabaseClient.js and auth.js.

async function loadEmployees(searchTerm) {
    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('empty-state');
    const table = document.getElementById('employees-table');
    const tbody = document.getElementById('employees-tbody');

    loading.style.display = 'block';
    emptyState.style.display = 'none';
    table.style.display = 'none';

    let query = supabaseClient
        .from('employees')
        .select('id, employee_code, first_name, middle_name, last_name, position, department, employment_status, date_hired, is_active')
        .order('last_name', { ascending: true });

    if (searchTerm) {
        const term = `%${searchTerm}%`;
        query = query.or(
            `first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term},department.ilike.${term},position.ilike.${term}`
        );
    }

    const { data, error } = await query;

    loading.style.display = 'none';

    if (error) {
        emptyState.textContent = 'Failed to load employees: ' + error.message;
        emptyState.style.display = 'block';
        return;
    }

    if (!data || data.length === 0) {
        emptyState.textContent = 'No employees found.';
        emptyState.style.display = 'block';
        return;
    }

    tbody.innerHTML = data.map(emp => {
        const fullName = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ');
        return `
            <tr onclick="window.location.href='employee-form.html?id=${emp.id}'">
                <td>${escapeHtml(emp.employee_code)}</td>
                <td>${escapeHtml(fullName)}</td>
                <td>${escapeHtml(emp.position || '-')}</td>
                <td>${escapeHtml(emp.department || '-')}</td>
                <td>${escapeHtml(emp.employment_status)}</td>
                <td>${escapeHtml(emp.date_hired)}</td>
                <td>${emp.is_active ? 'Yes' : 'No'}</td>
            </tr>
        `;
    }).join('');

    table.style.display = 'table';
}

async function initEmployeeForm() {
    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get('id');
    const form = document.getElementById('employee-form');
    const errorBox = document.getElementById('error-box');
    const successBox = document.getElementById('success-box');
    const submitBtn = document.getElementById('submit-btn');

    if (employeeId) {
        document.getElementById('form-title').textContent = 'Edit Employee';
        document.getElementById('employee-id').value = employeeId;

        const { data, error } = await supabaseClient
            .from('employees')
            .select('*')
            .eq('id', employeeId)
            .single();

        if (error || !data) {
            errorBox.textContent = 'Could not load employee record.';
            errorBox.style.display = 'block';
            form.style.display = 'none';
            return;
        }

        document.getElementById('employee_code').value = data.employee_code || '';
        document.getElementById('first_name').value = data.first_name || '';
        document.getElementById('middle_name').value = data.middle_name || '';
        document.getElementById('last_name').value = data.last_name || '';
        document.getElementById('contact_number').value = data.contact_number || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('address').value = data.address || '';
        document.getElementById('position').value = data.position || '';
        document.getElementById('department').value = data.department || '';
        document.getElementById('employment_status').value = data.employment_status || 'Regular';
        document.getElementById('date_hired').value = data.date_hired || '';
        document.getElementById('is_active').checked = !!data.is_active;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';
        successBox.style.display = 'none';

        const payload = {
            employee_code: document.getElementById('employee_code').value.trim() || null,
            first_name: document.getElementById('first_name').value.trim(),
            middle_name: document.getElementById('middle_name').value.trim() || null,
            last_name: document.getElementById('last_name').value.trim(),
            contact_number: document.getElementById('contact_number').value.trim() || null,
            email: document.getElementById('email').value.trim() || null,
            address: document.getElementById('address').value.trim() || null,
            position: document.getElementById('position').value.trim() || null,
            department: document.getElementById('department').value.trim() || null,
            employment_status: document.getElementById('employment_status').value,
            date_hired: document.getElementById('date_hired').value,
            is_active: document.getElementById('is_active').checked ? 1 : 0,
        };

        if (!payload.first_name || !payload.last_name || !payload.date_hired) {
            errorBox.textContent = 'First name, last name, and date hired are required.';
            errorBox.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const session = await getSession();
        let result;

        if (employeeId) {
            payload.updated_by = session.user.id;
            result = await supabaseClient
                .from('employees')
                .update(payload)
                .eq('id', employeeId)
                .select()
                .single();
        } else {
            payload.created_by = session.user.id;
            payload.updated_by = session.user.id;
            result = await supabaseClient
                .from('employees')
                .insert(payload)
                .select()
                .single();
        }

        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Employee';

        if (result.error) {
            errorBox.textContent = 'Save failed: ' + result.error.message;
            errorBox.style.display = 'block';
            return;
        }

        await logAudit(
            session.user.id,
            employeeId ? 'employee_updated' : 'employee_created',
            result.data.employee_code,
            result.data.id
        );

        successBox.textContent = 'Employee saved.';
        successBox.style.display = 'block';

        if (!employeeId) {
            setTimeout(() => {
                window.location.href = 'employee-form.html?id=' + result.data.id;
            }, 600);
        }
    });
}
