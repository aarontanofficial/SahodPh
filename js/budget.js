// js/budget.js
// Personal income/expense tracking, scoped to the logged-in user.
// Requires supabaseClient.js and auth.js.

async function initBudgetPage() {
    await loadCategories();
    await refreshBudget();

    document.getElementById('expense-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addExpense();
    });
}

async function loadCategories() {
    const select = document.getElementById('exp-category');
    const { data, error } = await supabaseClient
        .from('budget_categories')
        .select('id, name')
        .order('name');

    if (error || !data) {
        select.innerHTML = '<option value="">Failed to load</option>';
        return;
    }

    select.innerHTML = data.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

async function refreshBudget() {
    const session = await getSession();

    const { data: income } = await supabaseClient
        .from('income')
        .select('id, amount, date, source_type, description')
        .eq('created_by', session.user.id)
        .order('date', { ascending: false });

    const { data: expenses } = await supabaseClient
        .from('expenses')
        .select('id, amount, date, description, budget_categories(name)')
        .eq('created_by', session.user.id)
        .order('date', { ascending: false });

    const totalIncome = (income || []).reduce((sum, i) => sum + Number(i.amount), 0);
    const totalExpenses = (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);
    const remaining = totalIncome - totalExpenses;

    document.getElementById('sum-income').textContent = '₱' + totalIncome.toFixed(2);
    document.getElementById('sum-expenses').textContent = '₱' + totalExpenses.toFixed(2);
    document.getElementById('sum-remaining').textContent = '₱' + remaining.toFixed(2);

    document.getElementById('income-tbody').innerHTML = (income && income.length > 0)
        ? income.map(i => `
            <tr>
                <td>${i.date}</td>
                <td>${escapeHtml(i.source_type)}</td>
                <td>₱${Number(i.amount).toFixed(2)}</td>
                <td>${escapeHtml(i.description || '—')}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="4" class="muted">No income recorded yet.</td></tr>';

    document.getElementById('expenses-tbody').innerHTML = (expenses && expenses.length > 0)
        ? expenses.map(e => `
            <tr>
                <td>${e.date}</td>
                <td>${escapeHtml(e.budget_categories?.name || '—')}</td>
                <td>₱${Number(e.amount).toFixed(2)}</td>
                <td>${escapeHtml(e.description || '—')}</td>
                <td><button type="button" class="btn btn-secondary" style="padding:2px 8px;" onclick="removeExpense('${e.id}')">Remove</button></td>
            </tr>
        `).join('')
        : '<tr><td colspan="5" class="muted">No expenses recorded yet.</td></tr>';
}

async function addExpense() {
    const errorBox = document.getElementById('error-box');
    const successBox = document.getElementById('success-box');
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const amount = parseFloat(document.getElementById('exp-amount').value);
    const categoryId = document.getElementById('exp-category').value;
    const date = document.getElementById('exp-date').value;
    const description = document.getElementById('exp-description').value.trim() || null;

    if (isNaN(amount) || amount <= 0 || !categoryId || !date) {
        errorBox.textContent = 'Please fill in amount, category, and date.';
        errorBox.style.display = 'block';
        return;
    }

    const session = await getSession();

    const { error } = await supabaseClient.from('expenses').insert({
        amount, category_id: categoryId, date, description,
        created_by: session.user.id,
    });

    if (error) {
        errorBox.textContent = 'Failed to add expense: ' + error.message;
        errorBox.style.display = 'block';
        return;
    }

    await logAudit(session.user.id, 'expense_created', description || '', null);

    successBox.textContent = 'Expense added.';
    successBox.style.display = 'block';
    document.getElementById('expense-form').reset();
    document.getElementById('exp-date').valueAsDate = new Date();

    await refreshBudget();
}

async function removeExpense(id) {
    const session = await getSession();
    const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
    if (error) { alert('Failed: ' + error.message); return; }
    await logAudit(session.user.id, 'expense_removed', id, null);
    await refreshBudget();
}
