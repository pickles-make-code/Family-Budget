import { useState, useRef, useEffect, useCallback } from 'react'
import { db } from './firebase'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'

// ─── Constants ────────────────────────────────────────────────────────────────

const INCOME = 4537.92
const FORTNIGHTLY_INCOME = INCOME / 2
const DOC_ID = 'my-budget'

const initialCategories = [
  { id: 'housing',   label: 'Housing',          icon: '🏠', color: '#e07b54', items: [{ name: 'Rent / Mortgage', amount: 1100 }] },
  { id: 'transport', label: 'Transportation',    icon: '🚗', color: '#d4a843', items: [{ name: 'Car Payment', amount: 350 }, { name: 'Car Insurance', amount: 120 }, { name: 'Gas', amount: 80 }] },
  { id: 'utilities', label: 'Utilities & Phone', icon: '💡', color: '#5b9bd5', items: [{ name: 'Electric / Gas', amount: 120 }, { name: 'Internet', amount: 60 }, { name: 'Phone', amount: 60 }] },
  { id: 'groceries', label: 'Groceries & Food',  icon: '🛒', color: '#6ab187', items: [{ name: 'Groceries', amount: 300 }, { name: 'Dining Out', amount: 100 }] },
  { id: 'debt',      label: 'Debt Payments',     icon: '📉', color: '#c0656a', items: [{ name: 'Minimum Payments', amount: 250 }, { name: 'Extra Debt Payment', amount: 200 }] },
  { id: 'baby',      label: 'Baby Fund',         icon: '👶', color: '#b07fc4', items: [{ name: 'Baby Savings', amount: 200 }] },
  { id: 'personal',  label: 'Personal Savings',  icon: '🏦', color: '#4ab8c4', items: [{ name: 'Emergency Fund', amount: 150 }] },
  { id: 'spending',  label: 'Spending Money',    icon: '💸', color: '#e8a87c', items: [{ name: 'Entertainment', amount: 80 }, { name: 'Personal Care', amount: 50 }, { name: 'Miscellaneous', amount: 80 }] },
]

const initialDebts = [
  { id: 1, name: 'Credit Card',   originalBalance: 4500, currentBalance: 4500, minPayment: 90,  paid: false },
  { id: 2, name: 'Personal Loan', originalBalance: 8000, currentBalance: 8000, minPayment: 160, paid: false },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) { return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }) }

// Get the current fortnightly period key (e.g. "2026-W03") based on pay Tuesday
function getFortnightKey() {
  const now = new Date()
  // Find most recent Tuesday
  const day = now.getDay() // 0=Sun, 2=Tue
  const diff = (day >= 2) ? day - 2 : day + 5
  const lastTuesday = new Date(now)
  lastTuesday.setDate(now.getDate() - diff)
  lastTuesday.setHours(0, 0, 0, 0)
  // Fortnight number: days since epoch / 14
  const epochDays = Math.floor(lastTuesday.getTime() / (1000 * 60 * 60 * 24))
  const fortnightNum = Math.floor(epochDays / 14)
  return `fortnight-${fortnightNum}`
}

function getFortnightDates() {
  const now = new Date()
  const day = now.getDay()
  const diff = (day >= 2) ? day - 2 : day + 5
  const start = new Date(now)
  start.setDate(now.getDate() - diff)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 13)
  const opts = { day: 'numeric', month: 'short' }
  return `${start.toLocaleDateString('en-AU', opts)} – ${end.toLocaleDateString('en-AU', opts)}`
}

function AutoInput({ value, onCommit, onCancel, style, placeholder }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input ref={ref} value={val} placeholder={placeholder}
      onChange={e => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={e => { if (e.key === 'Enter') onCommit(val); if (e.key === 'Escape') onCancel() }}
      style={style} />
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [categories, setCategories] = useState(initialCategories)
  const [debts, setDebts]           = useState(initialDebts)
  const [activeTab, setActiveTab]   = useState('budget')
  const [editing, setEditing]       = useState(null)
  const [hoveredItem, setHoveredItem] = useState(null)
  const [editingDebt, setEditingDebt] = useState(null)
  const [hoveredDebt, setHoveredDebt] = useState(null)
  const [payingDown, setPayingDown]   = useState(null)
  const [payAmount, setPayAmount]     = useState('')
  const [celebrating, setCelebrating] = useState(null)
  const [syncStatus, setSyncStatus]   = useState('loading')

  // Fortnightly checklist state: { [fortnightKey]: { [itemKey]: bool } }
  const [fortnightChecks, setFortnightChecks] = useState({})

  const nextDebtId   = useRef(100)
  const saveTimeout  = useRef(null)
  const isFirstLoad  = useRef(true)

  const currentFortnightKey = getFortnightKey()

  // ── Firebase: load ────────────────────────────────────────────────────────
  useEffect(() => {
    const ref = doc(db, 'budgets', DOC_ID)
    const unsub = onSnapshot(ref,
      snap => {
        if (snap.exists()) {
          const data = snap.data()
          if (isFirstLoad.current) {
            if (data.categories) setCategories(data.categories)
            if (data.debts) {
              setDebts(data.debts)
              const maxId = Math.max(...data.debts.map(d => d.id), 99)
              nextDebtId.current = maxId + 1
            }
            if (data.fortnightChecks) setFortnightChecks(data.fortnightChecks)
            isFirstLoad.current = false
          }
          setSyncStatus('synced')
        } else {
          isFirstLoad.current = false
          saveToFirebase(initialCategories, initialDebts, {})
        }
      },
      err => { console.error(err); setSyncStatus('error'); isFirstLoad.current = false }
    )
    return () => unsub()
  }, [])

  // ── Firebase: save ────────────────────────────────────────────────────────
  const saveToFirebase = useCallback((cats, dts, checks) => {
    setSyncStatus('saving')
    clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, 'budgets', DOC_ID), {
          categories: cats, debts: dts, fortnightChecks: checks,
          updatedAt: new Date().toISOString()
        })
        setSyncStatus('synced')
      } catch (e) { console.error(e); setSyncStatus('error') }
    }, 800)
  }, [])

  useEffect(() => {
    if (!isFirstLoad.current) saveToFirebase(categories, debts, fortnightChecks)
  }, [categories, debts, fortnightChecks, saveToFirebase])

  // ── Derived budget values ─────────────────────────────────────────────────
  const totalSpent    = categories.flatMap(c => c.items).reduce((s, i) => s + i.amount, 0)
  const remaining     = INCOME - totalSpent
  const pct           = Math.min(100, (totalSpent / INCOME) * 100)
  const barColor      = remaining < 0 ? '#c0656a' : remaining < 100 ? '#d4a843' : '#6ab187'
  const debtMonthly   = categories.find(c => c.id === 'debt')?.items.reduce((s, i) => s + i.amount, 0) || 0
  const babyTotal     = categories.find(c => c.id === 'baby')?.items.reduce((s, i) => s + i.amount, 0) || 0
  const savingsTotal  = categories.find(c => c.id === 'personal')?.items.reduce((s, i) => s + i.amount, 0) || 0
  const spendingTotal = categories.find(c => c.id === 'spending')?.items.reduce((s, i) => s + i.amount, 0) || 0

  // ── Derived debt values ───────────────────────────────────────────────────
  const activeDebts     = debts.filter(d => !d.paid)
  const paidDebts       = debts.filter(d => d.paid)
  const totalOwed       = activeDebts.reduce((s, d) => s + d.currentBalance, 0)
  const totalOriginal   = debts.reduce((s, d) => s + d.originalBalance, 0)
  const overallProgress = totalOriginal > 0 ? ((totalOriginal - totalOwed) / totalOriginal) * 100 : 0

  // ── Fortnightly checklist helpers ─────────────────────────────────────────
  const currentChecks = fortnightChecks[currentFortnightKey] || {}

  // Items that auto-deduct from a named debt when ticked (and add back when unticked)
  const DEBT_LINKED_ITEMS = {
    'transport__Car Rego':      'Car',
    'transport__Car Insurance': 'Car',
  }

  function toggleCheck(itemKey, fortnightAmount) {
    const wasChecked = !!(fortnightChecks[currentFortnightKey] || {})[itemKey]
    const nowChecked = !wasChecked

    setFortnightChecks(prev => {
      const prevChecks = prev[currentFortnightKey] || {}
      return {
        ...prev,
        [currentFortnightKey]: { ...prevChecks, [itemKey]: nowChecked }
      }
    })

    // If linked to a debt, deduct when ticking, add back when unticking
    const linkedDebtName = DEBT_LINKED_ITEMS[itemKey]
    if (linkedDebtName) {
      setDebts(ds => ds.map(d => {
        if (d.name !== linkedDebtName || d.paid) return d
        const newBal = nowChecked
          ? Math.max(0, Math.round((d.currentBalance - fortnightAmount) * 100) / 100)
          : Math.min(d.originalBalance, Math.round((d.currentBalance + fortnightAmount) * 100) / 100)
        const nowPaid = newBal === 0
        if (nowPaid) {
          setCelebrating(d.id)
          setTimeout(() => setCelebrating(null), 3000)
        }
        return { ...d, currentBalance: newBal, paid: nowPaid }
      }))
    }
  }

  // Build fortnightly items from categories (halved monthly amounts)
  const fortnightItems = categories.flatMap(cat =>
    cat.items.map(item => ({
      key: `${cat.id}__${item.name}`,
      category: cat.label,
      icon: cat.icon,
      color: cat.color,
      name: item.name,
      fortnightAmount: Math.round((item.amount / 2) * 100) / 100,
    }))
  )

  const totalFortnightly   = fortnightItems.reduce((s, i) => s + i.fortnightAmount, 0)
  const checkedTotal       = fortnightItems.filter(i => currentChecks[i.key]).reduce((s, i) => s + i.fortnightAmount, 0)
  const uncheckedTotal     = totalFortnightly - checkedTotal
  const checkProgress      = totalFortnightly > 0 ? (checkedTotal / totalFortnightly) * 100 : 0
  const allDone            = fortnightItems.length > 0 && fortnightItems.every(i => currentChecks[i.key])

  // ── Budget helpers ────────────────────────────────────────────────────────
  function updateCat(catId, fn) { setCategories(cats => cats.map(c => c.id === catId ? fn(c) : c)) }

  function commitAmount(catId, itemIdx, raw) {
    const val = parseFloat(raw)
    if (!isNaN(val) && val >= 0)
      updateCat(catId, c => ({ ...c, items: c.items.map((it, i) => i === itemIdx ? { ...it, amount: Math.round(val * 100) / 100 } : it) }))
    setEditing(null)
  }
  function commitItemName(catId, itemIdx, raw) {
    const name = raw.trim()
    if (name) updateCat(catId, c => ({ ...c, items: c.items.map((it, i) => i === itemIdx ? { ...it, name } : it) }))
    setEditing(null)
  }
  function commitCatLabel(catId, raw) {
    const label = raw.trim()
    if (label) updateCat(catId, c => ({ ...c, label }))
    setEditing(null)
  }
  function addItem(catId) {
    setCategories(cats => {
      const updated = cats.map(c => c.id !== catId ? c : { ...c, items: [...c.items, { name: 'New Item', amount: 0 }] })
      const cat = updated.find(c => c.id === catId)
      setEditing({ type: 'itemName', catId, itemIdx: cat.items.length - 1 })
      return updated
    })
  }
  function deleteItem(catId, itemIdx) { updateCat(catId, c => ({ ...c, items: c.items.filter((_, i) => i !== itemIdx) })) }

  // ── Debt helpers ──────────────────────────────────────────────────────────
  function addDebt() {
    const id = nextDebtId.current++
    setDebts(ds => [...ds, { id, name: 'New Debt', originalBalance: 0, currentBalance: 0, minPayment: 0, paid: false }])
    setEditingDebt({ id, field: 'name' })
  }
  function commitDebtEdit(id, field, raw) {
    const val = field === 'name' ? raw.trim() : parseFloat(raw)
    if (field === 'name' && !val) { setEditingDebt(null); return }
    if (field !== 'name' && isNaN(val)) { setEditingDebt(null); return }
    setDebts(ds => ds.map(d => {
      if (d.id !== id) return d
      if (field === 'originalBalance') return { ...d, originalBalance: val, currentBalance: d.currentBalance === 0 ? val : Math.min(d.currentBalance, val) }
      if (field === 'currentBalance')  return { ...d, currentBalance: Math.min(val, d.originalBalance || val) }
      return { ...d, [field]: val }
    }))
    setEditingDebt(null)
  }
  function applyPayment(id) {
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) { setPayingDown(null); return }
    setDebts(ds => ds.map(d => {
      if (d.id !== id) return d
      const newBal = Math.max(0, Math.round((d.currentBalance - amount) * 100) / 100)
      if (newBal === 0) {
        setCelebrating(id); setTimeout(() => setCelebrating(null), 3000)
        return { ...d, currentBalance: 0, paid: true }
      }
      return { ...d, currentBalance: newBal }
    }))
    setPayingDown(null); setPayAmount('')
  }
  function markPaid(id) {
    setCelebrating(id); setTimeout(() => setCelebrating(null), 3000)
    setDebts(ds => ds.map(d => d.id !== id ? d : { ...d, currentBalance: 0, paid: true }))
  }
  function unmarkPaid(id) { setDebts(ds => ds.map(d => d.id !== id ? d : { ...d, paid: false })) }
  function removeDebt(id) { setDebts(ds => ds.filter(d => d.id !== id)) }

  // ── Shared styles ─────────────────────────────────────────────────────────
  const inputBase     = { background: '#1e2130', border: '1px solid #4a5070', borderRadius: 6, color: '#e8e2d9', fontSize: 13, padding: '3px 8px', outline: 'none', fontFamily: 'inherit' }
  const debtInputBase = { ...inputBase, border: '1px solid #c0656a88' }
  const syncLabel     = { loading: '⏳ Loading...', saving: '💾 Saving...', synced: '☁️ Synced', error: '⚠️ Sync error' }[syncStatus]
  const syncColor     = { loading: '#7a8099', saving: '#d4a843', synced: '#6ab187', error: '#c0656a' }[syncStatus]

  if (syncStatus === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', color: '#7a8099', fontSize: 16 }}>
        ⏳ Loading your budget...
      </div>
    )
  }

  // Group fortnightly items by category for display
  const grouped = fortnightItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = { icon: item.icon, color: item.color, items: [] }
    acc[item.category].items.push(item)
    return acc
  }, {})

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', fontFamily: "'Georgia', serif", color: '#e8e2d9', paddingBottom: 60 }}>

      {/* ── HEADER ── */}
      <div style={{ background: 'linear-gradient(135deg, #1a1d27 0%, #161924 100%)', borderBottom: '1px solid #2a2d3a', padding: '28px 24px 0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#7a8099', textTransform: 'uppercase', marginBottom: 5 }}>Monthly Budget</div>
              <div style={{ fontSize: 24, color: '#e8e2d9' }}>Your Family Plan</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: syncColor, marginBottom: 3 }}>{syncLabel}</div>
              <div style={{ fontSize: 11, color: '#7a8099', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Take-Home Income</div>
              <div style={{ fontSize: 26, color: '#6ab187', fontVariantNumeric: 'tabular-nums' }}>{fmt(INCOME)}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12, color: '#7a8099' }}>
              <span>Allocated: <span style={{ color: '#e8e2d9' }}>{fmt(totalSpent)}</span></span>
              <span>{remaining < 0 ? 'Over by ' : 'Unallocated: '}<span style={{ color: barColor, fontWeight: 'bold' }}>{fmt(Math.abs(remaining))}</span></span>
            </div>
            <div style={{ height: 6, background: '#2a2d3a', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}88, ${barColor})`, transition: 'width 0.4s ease' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {[
              { catId: 'debt',     val: debtMonthly,   icon: '📉', color: '#c0656a' },
              { catId: 'baby',     val: babyTotal,     icon: '👶', color: '#b07fc4' },
              { catId: 'personal', val: savingsTotal,  icon: '🏦', color: '#4ab8c4' },
              { catId: 'spending', val: spendingTotal, icon: '💸', color: '#e8a87c' },
            ].map(s => {
              const label = categories.find(c => c.id === s.catId)?.label || s.catId
              return (
                <div key={s.catId} style={{ background: '#1a1d27', border: `1px solid ${s.color}33`, borderRadius: 10, padding: '8px 12px', flex: '1 1 90px' }}>
                  <div style={{ fontSize: 10, color: '#7a8099', marginBottom: 2 }}>{s.icon} {label}</div>
                  <div style={{ fontSize: 15, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.val)}</div>
                </div>
              )
            })}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', marginTop: 18 }}>
            {[['budget', '📋 Budget'], ['fortnight', '📅 Fortnightly'], ['debts', '💳 Debts']].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                background: 'none', border: 'none',
                borderBottom: activeTab === id ? '2px solid #e8e2d9' : '2px solid transparent',
                color: activeTab === id ? '#e8e2d9' : '#7a8099',
                fontSize: 13, padding: '10px 16px', cursor: 'pointer', fontFamily: 'inherit',
                letterSpacing: '0.04em', transition: 'color 0.15s, border-color 0.15s',
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 16px 0' }}>

        {/* ══ BUDGET TAB ══ */}
        <div style={{ display: activeTab === 'budget' ? 'block' : 'none' }}>
          {remaining < 0 && <div style={{ background: '#c0656a22', border: '1px solid #c0656a55', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 14, color: '#e8b0b2' }}>⚠️ Over budget by <strong>{fmt(Math.abs(remaining))}</strong> — try reducing some amounts.</div>}
          {remaining > 50 && <div style={{ background: '#6ab18722', border: '1px solid #6ab18755', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 14, color: '#a8d5b8' }}>✅ <strong>{fmt(remaining)}</strong> unallocated — consider boosting your baby fund!</div>}

          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {categories.map(cat => {
              const catTotal = cat.items.reduce((s, i) => s + i.amount, 0)
              const isEditingLabel = editing?.type === 'catLabel' && editing.catId === cat.id
              return (
                <div key={cat.id} style={{ background: '#161924', border: `1px solid ${cat.color}33`, borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ background: `${cat.color}18`, borderBottom: `1px solid ${cat.color}33`, padding: '11px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 15 }}>{cat.icon}</span>
                      {isEditingLabel
                        ? <AutoInput value={cat.label} onCommit={v => commitCatLabel(cat.id, v)} onCancel={() => setEditing(null)} style={{ ...inputBase, fontSize: 14, flex: 1, border: `1px solid ${cat.color}88` }} />
                        : <div onClick={() => setEditing({ type: 'catLabel', catId: cat.id })}
                            style={{ fontSize: 14, color: cat.color, cursor: 'pointer', borderBottom: '1px dashed transparent', transition: 'border-color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            onMouseEnter={e => e.currentTarget.style.borderBottomColor = cat.color + '88'}
                            onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}>
                            {cat.label} <span style={{ fontSize: 9, opacity: 0.4, fontStyle: 'italic' }}>✎</span>
                          </div>
                      }
                    </div>
                    <div style={{ fontSize: 14, color: cat.color, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt(catTotal)}</div>
                  </div>
                  <div style={{ padding: '6px 0' }}>
                    {cat.items.map((item, idx) => {
                      const isEditAmt  = editing?.type === 'amount'   && editing.catId === cat.id && editing.itemIdx === idx
                      const isEditName = editing?.type === 'itemName' && editing.catId === cat.id && editing.itemIdx === idx
                      const isHov = hoveredItem?.catId === cat.id && hoveredItem?.itemIdx === idx
                      return (
                        <div key={idx}
                          onMouseEnter={() => setHoveredItem({ catId: cat.id, itemIdx: idx })}
                          onMouseLeave={() => setHoveredItem(null)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px 7px 16px', borderBottom: idx < cat.items.length - 1 ? '1px solid #1e2130' : 'none', gap: 8, background: isHov ? '#1e2130' : 'transparent', transition: 'background 0.1s' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {isEditName
                              ? <AutoInput value={item.name} placeholder="Item name" onCommit={v => commitItemName(cat.id, idx, v)} onCancel={() => setEditing(null)} style={{ ...inputBase, width: '100%', border: `1px solid ${cat.color}66` }} />
                              : <div onClick={() => setEditing({ type: 'itemName', catId: cat.id, itemIdx: idx })}
                                  style={{ fontSize: 13, color: '#b0b8cc', cursor: 'pointer', borderBottom: '1px dashed transparent', transition: 'border-color 0.15s, color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                  onMouseEnter={e => { e.currentTarget.style.borderBottomColor = '#b0b8cc55'; e.currentTarget.style.color = '#d0d8e8' }}
                                  onMouseLeave={e => { e.currentTarget.style.borderBottomColor = 'transparent'; e.currentTarget.style.color = '#b0b8cc' }}>
                                  {item.name}
                                </div>
                            }
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            {isEditAmt
                              ? <AutoInput value={String(item.amount)} onCommit={v => commitAmount(cat.id, idx, v)} onCancel={() => setEditing(null)} style={{ ...inputBase, width: 88, textAlign: 'right', border: `1px solid ${cat.color}88` }} />
                              : <div onClick={() => setEditing({ type: 'amount', catId: cat.id, itemIdx: idx })}
                                  style={{ fontSize: 13, color: '#e8e2d9', fontVariantNumeric: 'tabular-nums', cursor: 'pointer', padding: '3px 8px', borderRadius: 6, border: '1px solid transparent', transition: 'border 0.15s' }}
                                  onMouseEnter={e => e.currentTarget.style.borderColor = cat.color + '66'}
                                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                                  {fmt(item.amount)}
                                </div>
                            }
                            <button onClick={() => deleteItem(cat.id, idx)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isHov ? '#c0656a99' : 'transparent', fontSize: 12, padding: '2px 5px', lineHeight: 1, transition: 'color 0.15s' }}
                              onMouseEnter={e => e.currentTarget.style.color = '#c0656a'}
                              onMouseLeave={e => e.currentTarget.style.color = isHov ? '#c0656a99' : 'transparent'}>✕</button>
                          </div>
                        </div>
                      )
                    })}
                    <div style={{ padding: '7px 16px 5px' }}>
                      <button onClick={() => addItem(cat.id)}
                        style={{ background: 'none', border: `1px dashed ${cat.color}44`, borderRadius: 6, color: cat.color + '88', fontSize: 12, padding: '5px 12px', cursor: 'pointer', width: '100%', transition: 'border-color 0.15s, color 0.15s', fontFamily: 'inherit' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = cat.color + 'cc'; e.currentTarget.style.color = cat.color }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = cat.color + '44'; e.currentTarget.style.color = cat.color + '88' }}>
                        + Add item
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 32, padding: '18px 22px', background: '#161924', borderRadius: 14, border: '1px solid #2a2d3a', fontSize: 13, color: '#7a8099', lineHeight: 1.9 }}>
            <div style={{ color: '#b07fc4', marginBottom: 8, fontSize: 14 }}>👶 Baby on the way — a few tips:</div>
            <div>• Aim to build <span style={{ color: '#e8e2d9' }}>3–6 months of expenses</span> in your emergency fund before baby arrives.</div>
            <div>• Once debt is paid down, redirect those payments straight into your baby fund and savings.</div>
            <div>• <span style={{ color: '#e8e2d9' }}>Click any title, name, or amount</span> to edit it. All changes save automatically ☁️</div>
          </div>
        </div>

        {/* ══ FORTNIGHTLY TAB ══ */}
        <div style={{ display: activeTab === 'fortnight' ? 'block' : 'none' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#7a8099', textTransform: 'uppercase', marginBottom: 4 }}>Pay Period</div>
              <div style={{ fontSize: 22, color: '#e8e2d9' }}>📅 Fortnightly Checklist</div>
              <div style={{ fontSize: 12, color: '#7a8099', marginTop: 4 }}>Tue {getFortnightDates()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#7a8099', marginBottom: 2 }}>Fortnightly Pay</div>
              <div style={{ fontSize: 24, color: '#6ab187', fontVariantNumeric: 'tabular-nums' }}>{fmt(FORTNIGHTLY_INCOME)}</div>
            </div>
          </div>

          {/* Overall progress */}
          <div style={{ background: '#161924', borderRadius: 12, padding: '16px 20px', marginBottom: 20, border: '1px solid #2a2d3a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#7a8099' }}>
              <span style={{ color: allDone ? '#6ab187' : '#e8e2d9' }}>
                {allDone ? '🎉 All done for this fortnight!' : `${fortnightItems.filter(i => currentChecks[i.key]).length} of ${fortnightItems.length} items ticked off`}
              </span>
              <span>{fmt(checkedTotal)} paid / <span style={{ color: '#c0656a' }}>{fmt(uncheckedTotal)} remaining</span></span>
            </div>
            <div style={{ height: 10, background: '#2a2d3a', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 5,
                width: `${checkProgress}%`,
                background: allDone ? 'linear-gradient(90deg, #6ab18788, #6ab187)' : 'linear-gradient(90deg, #4ab8c488, #4ab8c4)',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>

          {/* Grouped checklist */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Object.entries(grouped).map(([catLabel, group]) => {
              const groupTotal = group.items.reduce((s, i) => s + i.fortnightAmount, 0)
              const groupDone  = group.items.every(i => currentChecks[i.key])
              return (
                <div key={catLabel} style={{ background: '#161924', border: `1px solid ${group.color}33`, borderRadius: 14, overflow: 'hidden' }}>
                  {/* Group header */}
                  <div style={{ background: `${group.color}18`, borderBottom: `1px solid ${group.color}33`, padding: '11px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15 }}>{group.icon}</span>
                      <span style={{ fontSize: 14, color: groupDone ? '#6ab187' : group.color, transition: 'color 0.3s' }}>
                        {catLabel} {groupDone && '✓'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: groupDone ? '#6ab187' : group.color, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(groupTotal)}
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ padding: '6px 0' }}>
                    {group.items.map(item => {
                      const checked = !!currentChecks[item.key]
                      return (
                        <div key={item.key}
                          onClick={() => toggleCheck(item.key, item.fortnightAmount)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px',
                            borderBottom: '1px solid #1e2130',
                            cursor: 'pointer',
                            background: checked ? '#1a2a1a' : 'transparent',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#1e2130' }}
                          onMouseLeave={e => { e.currentTarget.style.background = checked ? '#1a2a1a' : 'transparent' }}>

                          {/* Checkbox */}
                          <div style={{
                            width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                            border: checked ? `2px solid #6ab187` : `2px solid #3a4060`,
                            background: checked ? '#6ab187' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s',
                          }}>
                            {checked && <span style={{ color: '#0f1117', fontSize: 13, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                          </div>

                          {/* Name */}
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontSize: 13,
                              color: checked ? '#5a7a5a' : '#b0b8cc',
                              textDecoration: checked ? 'line-through' : 'none',
                              transition: 'color 0.2s',
                            }}>{item.name}</div>
                          </div>

                          {/* Amount */}
                          <div style={{
                            fontSize: 14, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                            color: checked ? '#5a7a5a' : '#e8e2d9',
                            textDecoration: checked ? 'line-through' : 'none',
                            transition: 'color 0.2s',
                          }}>{fmt(item.fortnightAmount)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Leftover card */}
          {(() => {
            const leftover = FORTNIGHTLY_INCOME - totalFortnightly
            const leftoverColor = leftover >= 0 ? '#6ab187' : '#c0656a'
            return (
              <div style={{ marginTop: 14, background: '#161924', borderRadius: 14, border: `1px solid ${leftoverColor}33`, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#7a8099', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                      {leftover >= 0 ? '💰 Leftover after all expenses' : '⚠️ Over fortnightly income by'}
                    </div>
                    <div style={{ fontSize: 12, color: '#7a8099' }}>
                      {fmt(FORTNIGHTLY_INCOME)} income − {fmt(totalFortnightly)} expenses
                    </div>
                  </div>
                  <div style={{ fontSize: 26, color: leftoverColor, fontVariantNumeric: 'tabular-nums', fontWeight: 'bold' }}>
                    {leftover >= 0 ? '' : '-'}{fmt(Math.abs(leftover))}
                  </div>
                </div>
                {leftover > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#7a8099' }}>
                    Tip: put this <span style={{ color: '#e8e2d9' }}>{fmt(leftover)}</span> toward your baby fund or extra debt payment 👶
                  </div>
                )}
              </div>
            )
          })()}

          {/* Reset button */}
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              onClick={() => setFortnightChecks(prev => ({ ...prev, [currentFortnightKey]: {} }))}
              style={{ background: 'none', border: '1px solid #2a2d3a', borderRadius: 8, color: '#7a8099', fontSize: 12, padding: '8px 20px', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.15s, color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a5070'; e.currentTarget.style.color = '#b0b8cc' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d3a'; e.currentTarget.style.color = '#7a8099' }}>
              ↺ Reset this fortnight's ticks
            </button>
          </div>

          <div style={{ marginTop: 16, padding: '14px 18px', background: '#161924', borderRadius: 12, border: '1px solid #2a2d3a', fontSize: 12, color: '#7a8099', lineHeight: 1.8 }}>
            <div>• Amounts shown are <span style={{ color: '#e8e2d9' }}>half your monthly budget</span> — what you need to set aside each pay.</div>
            <div>• Ticks reset automatically each new fortnight (every second Tuesday).</div>
            <div>• To change amounts, update them in the <span style={{ color: '#e8e2d9' }}>📋 Budget tab</span>.</div>
          </div>
        </div>

        {/* ══ DEBT TRACKER TAB ══ */}
        <div style={{ display: activeTab === 'debts' ? 'block' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#7a8099', textTransform: 'uppercase', marginBottom: 4 }}>Track & Pay Down</div>
              <div style={{ fontSize: 22, color: '#e8e2d9' }}>💳 Your Debts</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#7a8099', marginBottom: 2 }}>Total Remaining</div>
              <div style={{ fontSize: 24, color: '#c0656a', fontVariantNumeric: 'tabular-nums' }}>{fmt(totalOwed)}</div>
            </div>
          </div>

          {totalOriginal > 0 && (
            <div style={{ background: '#161924', borderRadius: 12, padding: '16px 20px', marginBottom: 18, border: '1px solid #2a2d3a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#7a8099' }}>
                <span>Overall — <span style={{ color: '#e8e2d9' }}>{overallProgress.toFixed(1)}% paid off</span></span>
                <span>{fmt(totalOriginal - totalOwed)} of {fmt(totalOriginal)} cleared</span>
              </div>
              <div style={{ height: 10, background: '#2a2d3a', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 5, width: `${overallProgress}%`, background: 'linear-gradient(90deg, #c0656a88, #e07b54)', transition: 'width 0.6s ease' }} />
              </div>
              {paidDebts.length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: '#6ab187' }}>🎉 {paidDebts.length} debt{paidDebts.length > 1 ? 's' : ''} fully paid off!</div>}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeDebts.map(debt => {
              const progress = debt.originalBalance > 0 ? ((debt.originalBalance - debt.currentBalance) / debt.originalBalance) * 100 : 0
              const progressColor = progress >= 75 ? '#6ab187' : progress >= 40 ? '#d4a843' : '#c0656a'
              const isHov = hoveredDebt === debt.id
              const isPaying = payingDown === debt.id
              const isCelebrating = celebrating === debt.id
              return (
                <div key={debt.id}
                  onMouseEnter={() => setHoveredDebt(debt.id)}
                  onMouseLeave={() => setHoveredDebt(null)}
                  style={{ background: isCelebrating ? '#6ab18715' : '#161924', border: `1px solid ${isCelebrating ? '#6ab18766' : '#c0656a33'}`, borderRadius: 14, padding: '18px 20px', transition: 'background 0.4s, border-color 0.4s' }}>
                  {isCelebrating && <div style={{ textAlign: 'center', fontSize: 20, marginBottom: 12 }}>🎉 Debt Paid Off! 🎉</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      {editingDebt?.id === debt.id && editingDebt.field === 'name'
                        ? <AutoInput value={debt.name} onCommit={v => commitDebtEdit(debt.id, 'name', v)} onCancel={() => setEditingDebt(null)} style={{ ...debtInputBase, fontSize: 15, width: '100%' }} />
                        : <div onClick={() => setEditingDebt({ id: debt.id, field: 'name' })}
                            style={{ fontSize: 15, color: '#e8e2d9', cursor: 'pointer', display: 'inline-block', borderBottom: '1px dashed transparent', transition: 'border-color 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.borderBottomColor = '#e8e2d944'}
                            onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}>
                            {debt.name} <span style={{ fontSize: 9, opacity: 0.4, fontStyle: 'italic' }}>✎</span>
                          </div>
                      }
                      <div style={{ fontSize: 11, color: '#7a8099', marginTop: 4 }}>
                        Min payment: {editingDebt?.id === debt.id && editingDebt.field === 'minPayment'
                          ? <AutoInput value={String(debt.minPayment)} onCommit={v => commitDebtEdit(debt.id, 'minPayment', v)} onCancel={() => setEditingDebt(null)} style={{ ...debtInputBase, fontSize: 11, width: 72, display: 'inline-block' }} />
                          : <span onClick={() => setEditingDebt({ id: debt.id, field: 'minPayment' })} style={{ color: '#b0b8cc', cursor: 'pointer', borderBottom: '1px dashed #b0b8cc44' }}>{fmt(debt.minPayment)}/mo</span>
                        }
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#7a8099', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Original</div>
                        {editingDebt?.id === debt.id && editingDebt.field === 'originalBalance'
                          ? <AutoInput value={String(debt.originalBalance)} onCommit={v => commitDebtEdit(debt.id, 'originalBalance', v)} onCancel={() => setEditingDebt(null)} style={{ ...debtInputBase, width: 90, textAlign: 'center' }} />
                          : <div onClick={() => setEditingDebt({ id: debt.id, field: 'originalBalance' })} style={{ fontSize: 13, color: '#7a8099', cursor: 'pointer', fontVariantNumeric: 'tabular-nums', borderBottom: '1px dashed #7a809944' }}>{fmt(debt.originalBalance)}</div>
                        }
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#7a8099', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Remaining</div>
                        {editingDebt?.id === debt.id && editingDebt.field === 'currentBalance'
                          ? <AutoInput value={String(debt.currentBalance)} onCommit={v => commitDebtEdit(debt.id, 'currentBalance', v)} onCancel={() => setEditingDebt(null)} style={{ ...debtInputBase, width: 90, textAlign: 'center' }} />
                          : <div onClick={() => setEditingDebt({ id: debt.id, field: 'currentBalance' })} style={{ fontSize: 17, color: '#c0656a', cursor: 'pointer', fontVariantNumeric: 'tabular-nums', fontWeight: 'bold', borderBottom: '1px dashed #c0656a44' }}>{fmt(debt.currentBalance)}</div>
                        }
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7a8099', marginBottom: 5 }}>
                      <span style={{ color: progress > 0 ? progressColor : '#7a8099' }}>{progress.toFixed(1)}% paid off</span>
                      <span>{fmt(debt.originalBalance - debt.currentBalance)} cleared</span>
                    </div>
                    <div style={{ height: 8, background: '#2a2d3a', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 4, width: `${progress}%`, background: `linear-gradient(90deg, ${progressColor}88, ${progressColor})`, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {isPaying ? (
                      <>
                        <span style={{ fontSize: 12, color: '#7a8099' }}>Payment: $</span>
                        <input autoFocus value={payAmount} onChange={e => setPayAmount(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') applyPayment(debt.id); if (e.key === 'Escape') setPayingDown(null) }}
                          placeholder="0.00" style={{ ...debtInputBase, width: 90, textAlign: 'right' }} />
                        <button onClick={() => applyPayment(debt.id)} style={{ background: '#6ab18722', border: '1px solid #6ab18766', borderRadius: 6, color: '#6ab187', fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>Apply ✓</button>
                        <button onClick={() => setPayingDown(null)} style={{ background: 'none', border: 'none', color: '#7a8099', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setPayingDown(debt.id); setPayAmount('') }}
                          style={{ background: '#c0656a22', border: '1px solid #c0656a55', borderRadius: 6, color: '#e8a0a4', fontSize: 12, padding: '5px 14px', cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#c0656a44'}
                          onMouseLeave={e => e.currentTarget.style.background = '#c0656a22'}>
                          💸 Make a Payment
                        </button>
                        <button onClick={() => markPaid(debt.id)}
                          style={{ background: '#6ab18722', border: '1px solid #6ab18755', borderRadius: 6, color: '#6ab187', fontSize: 12, padding: '5px 14px', cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#6ab18744'}
                          onMouseLeave={e => e.currentTarget.style.background = '#6ab18722'}>
                          ✓ Mark as Paid Off
                        </button>
                        {isHov && (
                          <button onClick={() => removeDebt(debt.id)}
                            style={{ background: 'none', border: 'none', color: '#c0656a55', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto', transition: 'color 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.color = '#c0656a'}
                            onMouseLeave={e => e.currentTarget.style.color = '#c0656a55'}>
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            <button onClick={addDebt}
              style={{ background: 'none', border: '1px dashed #c0656a44', borderRadius: 12, color: '#c0656a88', fontSize: 13, padding: '14px', cursor: 'pointer', width: '100%', fontFamily: 'inherit', transition: 'border-color 0.15s, color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#c0656acc'; e.currentTarget.style.color = '#c0656a' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#c0656a44'; e.currentTarget.style.color = '#c0656a88' }}>
              + Add a Debt
            </button>
          </div>

          {paidDebts.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 12, color: '#6ab187', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>🏆 Paid Off</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {paidDebts.map(debt => (
                  <div key={debt.id} style={{ background: '#161924', border: '1px solid #6ab18733', borderRadius: 10, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>✅</span>
                      <div>
                        <div style={{ fontSize: 14, color: '#7a8099', textDecoration: 'line-through' }}>{debt.name}</div>
                        <div style={{ fontSize: 11, color: '#6ab187' }}>{fmt(debt.originalBalance)} — fully cleared!</div>
                      </div>
                    </div>
                    <button onClick={() => unmarkPaid(debt.id)}
                      style={{ background: 'none', border: 'none', color: '#7a809966', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#b0b8cc'}
                      onMouseLeave={e => e.currentTarget.style.color = '#7a809966'}>
                      undo
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
