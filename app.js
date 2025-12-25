/**
 * ================================================================
 * GURUKUL ERP - CONTROLLER V2.0 (SECURE)
 * Features: Login, BG Sync, Gender Icons, Date Formatter
 * ================================================================
 */

// ================= 1. CONFIGURATION =================

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzDe35Sh55Wqqtg0OiNJp0Tt4-iTYW8YTIgHrg7EBbiEyNxttl4afErxXr49aLe4_4sXQ/exec";
const APP_NAME = "Gurukul Digital Library";

const MALE_ICON = "https://cdn-icons-png.flaticon.com/512/1999/1999625.png";
const FEMALE_ICON = "https://cdn-icons-png.flaticon.com/512/6997/6997662.png";

// ================= 2. STATE MANAGEMENT =================

let libData = JSON.parse(localStorage.getItem('gdl_db')) || {
    students: [],
    payments: [],
    expenses: []
};
let lastSyncTime = parseInt(localStorage.getItem('gdl_last_sync')) || 0;
let syncQueue = JSON.parse(localStorage.getItem('gdl_queue')) || [];
let currentUser = JSON.parse(localStorage.getItem('gdl_user')) || null; // Stores Session
let currentStudentId = null;

// ================= 3. INITIALIZATION =================

window.onload = function() {
    initTheme();

    // 1. Auth Check
    if (!currentUser) {
        showLoginScreen();
    } else {
        initApp();
    }
};

function initApp() {
    // Hide Login, Show App
    const loginView = document.getElementById('loginView');
    const mainApp = document.getElementById('mainAppLayout');

    if (loginView) loginView.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';

    setupEventListeners();
    updateWelcomeMessage();
    setupHistoryHandling();

    // Initial Render
    navTo('dashboard');

    // Sync triggers
    if (navigator.onLine) syncData();

    // Set Input Dates to Today
    setTodayDateInput('admDate');
    setTodayDateInput('expDate');

    // Apply Role Restrictions
    applyRolePermissions();
}

function setupEventListeners() {
    // Search Listener
    let timeout = null;
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keyup', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => renderStudentList(), 300);
        });
    }

    // Live Balance Calc
    const payInput = document.getElementById('payInputAmount');
    if (payInput) payInput.addEventListener('input', updateLiveBalanceUI);
}

// ================= 4. AUTHENTICATION SYSTEM =================

async function handleLogin() {
    const u = document.getElementById('loginId').value.trim();
    const p = document.getElementById('loginPass').value.trim();
    const btn = document.getElementById('btnLogin');

    if (!u || !p) return showToast("Enter ID & Password", "error");

    // UI Loading State
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verifying...';
    btn.disabled = true;

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'login',
                data: {
                    username: u,
                    password: p
                }
            })
        });
        const json = await res.json();

        if (json.status === 'success') {
            currentUser = json.user; // { name: "Amit", role: "Admin" }
            localStorage.setItem('gdl_user', JSON.stringify(currentUser));
            showToast("Login Successful", "success");
            initApp();
        } else {
            showToast(json.message, "error");
            btn.innerHTML = 'Login Securely <i class="fas fa-arrow-right"></i>';
            btn.disabled = false;
        }
    } catch (e) {
        showToast("Connection Error", "error");
        btn.innerHTML = 'Login Securely <i class="fas fa-arrow-right"></i>';
        btn.disabled = false;
    }
}

function handleLogout() {
    if (!confirm("Logout from Device?")) return;
    localStorage.removeItem('gdl_user');
    currentUser = null;
    location.reload(); // Reload to clear memory
}

function showLoginScreen() {
    const loginView = document.getElementById('loginView');
    const mainApp = document.getElementById('mainAppLayout');
    if (loginView) loginView.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';
}

function updateWelcomeMessage() {
    const el = document.getElementById('welcomeMsg');
    if (!el || !currentUser) return;

    const hr = new Date().getHours();
    let greet = "Good Morning";
    if (hr >= 12 && hr < 17) greet = "Good Afternoon";
    else if (hr >= 17) greet = "Good Evening";

    el.innerHTML = `${greet}, <span>${currentUser.name}</span>`;
}

function applyRolePermissions() {
    // Hide Elements based on Role
    if (currentUser.role === 'Staff') {
        document.body.classList.add('role-staff');
        // Specific checks for elements that might exist
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    } else {
        document.body.classList.remove('role-staff');
        // FIX: Don't force 'block'. Set to empty string '' so CSS (flex/none) takes over.
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = ''); 
    }
}

// ================= 5. SYNC ENGINE (BACKGROUND) =================

async function syncData() {
    updateSyncIcon('syncing');

    // 1. Process Queue
    if (syncQueue.length > 0) {
        const item = syncQueue[0];
        try {
            // Attach 'collectedBy' for payments if missing
            if (item.action === 'add_payment' && !item.data.collectedBy) {
                item.data.collectedBy = currentUser.name;
            }

            const res = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(item)
            });
            const json = await res.json();

            if (json.status === 'success') {
                if (item.action === 'add_payment' && json.txnId) {
                    const localP = libData.payments.find(p => p.timestamp === item.data.timestamp);
                    if (localP) localP.txnId = json.txnId;
                }
                syncQueue.shift();
                localStorage.setItem('gdl_queue', JSON.stringify(syncQueue));
                syncData(); // Recursive call
                return;
            }
        } catch (e) {
            updateSyncIcon('offline');
            return;
        }
    }

    // 2. Fetch Updates
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'sync_data',
                data: {
                    lastSync: lastSyncTime
                }
            })
        });
        const json = await res.json();

        if (json.status === 'success') {
            if (json.updates.students.length > 0 || json.updates.payments.length > 0 || json.updates.expenses.length > 0) {
                mergeDatasets(json.updates);
                lastSyncTime = json.serverTime;
                localStorage.setItem('gdl_last_sync', lastSyncTime);
                localStorage.setItem('gdl_db', JSON.stringify(libData));
                refreshCurrentView();
            }
            updateSyncIcon('idle'); // Green Tick or Cloud
        }
    } catch (e) {
        updateSyncIcon('offline');
    }
}

function updateSyncIcon(status) {
    const icon = document.getElementById('syncStatusIcon');
    if (!icon) return;

    if (status === 'syncing') {
        icon.className = 'fas fa-sync fa-spin text-primary';
    } else if (status === 'offline') {
        icon.className = 'fas fa-wifi-slash text-danger';
    } else {
        icon.className = 'fas fa-check-circle text-success';
        // Revert to cloud after 2 seconds
        setTimeout(() => {
            if (icon.className.includes('check')) icon.className = 'fas fa-cloud text-muted';
        }, 2000);
    }
}

function mergeDatasets(updates) {
    updates.students.forEach(newItem => {
        const idx = libData.students.findIndex(s => String(s.id) === String(newItem.id));
        if (idx > -1) libData.students[idx] = newItem;
        else libData.students.push(newItem);
    });
    updates.payments.forEach(newItem => {
        if (!libData.payments.find(p => p.txnId === newItem.txnId)) libData.payments.push(newItem);
    });
    if (updates.expenses) {
        updates.expenses.forEach(newItem => {
            if (!libData.expenses.find(e => e.expId === newItem.expId)) libData.expenses.push(newItem);
        });
    }
}

// ================= 6. NAVIGATION & UI =================

function navTo(sectionId) {
    closeSidebar();
    document.querySelectorAll('.view-section').forEach(s => {
        s.style.display = 'none';
        s.classList.remove('active');
    });

    const target = document.getElementById(sectionId);
    if (target) {
        target.style.display = 'block';
        setTimeout(() => target.classList.add('active'), 10);
    }

    // Sidebar Active State
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`button[onclick="navTo('${sectionId}')"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Section Logic
    if (sectionId === 'dashboard') renderDashboard();
    if (sectionId === 'dailyRegisterSection') renderDailyRegister();
    if (sectionId === 'seatMapSection') renderSeatMap();
    if (sectionId === 'financesSection') {
        // Staff Check
        if (currentUser.role === 'Staff') {
            showToast("Access Restricted", "error");
            navTo('dashboard');
            return;
        }
        renderFinances();
    }
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('active');
    document.querySelector('.app-overlay').classList.toggle('active');
}

function closeSidebar() {
    document.querySelector('.sidebar').classList.remove('active');
    document.querySelector('.app-overlay').classList.remove('active');
}

function toggleProfileMenu() {
    const menu = document.getElementById('profileDropdown');
    if (menu) menu.classList.toggle('show');
}

// ================= 7. DASHBOARD & LISTS =================

function renderDashboard() {
    renderStudentList();
}

function renderStudentList() {
    const q = document.getElementById('searchInput').value.toLowerCase();
    const filter = document.getElementById('shiftFilter') ? document.getElementById('shiftFilter').value : "All";
    const container = document.getElementById('studentListContainer');
    if (!container) return;
    container.innerHTML = '';

    const list = libData.students.filter(s => s.status === 'Active');
    const filtered = list.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(q) || s.seatNo.toString().includes(q);
        const matchesShift = filter === "All" || s.shift === filter;
        return matchesSearch && matchesShift;
    });

    // Sort by Seat No
    filtered.sort((a, b) => parseInt(a.seatNo) - parseInt(b.seatNo));

    filtered.forEach(s => {
        const ledger = calculateLedger(s);
        const bal = ledger.balance;

        // Gender Logic
        const avatarUrl = (s.gender === 'Female') ? FEMALE_ICON : MALE_ICON;

        let badgeClass = bal < 0 ? 'danger' : 'success';
        let badgeText = bal < 0 ? `Due: ₹${Math.abs(bal)}` : `Adv: ₹${bal}`;
        if (bal === 0) {
            badgeClass = 'success';
            badgeText = 'Clear';
        }

        const card = document.createElement('div');
        card.className = 'st-card';
        card.onclick = function() {
            openProfile(s.id);
        };

        card.innerHTML = `
            <img src="${avatarUrl}" class="st-avatar-img" alt="Icon">
            <div class="st-info">
                <div class="st-header"><h4>${s.name}</h4><span class="badge ${badgeClass}">${badgeText}</span></div>
                <p><i class="fas fa-chair"></i> Seat ${s.seatNo} • ${s.shift}</p>
            </div>
            <div class="st-arrow"><i class="fas fa-chevron-right"></i></div>
        `;
        container.appendChild(card);
    });
}

// ================= 8. DAILY REGISTER =================

function renderDailyRegister() {
    const container = document.getElementById('dailyRegContainer');
    if (!container) return;
    container.innerHTML = '';

    const todayISO = new Date().toISOString().split('T')[0];
    let todayColl = 0;
    const groups = {};

    // Sort Descending
    const sortedPay = [...libData.payments].sort((a, b) => parseDate(b.date) - parseDate(a.date));

    sortedPay.forEach(p => {
        const pDateISO = parseDate(p.date).toISOString().split('T')[0];
        if (pDateISO === todayISO) todayColl += parseInt(p.amount);

        // Group Key (DD/MM/YYYY)
        const dateKey = formatDateDisplay(p.date);
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(p);
    });

    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-box success">
                <small>Today's Collection</small>
                <h3>₹${todayColl}</h3>
                <i class="fas fa-calendar-day bg-icon"></i>
            </div>
             <div class="stat-box primary">
                <small>Total Transactions</small>
                <h3>${libData.payments.length}</h3>
                <i class="fas fa-list bg-icon"></i>
            </div>
        </div>
    `;

    Object.keys(groups).forEach(date => {
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.innerText = date; // Now DD/MM/YYYY
        container.appendChild(dateHeader);

        groups[date].forEach(p => {
            const row = document.createElement('div');
            row.className = 'txn-row';
            row.innerHTML = `
                <div class="txn-left">
                    <div class="txn-icon"><i class="fas fa-user"></i></div>
                    <div>
                        <h5>${p.studentName}</h5>
                        <small>By: ${p.collectedBy || 'Admin'}</small>
                    </div>
                </div>
                <div class="txn-right">
                    <span class="amount">+₹${p.amount}</span>
                    <small style="display:block; font-size:0.7rem; color:var(--text-muted)">${p.mode}</small>
                </div>
            `;
            container.appendChild(row);
        });
    });
}

// ================= 9. PROFILE & ACTIONS =================

function openProfile(id) {
    currentStudentId = String(id);
    const s = libData.students.find(x => String(x.id) === currentStudentId);
    if (!s) return;

    // Toggle Modes
    document.getElementById('profileViewMode').style.display = 'block';
    document.getElementById('profileEditMode').style.display = 'none';

    document.getElementById('p_name').innerText = s.name;
    document.getElementById('p_detail').innerText = `Seat: ${s.seatNo} | ${s.shift}`;
    document.getElementById('p_contact').href = `tel:${s.contact}`;

    // Set Avatar in Profile
    const pImg = document.getElementById('p_avatar_big');
    if (pImg) pImg.src = (s.gender === 'Female') ? FEMALE_ICON : MALE_ICON;

    const ledger = calculateLedger(s);
    renderBalanceUI(ledger.balance);

    // Mini Statement
    renderMiniStatement(s.id);

    // Setup Edit Form
    fillEditForm(s);

    // Role Check for Buttons
    const delBtn = document.getElementById('btnDeleteStudent');
    const editBtn = document.getElementById('btnEditStudent');

    if (currentUser.role === 'Staff') {
        if (delBtn) delBtn.style.display = 'none';
        if (editBtn) editBtn.style.display = 'none';
    } else {
        if (delBtn) delBtn.style.display = 'flex';
        if (editBtn) editBtn.style.display = 'flex';
    }

    document.getElementById('profileModal').classList.add('open');
}

function closeProfile() {
    document.getElementById('profileModal').classList.remove('open');
    document.getElementById('monthBreakdownBox').style.display = 'none';
}

async function makePayment() {
    const amtInput = document.getElementById('payInputAmount');
    const amt = amtInput.value;
    if (!amt || amt <= 0) return showToast("Invalid Amount", "error");

    const s = libData.students.find(x => String(x.id) === String(currentStudentId));

    // Prepare Data
    const payData = {
        studentId: s.id,
        studentName: s.name,
        amount: amt,
        month: getCurrentMonthName(),
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now(),
        mode: 'Cash',
        collectedBy: currentUser.name // Track who took money
    };

    // Optimistic UI
    libData.payments.push({ ...payData,
        txnId: 'WAITING...'
    });
    localStorage.setItem('gdl_db', JSON.stringify(libData));

    showToast("Payment Success", "success");
    amtInput.value = '';
    closeProfile();
    renderStudentList();
    syncData(); // Trigger Sync

    // Attempt Send
    try {
        syncQueue.push({
            action: 'add_payment',
            data: payData
        });
        localStorage.setItem('gdl_queue', JSON.stringify(syncQueue));
        syncData();
    } catch (e) {}
}

function renderBalanceUI(balance) {
    const balEl = document.getElementById('p_balance');
    balEl.dataset.original = balance;

    const eyeIcon = `<i id="btnViewMonths" class="fas fa-eye" onclick="toggleMonthView()" style="font-size:0.5em; cursor:pointer; margin-left:10px; opacity:0.6"></i>`;

    if (balance < 0) balEl.innerHTML = `Due ₹${Math.abs(balance)} ${eyeIcon}`;
    else balEl.innerHTML = `<span style="color:var(--success)">Adv ₹${balance}</span> ${eyeIcon}`;
}

function toggleMonthView() {
    const s = libData.students.find(x => String(x.id) === currentStudentId);
    const ledger = calculateLedger(s);
    const box = document.getElementById('monthBreakdownBox');
    const list = document.getElementById('monthList');

    if (box.style.display === 'block') {
        box.style.display = 'none';
        return;
    }

    list.innerHTML = '';
    ledger.months.slice().reverse().forEach(m => {
        const color = m.status === 'Paid' ? 'var(--success)' : 'var(--danger)';
        list.innerHTML += `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:0.85rem;"><span>${m.name}</span><span style="color:${color}">${m.status}</span></div>`;
    });
    box.style.display = 'block';
}

function renderMiniStatement(sid) {
    const list = document.getElementById('miniStatementList');
    list.innerHTML = '';
    const txns = libData.payments.filter(p => String(p.studentId) === String(sid))
        .sort((a, b) => parseDate(b.date) - parseDate(a.date))
        .slice(0, 3);

    if (txns.length === 0) {
        list.innerHTML = '<small>No transactions yet.</small>';
        return;
    }

    txns.forEach(t => {
        list.innerHTML += `<div class="mini-txn"><span>${formatDateDisplay(t.date)}</span><b>₹${t.amount}</b></div>`;
    });
}

function updateLiveBalanceUI() {
    const payAmt = parseInt(document.getElementById('payInputAmount').value) || 0;
    const originalBal = parseInt(document.getElementById('p_balance').dataset.original) || 0;
    const newBal = originalBal + payAmt;
    const balEl = document.getElementById('p_balance');

    if (newBal < 0) balEl.innerHTML = `<span style="color:var(--danger)">Rem Due: ₹${Math.abs(newBal)}</span>`;
    else balEl.innerHTML = `<span style="color:var(--success)">New Adv: ₹${newBal}</span>`;
}

// ================= 10. SEAT MAP LOGIC =================

function renderSeatMap() {
    const container = document.getElementById('seatGridContainer');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 1; i <= 50; i++) {
        const info = getSeatStatus(i);
        const seatDiv = document.createElement('div');
        let cssClass = 'seat ';
        if (info.status === 'Free') cssClass += 'free';
        else if (info.status === 'Full') cssClass += 'full';
        else cssClass += 'partial';
        seatDiv.className = cssClass;
        seatDiv.innerText = i;
        seatDiv.onclick = () => openSeatModal(i, info);
        container.appendChild(seatDiv);
    }
}

function getSeatStatus(seatNo) {
    const occupants = libData.students.filter(s => s.status === 'Active' && String(s.seatNo) === String(seatNo));
    if (occupants.length === 0) return {
        status: 'Free',
        occupants: []
    };
    let slotsTaken = new Set();
    occupants.forEach(s => {
        if (s.shift === 'Full Day') {
            slotsTaken.add('M');
            slotsTaken.add('E');
            slotsTaken.add('N');
        }
        if (s.shift.includes('Morning')) slotsTaken.add('M');
        if (s.shift.includes('Evening')) slotsTaken.add('E');
        if (s.shift.includes('Night')) slotsTaken.add('N');
    });
    if (slotsTaken.size === 3) return {
        status: 'Full',
        occupants: occupants
    };
    return {
        status: 'Partial',
        occupants: occupants
    };
}

function openSeatModal(seatNo, info) {
    const modal = document.getElementById('seatModal');
    const list = document.getElementById('seatOccupantList');
    document.getElementById('seatModalTitle').innerText = `Seat ${seatNo}`;
    list.innerHTML = '';
    if (info.occupants.length === 0) {
        list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:15px;">Empty Seat</p><button onclick="navTo('admission');document.getElementById('admSeat').value='${seatNo}';closeSeatModal()" class="btn-submit">Book Seat</button>`;
    } else {
        info.occupants.forEach(s => {
            list.innerHTML += `<div class="mini-txn" onclick="closeSeatModal();openProfile('${s.id}')" style="cursor:pointer"><span style="font-weight:700">${s.name}</span><span class="badge primary">${s.shift}</span></div>`;
        });
    }
    modal.classList.add('open');
}

function closeSeatModal() {
    document.getElementById('seatModal').classList.remove('open');
}

// ================= 11. ADMISSIONS & STUDENT EDIT =================

function submitAdmission() {
    const name = document.getElementById('admName').value;
    if (!name) return showToast("Name Required", "error");
    const newS = {
        id: Date.now().toString(),
        joinDate: document.getElementById('admDate').value,
        name: name,
        fatherName: document.getElementById('admFather').value,
        contact: document.getElementById('admContact').value,
        seatNo: document.getElementById('admSeat').value,
        shift: document.getElementById('admShift').value,
        monthlyFee: document.getElementById('admFee').value,
        gender: document.getElementById('admGender').value,
        address: document.getElementById('admAddr').value,
        status: 'Active'
    };
    libData.students.push(newS);
    localStorage.setItem('gdl_db', JSON.stringify(libData));

    syncQueue.push({
        action: 'new_admission',
        data: newS
    });
    localStorage.setItem('gdl_queue', JSON.stringify(syncQueue));

    showToast("Admitted", "success");
    syncData();
    navTo('dashboard');

    document.querySelectorAll('#admission input').forEach(i => i.value = '');
    setTodayDateInput('admDate');
}

function confirmDeleteStudent() {
    if (!confirm("DELETE STUDENT?")) return;
    const idx = libData.students.findIndex(s => String(s.id) === String(currentStudentId));
    if (idx > -1) {
        libData.students[idx].status = 'Left';
        localStorage.setItem('gdl_db', JSON.stringify(libData));
    }
    syncQueue.push({
        action: 'delete_student',
        data: {
            id: currentStudentId
        }
    });
    localStorage.setItem('gdl_queue', JSON.stringify(syncQueue));

    showToast("Deleted", "success");
    closeProfile();
    syncData();
    renderStudentList();
}

async function saveStudentEdit() {
    const id = currentStudentId;
    const updatedData = {
        id: id,
        name: document.getElementById('editName').value,
        fatherName: document.getElementById('editFather').value,
        contact: document.getElementById('editContact').value,
        seatNo: document.getElementById('editSeat').value,
        shift: document.getElementById('editShift').value,
        monthlyFee: document.getElementById('editFee').value,
        joinDate: document.getElementById('editJoinDate').value,
        gender: document.getElementById('editGender').value,
        address: libData.students.find(x => x.id == id).address // Keep old address
    };

    const idx = libData.students.findIndex(s => String(s.id) === String(id));
    if (idx > -1) {
        libData.students[idx] = { ...libData.students[idx],
            ...updatedData
        };
        localStorage.setItem('gdl_db', JSON.stringify(libData));
    }

    showToast("Saving...", "info");
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'edit_student',
                data: updatedData
            })
        });
        showToast("Updated", "success");
    } catch (e) {
        syncQueue.push({
            action: 'edit_student',
            data: updatedData
        });
        localStorage.setItem('gdl_queue', JSON.stringify(syncQueue));
    }
    openProfile(id);
}

function fillEditForm(s) {
    document.getElementById('editName').value = s.name;
    document.getElementById('editFather').value = s.fatherName;
    document.getElementById('editContact').value = s.contact;
    document.getElementById('editSeat').value = s.seatNo;
    document.getElementById('editShift').value = s.shift;
    document.getElementById('editFee').value = s.monthlyFee;
    const d = parseDate(s.joinDate);
    document.getElementById('editJoinDate').value = d.toISOString().split('T')[0];
    const gSelect = document.getElementById('editGender');
    if (gSelect) gSelect.value = s.gender || 'Male';
}

function toggleEditMode() {
    document.getElementById('profileViewMode').style.display = 'none';
    document.getElementById('profileEditMode').style.display = 'block';
}

// ================= 12. FINANCES & UTILS =================

async function submitExpense() {
    const item = document.getElementById('expItem').value;
    const amt = document.getElementById('expAmount').value;
    const date = document.getElementById('expDate').value;
    if (!item || !amt) return showToast("Fill Fields", "error");

    const newExp = {
        expId: "EXP" + Date.now(),
        date: date,
        item: item,
        category: 'Gen',
        amount: amt,
        timestamp: Date.now()
    };
    libData.expenses.push(newExp);
    localStorage.setItem('gdl_db', JSON.stringify(libData));

    syncQueue.push({
        action: 'add_expense',
        data: newExp
    });
    localStorage.setItem('gdl_queue', JSON.stringify(syncQueue));

    showToast("Expense Saved", "success");
    syncData();
    renderFinances();
    document.getElementById('expItem').value = '';
    document.getElementById('expAmount').value = '';
}

function renderFinances() {
    const container = document.getElementById('expenseList');
    if (!container) return;
    const inc = libData.payments.reduce((s, p) => s + parseInt(p.amount), 0);
    const exp = libData.expenses.reduce((s, e) => s + parseInt(e.amount), 0);

    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-box success">
                <small>Income</small><h3>₹${inc}</h3>
            </div>
            <div class="stat-box danger">
                <small>Expense</small><h3>₹${exp}</h3>
            </div>
        </div>`;

    const sorted = [...libData.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
    sorted.forEach(e => {
        container.innerHTML += `
            <div class="txn-row">
                <div class="txn-left">
                    <h5>${e.item}</h5><small>${formatDateDisplay(e.date)}</small>
                </div>
                <div class="txn-right">
                    <span style="color:var(--danger)">-₹${e.amount}</span>
                </div>
            </div>`;
    });
}

// ================= 13. HELPER FUNCTIONS =================

function parseDate(dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    // Handle DD-MM-YYYY
    if (dateStr.includes('-') && dateStr.split('-')[0].length === 2) {
        const [d, m, y] = dateStr.split('-');
        return new Date(`${y}-${m}-${d}`);
    }
    return new Date(dateStr);
}

function formatDateDisplay(dateStr) {
    // Input: YYYY-MM-DD or DD-MM-YYYY -> Output: DD/MM/YYYY
    if (!dateStr) return "";
    let dObj = parseDate(dateStr);
    const d = String(dObj.getDate()).padStart(2, '0');
    const m = String(dObj.getMonth() + 1).padStart(2, '0');
    const y = dObj.getFullYear();
    return `${d}/${m}/${y}`;
}

function calculateLedger(student) {
    if (!student) return {
        due: 0,
        paid: 0,
        balance: 0,
        months: []
    };
    const fee = parseInt(student.monthlyFee) || 0;
    const joinDate = parseDate(student.joinDate);
    const today = new Date();
    let totalDue = 0;
    let monthList = [];

    let current = new Date(joinDate.getFullYear(), joinDate.getMonth(), 1);
    while (current <= today) {
        const monthName = current.toLocaleString('default', {
            month: 'short',
            year: 'numeric'
        });
        monthList.push({
            name: monthName,
            fee: fee,
            status: 'Pending'
        });
        totalDue += fee;
        current.setMonth(current.getMonth() + 1);
    }

    const payments = libData.payments.filter(p => String(p.studentId) === String(student.id));
    let totalPaid = payments.reduce((sum, p) => sum + parseInt(p.amount), 0);
    const totalPaidCopy = totalPaid;

    let remainingPay = totalPaid;
    monthList.forEach(m => {
        if (remainingPay >= m.fee) {
            m.status = 'Paid';
            remainingPay -= m.fee;
        } else if (remainingPay > 0) {
            m.status = `Part(${remainingPay})`;
            remainingPay = 0;
        }
    });

    return {
        totalDue,
        totalPaid: totalPaidCopy,
        balance: totalPaidCopy - totalDue,
        months: monthList
    };
}

function shareWhatsApp() {
    const s = libData.students.find(x => String(x.id) === String(currentStudentId));
    if (!s) return;
    const ledger = calculateLedger(s);
    let phone = s.contact.replace(/\D/g, '');
    if (phone.length === 10) phone = "91" + phone;
    const msg = encodeURIComponent(`*GURUKUL LIBRARY*\nHi ${s.name},\nFee Status:\nPaid: ₹${ledger.totalPaid}\nBalance: ₹${ledger.balance}\nPlease clear dues.`);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
}

function setTodayDateInput(id) {
    const el = document.getElementById(id);
    if (el) el.value = new Date().toISOString().split('T')[0];
}

function getCurrentMonthName() {
    return new Date().toLocaleString('default', {
        month: 'short'
    });
}

function showToast(msg, type = 'success') {
    const b = document.getElementById('toastBox');
    document.getElementById('toastMsg').innerText = msg;
    b.className = `show ${type}`;
    setTimeout(() => b.className = '', 3000);
}

function initTheme() {
    const saved = localStorage.getItem('gdl_theme') || 'light';
    document.body.setAttribute('data-theme', saved);
}

function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const newTheme = current === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('gdl_theme', newTheme);
    toggleProfileMenu(); // Close menu
}

function refreshCurrentView() {
    const activeSection = document.querySelector('.view-section.active');
    if (activeSection) {
        if (activeSection.id === 'dashboard') renderStudentList();
        if (activeSection.id === 'dailyRegisterSection') renderDailyRegister();
    }

}

// ================= 14. MOBILE BACK BUTTON HANDLING =================

function setupHistoryHandling() {
    // Jab user Back button dabaye
    window.addEventListener('popstate', function (event) {
        
        // 1. Agar koi Modal khula hai to use band karein
        const profileModal = document.getElementById('profileModal');
        const seatModal = document.getElementById('seatModal');

        if (profileModal && profileModal.classList.contains('open')) {
            // Close Profile Modal (UI Only)
            profileModal.classList.remove('open');
            document.getElementById('monthBreakdownBox').style.display = 'none';
            return;
        }

        if (seatModal && seatModal.classList.contains('open')) {
            // Close Seat Modal (UI Only)
            seatModal.classList.remove('open');
            return;
        }

        // 2. Agar user Dashboard par nahi hai, to Dashboard par wapas layein
        const activeSection = document.querySelector('.view-section.active');
        if (activeSection && activeSection.id !== 'dashboard') {
            navTo('dashboard'); // Dashboard par wapas jao
            return;
        }

        // 3. Agar Dashboard par hi hai, to App band hone dein (Default behavior)
    });
}

// Function to add history state when opening items
function pushHistoryState(hash) {
    history.pushState({ page: hash }, null, "#" + hash);
}

// --- EXISTING FUNCTIONS KO UPDATE KAREIN (Override) ---

// 1. Purane navTo ko overwrite karein taaki wo History me save kare
const originalNavTo = navTo;
navTo = function(sectionId) {
    originalNavTo(sectionId);
    // Sirf tab history add karein jab hum dashboard par NA ho
    if (sectionId !== 'dashboard') {
        pushHistoryState(sectionId);
    }
};

// 2. Purane openProfile ko overwrite karein
const originalOpenProfile = openProfile;
openProfile = function(id) {
    originalOpenProfile(id);
    pushHistoryState("profile");
};

// 3. Purane openSeatModal ko overwrite karein
const originalOpenSeatModal = openSeatModal;
openSeatModal = function(seatNo, info) {
    originalOpenSeatModal(seatNo, info);
    pushHistoryState("seatMap");
};

// 4. Modal Close buttons ko update karein
// Jab user "X" button dabaye, to humein history bhi back karni hogi
// taaki agli baar back button sahi kaam kare.

const originalCloseProfile = closeProfile;
closeProfile = function() {
    // Agar history me hash hai (#profile), to back karo
    if (location.hash === "#profile") {
        history.back(); // Ye automatic popstate trigger karega jo modal band karega
    } else {
        originalCloseProfile(); // Fallback
    }
};

const originalCloseSeatModal = closeSeatModal;
closeSeatModal = function() {
    if (location.hash === "#seatMap") {
        history.back();
    } else {
        originalCloseSeatModal();
    }
};
