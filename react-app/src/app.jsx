import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight01Icon, ArrowUpRight01Icon, Building03Icon, Car01Icon,
  CheckmarkCircle02Icon, Home01Icon, Location01Icon, Menu01Icon,
  Search01Icon, Shield01Icon, UserCircleIcon, Wallet01Icon, StarIcon,
} from '@hugeicons/core-free-icons';
import { supabase, isConfigured } from './supabase.js';

const pageMotion = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
};

const nigerianStates = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
const MapCanvas = lazy(() => import('./RideMapCanvas.jsx'));
function formatMoneyKobo(amount, currency = 'NGN') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(Number(amount ?? 0) / 100)); }
  catch { return `${currency} ${Math.round(Number(amount ?? 0) / 100).toLocaleString()}`; }
}


function RideMapCanvas(props) {
  return <Suspense fallback={<div className="google-map-canvas map-loading" role="status">Loading the live map…</div>}><MapCanvas {...props} /></Suspense>;
}

function RidePlaceField({ label, value, onChange, onSelect, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [searchError, setSearchError] = useState('');
  const requestNumber = useRef(0);

  useEffect(() => {
    const currentRequest = ++requestNumber.current;
    if (value.trim().length < 3) { setSuggestions([]); setSearchError(''); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('place-search', { body: { query: value.trim() } });
        if (currentRequest === requestNumber.current) { setSuggestions(data?.places ?? []); setSearchError(error?.message || data?.error || ''); }
      } catch {
        if (currentRequest === requestNumber.current) { setSuggestions([]); setSearchError('Address search is unavailable. You can tap the map to choose a location.'); }
      }
    }, 380);
    return () => clearTimeout(timer);
  }, [value]);

  function choosePlace(place) {
    onSelect(place.label, place.point, { cityCode: place.cityCode, cityName: place.cityName });
    setSuggestions([]); setSearchError('');
  }

  return <div className="ride-place-field">
    <label className="field"><Icon icon={Location01Icon} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" required aria-label={label} /></label>
    {suggestions.length > 0 && <div className="place-suggestions" role="listbox" aria-label={`${label} suggestions`}>{suggestions.slice(0, 5).map((item, index) => <button type="button" role="option" key={`${item.label}-${index}`} onClick={() => choosePlace(item)}>{item.label}</button>)}</div>}
    {searchError && <small className="field-help">{searchError}</small>}
  </div>;
}

function Icon({ icon, size = 20, className = '' }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={className} />;
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 24 24" role="img" aria-label="Google" focusable="false">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.37c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.08 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.3 9.14 5.37 12 5.37z" />
  </svg>;
}

export function App() {
  const [page, setPage] = useState('home');
  const [user, setUser] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedProperty,setSelectedProperty]=useState(null);

  const sharedToken = new URLSearchParams(window.location.search).get('share');
  useEffect(() => { if (sharedToken) setPage('shared-ride'); }, [sharedToken]);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if(!user?.id||!isConfigured)return undefined;
    const channel=supabase.channel(`notification-delivery-${user.id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${user.id}`},
        ({new:notification})=>{deliverNotificationChannels(notification,user.id);})
      .subscribe();
    return()=>{supabase.removeChannel(channel);};
  },[user?.id]);

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference')
      ?? new URLSearchParams(window.location.search).get('trxref');
    if (!reference) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { if (attempts > 25) clearInterval(timer); return; }
      const { data, error } = await supabase.functions.invoke('verify-paystack-payment', { body: { reference } });
      if (error || data?.pending) { if (attempts > 25) clearInterval(timer); return; }
      clearInterval(timer);
      const url = new URL(window.location.href); url.searchParams.delete('reference'); url.searchParams.delete('trxref'); window.history.replaceState({}, '', url);
      const walletTopup=data?.wallet_topup||reference.startsWith('movara_wallet_');
      const cargoOrder=data?.cargo_order||reference.startsWith('movara_cargo_');
      setPage(walletTopup ? 'wallet' : cargoOrder ? 'logistics' : 'rides');
      setToast(data?.paid ? (walletTopup ? 'Wallet top up confirmed.' : cargoOrder ? 'Delivery payment confirmed. MoVara can now assign your courier.' : 'Payment confirmed. Your driver can start the trip.') : data?.error || 'Payment was not completed.');
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timeout);
  }, [toast]);

  const navigate = (next, params = {}) => { if (next === 'property') setSelectedProperty(params.propertyId ?? null); setPage(next); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const showToast = (message) => setToast(message);

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => navigate('home')} aria-label="MoVara home">
        <img src="/movara_logo.png" alt="MoVara" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
        <span className="brand-fallback">MoVara<span>.</span></span>
      </button>
      <nav className={mobileMenu ? 'nav open' : 'nav'}>
        <button className={page === 'rides' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('rides')}>Rides</button>
        <button className={page === 'logistics' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('logistics')}>Cargo</button>
        <button className={page === 'homes' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('homes')}>Find a home</button>
        <button className="nav-link" onClick={() => navigate('drive')}>Drive</button>
        <button className="nav-link" onClick={() => navigate('list')}>List property</button>
        {user && <button className="nav-link" onClick={() => navigate('notifications')}>Updates</button>}
        {user && <button className="nav-link" onClick={() => navigate('wallet')}>Wallet</button>}
        <button className="account-link" onClick={() => navigate(user ? 'account' : 'auth')}>
          <Icon icon={UserCircleIcon} size={19} /> {user ? 'My account' : 'Sign in'}
        </button>
      </nav>
      <button className="menu-toggle" aria-label="Toggle menu" onClick={() => setMobileMenu((open) => !open)}><Icon icon={Menu01Icon} size={22} /></button>
    </header>

    <main>
      <AnimatePresence mode="wait">
        {page === 'home' && <HomePage key="home" navigate={navigate} />}
        {page === 'rides' && <RidePage key="rides" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'logistics' && <LogisticsPage user={user} showToast={showToast} navigate={navigate} />}
        {page === 'homes' && <HomesPage key="homes" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'saved-homes' && <SavedHomesPage key="saved-homes" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'home-inbox' && <PropertyInboxPage key="home-inbox" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'landlord-properties' && <LandlordPropertiesPage key="landlord-properties" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'property' && <PropertyDetailPage key={`property-${selectedProperty}`} propertyId={selectedProperty} user={user} showToast={showToast} navigate={navigate} />}
        {page === 'auth' && <AuthPage key="auth" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'account' && <AccountPage key="account" user={user} navigate={navigate} showToast={showToast} />}
        {page === 'notifications' && <NotificationsPage key="notifications" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'wallet' && <WalletPage key="wallet" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'admin-pricing' && <AdminPricingPage key="admin-pricing" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'safety' && <SafetyCenterPage key="safety" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'admin-support' && <AdminSupportPage key="admin-support" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'admin-properties' && <AdminPropertyReviewPage key="admin-properties" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'admin-finance' && <AdminFinancePage key="admin-finance" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'shared-ride' && <SharedRidePage key="shared-ride" token={sharedToken} showToast={showToast} navigate={navigate} />}
        {page === 'drive' && <DrivePage key="drive" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'list' && <JoinPage key="list" kind="landlord" showToast={showToast} navigate={navigate} />}
      </AnimatePresence>
    </main>
    <footer className="footer"><span>MoVara</span><span>Move well. Live well.</span><span>© {new Date().getFullYear()} MoVara</span></footer>
    <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{toast}</motion.div>}</AnimatePresence>
  </div>;
}

function HomePage({ navigate }) {
  return <motion.div className="page" {...pageMotion}>
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow"><i /> LIFE, IN MOTION</span>
        <h1>Good days begin<br />with <em>getting there.</em></h1>
        <p>Book a ride, find a place to call home, and make your next move with confidence.</p>
        <div className="hero-actions"><button className="button primary" onClick={() => navigate('rides')}>Book a ride <Icon icon={ArrowRight01Icon} /></button><button className="button ghost" onClick={() => navigate('homes')}>Explore homes <Icon icon={ArrowUpRight01Icon} /></button></div>
        <div className="hero-note"><Icon icon={Shield01Icon} size={17} /> Thoughtful service, wherever life takes you.</div>
      </div>
      <div className="hero-visual">
        <img src="/home_hero.jpg" alt="Bright modern home with a welcoming living space" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
        <div className="visual-shade" />
        <motion.div className="floating-card ride-float" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3, duration: .55 }}><span className="float-icon"><Icon icon={Car01Icon} /></span><span><b>Your next ride</b><small>Close by when you need it</small></span><i className="live-dot" /></motion.div>
        <motion.div className="floating-card home-float" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .48, duration: .55 }}><span className="float-icon gold"><Icon icon={Home01Icon} /></span><span><b>Find your place</b><small>Homes that feel like yours</small></span><Icon icon={ArrowUpRight01Icon} size={18} /></motion.div>
        <div className="visual-caption"><span>01 / MOVE WITH EASE</span><span>Made for everyday life</span></div>
      </div>
    </section>
    <section className="service-section">
      <div className="section-head"><div><span className="eyebrow">A LITTLE MORE POSSIBILITY</span><h2>Life has places to go.</h2></div><p>Start with what you need today.<br />We’ll be here for what comes next.</p></div>
      <div className="service-grid">
        <ServiceCard icon={Car01Icon} number="01" title="Get there" text="A ride that fits your day, with a journey you can follow." onClick={() => navigate('rides')} />
        <ServiceCard icon={Home01Icon} number="02" title="Find your place" text="Explore homes and make your next chapter feel closer." onClick={() => navigate('homes')} />
        <ServiceCard icon={Building03Icon} number="03" title="Send or move goods" text="Book a delivery, receive a confirmed quote, and follow it from pickup to handoff." onClick={() => navigate('logistics')} />
        <ServiceCard icon={Building03Icon} number="04" title="Grow with us" text="Build your driving or property journey on MoVara." onClick={() => navigate('drive')} />
      </div>
    </section>
    <section className="quiet-banner"><span className="quiet-mark">M</span><div><span className="eyebrow">BUILT AROUND PEOPLE</span><h2>Good service should feel simple.</h2><p>Clear choices, thoughtful details, and support when you need it.</p></div><button className="text-action" onClick={() => navigate('auth')}>Get started <Icon icon={ArrowRight01Icon} /></button></section>
  </motion.div>;
}

const cargoServiceNames = { documents: 'Documents', parcel: 'Parcel delivery', food: 'Food and perishables', home_move: 'Home or office move', business_cargo: 'Business cargo' };
const cargoStatusNames = { requested: 'Request received', quoted: 'Quote ready', accepted: 'Awaiting payment', assigned: 'Courier assigned', picked_up: 'Picked up', in_transit: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', issue: 'Needs attention' };
const blankCargo = { recipientName: '', recipientPhone: '', serviceType: 'parcel', packageSize: 'small', packageCount: '1', weightKg: '', declaredValue: '', fragile: false, pickup: '', pickupCity: '', pickupRegion: '', destination: '', destinationCity: '', destinationRegion: '', pickupAt: '', contents: '', note: '' };

function LogisticsPage({ user, showToast, navigate }) {
  const [form, setForm] = useState(blankCargo);
  const [orders, setOrders] = useState([]);
  const [events, setEvents] = useState({});
  const [admin, setAdmin] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [pendingVehicles, setPendingVehicles] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState('');

  async function load() {
    if (!user || !isConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'administrator').maybeSingle();
    const isAdmin = Boolean(role); setAdmin(isAdmin);
    let query = supabase.from('cargo_orders').select('id,tracking_code,sender_id,recipient_name,recipient_phone,service_type,package_size,package_count,weight_kg,declared_value_ngn_kobo,fragile,pickup_label,pickup_city,pickup_region,destination_label,destination_city,destination_region,pickup_at,contents_description,sender_note,quote_amount_ngn_kobo,quote_note,status,payment_status,driver_id,vehicle_id,delivery_proof,issue_note,created_at,quoted_at,accepted_at,assigned_at,picked_up_at,delivered_at,cancelled_at').order('created_at', { ascending: false }).limit(isAdmin ? 150 : 50);
    if (!isAdmin) query = query.eq('sender_id', user.id);
    const [{ data, error }, { data: vehicleRows, error: vehicleError }, { data: pendingRows, error: pendingError }] = await Promise.all([
      query,
      isAdmin ? supabase.from('vehicles').select('id,driver_id,vehicle_type,make,model,registration_number').eq('verification', 'approved') : Promise.resolve({ data: [], error: null }),
      isAdmin ? supabase.from('vehicles').select('id,driver_id,vehicle_type,make,model,registration_number,capacity').eq('verification', 'pending').order('created_at') : Promise.resolve({ data: [], error: null }),
    ]);
    setLoading(false);
    if (error) showToast('Cargo requests could not be loaded. Refresh and try again.');
    if (vehicleError) showToast('Approved courier vehicles could not be loaded.');
    if (pendingError) showToast('Pending courier vehicles could not be loaded.');
    const list = data ?? []; setOrders(list); setVehicles(vehicleRows ?? []);
    let eligiblePending = pendingRows ?? [];
    if (eligiblePending.length) {
      const { data: approvedDrivers } = await supabase.from('driver_verifications').select('driver_id').in('driver_id', eligiblePending.map((item) => item.driver_id)).eq('status', 'approved');
      const ids = new Set((approvedDrivers ?? []).map((item) => item.driver_id)); eligiblePending = eligiblePending.filter((item) => ids.has(item.driver_id));
    }
    setPendingVehicles(eligiblePending);
    if (list.length) {
      const { data: eventRows, error: eventError } = await supabase.from('cargo_order_events').select('id,cargo_order_id,event_type,note,created_at').in('cargo_order_id', list.map((row) => row.id)).order('created_at', { ascending: false });
      if (!eventError) setEvents((eventRows ?? []).reduce((all, event) => ({ ...all, [event.cargo_order_id]: [...(all[event.cargo_order_id] ?? []), event] }), {}));
    }
  }

  useEffect(() => {
    if (!user) { setLoading(false); return undefined; }
    load();
    const channel = supabase.channel(`cargo-orders-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_orders' }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [user?.id]);

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  async function submit(event) {
    event.preventDefault();
    if (!user) { showToast('Sign in to request a delivery and follow it here.'); navigate('auth'); return; }
    if (!isConfigured) { showToast('Cargo booking is not connected to Supabase yet.'); return; }
    setBusy('create');
    const { data, error } = await supabase.rpc('cargo_create_request', {
      p_recipient_name: form.recipientName.trim(), p_recipient_phone: form.recipientPhone.trim(), p_service_type: form.serviceType,
      p_package_size: form.packageSize, p_package_count: Number(form.packageCount), p_weight_kg: Number(form.weightKg),
      p_declared_value_ngn_kobo: Math.round(Number(form.declaredValue || 0) * 100), p_fragile: form.fragile,
      p_pickup_label: form.pickup.trim(), p_pickup_city: form.pickupCity.trim(), p_pickup_region: form.pickupRegion.trim(),
      p_destination_label: form.destination.trim(), p_destination_city: form.destinationCity.trim(), p_destination_region: form.destinationRegion.trim(),
      p_pickup_at: form.pickupAt ? new Date(form.pickupAt).toISOString() : null,
      p_contents_description: form.contents.trim(), p_sender_note: form.note.trim() || null,
    });
    setBusy('');
    if (error || !data?.id) { showToast(error?.message || 'Your delivery request could not be saved.'); return; }
    setForm(blankCargo); showToast(`Request received. Your tracking code is ${data.tracking_code}.`); await load();
  }
  async function acceptQuote(order) {
    setBusy(order.id); const { error } = await supabase.rpc('customer_accept_cargo_quote', { p_order_id: order.id }); setBusy('');
    if (error) showToast(error.message || 'This quote could not be accepted.'); else { showToast('Quote accepted. Pay securely to release the delivery for dispatch.'); await load(); }
  }
  async function payOrder(order) {
    setBusy(order.id);
    const { data, error } = await supabase.functions.invoke('initialize-cargo-payment', { body: { cargoOrderId: order.id } });
    setBusy('');
    if (error || !data?.authorizationUrl) { showToast(data?.error || error?.message || 'Secure checkout could not start.'); return; }
    window.location.assign(data.authorizationUrl);
  }
  async function cancelOrder(order) {
    const { error } = await supabase.rpc('customer_cancel_cargo_order', { p_order_id: order.id, p_reason: 'Cancelled by sender.' });
    if (error) showToast(error.message || 'This request could not be cancelled.'); else { showToast('Delivery request cancelled.'); await load(); }
  }
  async function sendQuote(order) {
    const amount = Math.round(Number(quotes[order.id]?.amount) * 100); const note = quotes[order.id]?.note?.trim() || '';
    if (!Number.isSafeInteger(amount) || amount < 100) { showToast('Enter a valid delivery quote in naira.'); return; }
    setBusy(order.id); const { error } = await supabase.rpc('admin_quote_cargo_order', { p_order_id: order.id, p_amount_ngn_kobo: amount, p_note: note }); setBusy('');
    if (error) showToast(error.message || 'The quote could not be sent.'); else { showToast(`Quote sent for ${order.tracking_code}.`); await load(); }
  }
  async function assignCourier(order) {
    const choice = assignments[order.id] || ''; const [driverId, vehicleId] = choice.split('|');
    if (!driverId || !vehicleId) { showToast('Choose an approved courier and vehicle.'); return; }
    setBusy(order.id); const { error } = await supabase.rpc('admin_assign_cargo_order', { p_order_id: order.id, p_driver_id: driverId, p_vehicle_id: vehicleId, p_note: 'Assigned by MoVara dispatch.' }); setBusy('');
    if (error) showToast(error.message || 'Courier assignment failed.'); else { showToast('Courier assigned.'); await load(); }
  }
  async function cancelAsAdmin(order) {
    const { error } = await supabase.rpc('admin_cancel_cargo_order', { p_order_id: order.id, p_reason: 'Cancelled by MoVara operations. Contact support for assistance.' });
    if (error) showToast(error.message || 'Operations could not cancel this delivery.'); else { showToast('Delivery cancelled.'); await load(); }
  }
  async function reviewCargoVehicle(vehicle, status) {
    setBusy(vehicle.id);
    const { error } = await supabase.rpc('admin_review_identity', { p_subject_type: 'vehicle', p_subject_id: vehicle.id, p_status: status, p_reason: status === 'approved' ? 'Cargo vehicle documents reviewed and approved.' : 'Vehicle details need correction. Contact MoVara support.' });
    setBusy('');
    if (error) showToast(error.message || 'Vehicle review could not be saved.'); else { showToast(status === 'approved' ? 'Courier vehicle approved.' : 'Vehicle returned for correction.'); await load(); }
  }

  return <motion.div className="page subpage cargo-page" {...pageMotion}>
    <div className="subpage-intro"><span className="eyebrow">DELIVERY, WITH CARE</span><h1>Send something safely.</h1><p>Tell us what is moving and where it needs to go. We’ll confirm a clear price before you commit.</p></div>
    {!user && <div className="cargo-signin-note"><Icon icon={Shield01Icon}/><span>Sign in to request a delivery and keep its updates in one place.</span><button className="button primary" onClick={() => navigate('auth')}>Sign in</button></div>}
    {user && !admin && <form className="panel cargo-form" onSubmit={submit}>
      <div className="form-heading"><span className="form-step">01</span><div><h2>What are we moving?</h2><p>Share enough detail for the right vehicle and a careful quote.</p></div></div>
      <div className="cargo-form-grid">
        <label className="input-label">Service type<select value={form.serviceType} onChange={(e)=>update('serviceType',e.target.value)}>{Object.entries(cargoServiceNames).map(([key,name])=><option value={key} key={key}>{name}</option>)}</select></label>
        <label className="input-label">Package size<select value={form.packageSize} onChange={(e)=>update('packageSize',e.target.value)}><option value="small">Small · hand carry</option><option value="medium">Medium · needs a larger vehicle</option><option value="large">Large · van or truck required</option></select></label>
        <label className="input-label">Number of items<input type="number" min="1" max="100" required value={form.packageCount} onChange={(e)=>update('packageCount',e.target.value)} /></label>
        <label className="input-label">Approximate total weight (kg)<input type="number" min="0.1" max="10000" step="0.1" required value={form.weightKg} onChange={(e)=>update('weightKg',e.target.value)} placeholder="e.g. 4.5" /></label>
        <label className="input-label">Declared value (₦), optional<input type="number" min="0" max="100000000" step="100" value={form.declaredValue} onChange={(e)=>update('declaredValue',e.target.value)} placeholder="For handling information" /></label>
        <label className="input-label cargo-check"><input type="checkbox" checked={form.fragile} onChange={(e)=>update('fragile',e.target.checked)} /><span>Handle as fragile</span></label>
      </div>
      <label className="input-label">What is inside?<textarea required minLength="3" maxLength="1200" rows="3" value={form.contents} onChange={(e)=>update('contents',e.target.value)} placeholder="A short, accurate description helps us handle it well." /></label>
      <div className="form-heading second"><span className="form-step">02</span><div><h2>Pickup and delivery</h2><p>Use complete addresses and local area names.</p></div></div>
      <label className="input-label">Pickup address<input required minLength="5" maxLength="300" value={form.pickup} onChange={(e)=>update('pickup',e.target.value)} placeholder="Street address, building, or landmark" /></label>
      <div className="cargo-form-grid cargo-location-grid"><label className="input-label">Pickup city or town<input required maxLength="100" value={form.pickupCity} onChange={(e)=>update('pickupCity',e.target.value)} /></label><label className="input-label">State or region<input required maxLength="100" value={form.pickupRegion} onChange={(e)=>update('pickupRegion',e.target.value)} /></label></div>
      <label className="input-label">Delivery address<input required minLength="5" maxLength="300" value={form.destination} onChange={(e)=>update('destination',e.target.value)} placeholder="Street address, building, or landmark" /></label>
      <div className="cargo-form-grid cargo-location-grid"><label className="input-label">Delivery city or town<input required maxLength="100" value={form.destinationCity} onChange={(e)=>update('destinationCity',e.target.value)} /></label><label className="input-label">State or region<input required maxLength="100" value={form.destinationRegion} onChange={(e)=>update('destinationRegion',e.target.value)} /></label></div>
      <label className="input-label">Preferred pickup time<input type="datetime-local" min={toLocalDateTime(new Date(Date.now()+30*60*1000))} value={form.pickupAt} onChange={(e)=>update('pickupAt',e.target.value)} /><small>Leave empty for the earliest available pickup. Schedule at least 30 minutes ahead.</small></label>
      <div className="form-heading second"><span className="form-step">03</span><div><h2>Who should receive it?</h2><p>We only share these details with the assigned courier.</p></div></div>
      <div className="cargo-form-grid"><label className="input-label">Recipient name<input required maxLength="120" value={form.recipientName} onChange={(e)=>update('recipientName',e.target.value)} /></label><label className="input-label">Recipient phone<input required type="tel" maxLength="32" value={form.recipientPhone} onChange={(e)=>update('recipientPhone',e.target.value)} placeholder="+234…" /></label></div>
      <label className="input-label">Note for the courier<textarea maxLength="800" rows="2" value={form.note} onChange={(e)=>update('note',e.target.value)} placeholder="Gate access, pickup contact, or other helpful detail" /></label>
      <div className="cargo-quote-note"><Icon icon={Shield01Icon} size={18}/><span>There is no charge to request a quote. You review and accept the price before secure payment or courier assignment.</span></div>
      <button className="button primary full" disabled={busy==='create'}>{busy==='create'?'Sending request…':'Request a delivery quote'} <Icon icon={ArrowRight01Icon}/></button>
    </form>}
    {user && <section className="ride-history cargo-history"><div className="section-head"><div><span className="eyebrow">{admin?'DISPATCH DESK':'YOUR SHIPMENTS'}</span><h2>{admin?'Cargo operations':'Delivery updates'}</h2></div><button className="text-action" onClick={load} disabled={loading}>Refresh</button></div>
      {loading ? <p className="history-message">Loading shipment updates…</p> : orders.length===0 ? <p className="history-message">{admin?'No cargo requests are waiting. New orders will appear here.':'Your delivery requests and tracking updates will appear here.'}</p> : <div className="cargo-order-list">{orders.map((order)=><article className="cargo-order-card" key={order.id}>
        <div className="cargo-order-top"><div><span className="eyebrow">{order.tracking_code}</span><h3>{cargoServiceNames[order.service_type] || order.service_type.replaceAll('_',' ')}</h3></div><span className={`ride-status status-${order.status}`}>{cargoStatusNames[order.status] || order.status}</span></div>
        <p className="cargo-route"><span><small>FROM</small>{order.pickup_city}, {order.pickup_region}<em>{order.pickup_label}</em></span><i/><span><small>TO</small>{order.destination_city}, {order.destination_region}<em>{order.destination_label}</em></span></p>
        <div className="cargo-order-facts"><span>{order.package_count} item{order.package_count===1?'':'s'} · {order.weight_kg} kg · {order.package_size}</span>{order.pickup_at&&<span>Pickup {new Date(order.pickup_at).toLocaleString()}</span>}<span>{order.fragile?'Fragile · ':''}{order.recipient_name} · {order.recipient_phone}</span></div>
        <p className="cargo-description">{order.contents_description}</p>
        {order.quote_amount_ngn_kobo&&<div className="cargo-price"><span>Confirmed delivery price</span><b>{formatMoneyKobo(order.quote_amount_ngn_kobo,'NGN')}</b></div>}
        {order.quote_note&&<p className="cargo-ops-note">{order.quote_note}</p>}{order.issue_note&&<p className="cargo-issue-note">{order.issue_note}</p>}
        {order.delivery_proof&&<p className="cargo-proof"><b>Delivery confirmation</b> {order.delivery_proof} · {order.delivered_at&&new Date(order.delivered_at).toLocaleString()}</p>}
        {events[order.id]?.length>0&&<details className="cargo-timeline"><summary>Shipment timeline</summary>{events[order.id].map((event)=><div className="cargo-timeline-event" key={event.id}><i/><div><b>{cargoStatusNames[event.event_type==='quote_accepted'?'accepted':event.event_type]||event.event_type.replaceAll('_',' ')}</b>{event.note&&<p>{event.note}</p>}<time>{new Date(event.created_at).toLocaleString()}</time></div></div>)}</details>}
        {!admin&&order.status==='quoted'&&<div className="cargo-order-actions"><button className="button primary" disabled={busy===order.id} onClick={()=>acceptQuote(order)}>Accept quote</button><button className="text-action" disabled={busy===order.id} onClick={()=>cancelOrder(order)}>Cancel request</button></div>}
        {!admin&&order.status==='accepted'&&order.payment_status!=='paid'&&<div className="cargo-pay-panel"><p>Accepting reserved the quoted price. Pay securely to release this delivery for dispatch.</p><button className="button primary" disabled={busy===order.id} onClick={()=>payOrder(order)}>{busy===order.id?'Opening secure checkout…':'Pay securely with Paystack'}</button></div>}
        {!admin&&order.status==='requested'&&<button className="text-action cargo-cancel-action" disabled={busy===order.id} onClick={()=>cancelOrder(order)}>Cancel request</button>}
        {admin&&(['requested'].includes(order.status)||(order.status==='issue'&&order.payment_status!=='paid'))&&<div className="cargo-admin-action"><h4>Prepare customer quote</h4><div className="cargo-form-grid"><label className="input-label">Price in naira<input type="number" min="1" step="50" value={quotes[order.id]?.amount??''} onChange={(e)=>setQuotes({...quotes,[order.id]:{...quotes[order.id],amount:e.target.value}})} placeholder="0" /></label><label className="input-label">Pickup / service note<input maxLength="600" value={quotes[order.id]?.note??''} onChange={(e)=>setQuotes({...quotes,[order.id]:{...quotes[order.id],note:e.target.value}})} placeholder="What the price includes" /></label></div><button className="button primary" disabled={busy===order.id} onClick={()=>sendQuote(order)}>Send quote</button></div>}
        {admin&&['accepted','issue'].includes(order.status)&&order.payment_status==='paid'&&<div className="cargo-admin-action"><h4>{order.status==='issue'?'Reassign after delivery issue':'Assign an approved courier'}</h4><div className="cargo-form-grid"><label className="input-label">Courier vehicle<select value={assignments[order.id]??''} onChange={(e)=>setAssignments({...assignments,[order.id]:e.target.value})}><option value="">Select vehicle</option>{vehicles.map((vehicle)=><option key={vehicle.id} value={`${vehicle.driver_id}|${vehicle.id}`}>{vehicle.vehicle_type} · {vehicle.make} {vehicle.model} · {vehicle.registration_number} · {vehicle.driver_id.slice(0,8)}</option>)}</select></label></div><button className="button primary" disabled={busy===order.id} onClick={()=>assignCourier(order)}>{order.status==='issue'?'Reassign delivery':'Assign delivery'}</button></div>}
        {admin&&!['delivered','cancelled'].includes(order.status)&&order.payment_status!=='paid'&&<button className="text-action cargo-cancel-action" disabled={busy===order.id} onClick={()=>cancelAsAdmin(order)}>Cancel request</button>}
      </article>)}</div>}
      {admin&&<section className="cargo-pending-vehicles"><div><span className="eyebrow">COURIER FLEET</span><h3>Vehicle reviews</h3><p>Only approved driver vehicles can be assigned to customer shipments.</p></div>{pendingVehicles.length?pendingVehicles.map((vehicle)=><article className="cargo-vehicle-review" key={vehicle.id}><div><b>{vehicle.vehicle_type} · {vehicle.make} {vehicle.model}</b><small>{vehicle.registration_number} · courier {vehicle.driver_id.slice(0,8)}</small></div><div className="cargo-order-actions"><button className="button primary" disabled={busy===vehicle.id} onClick={()=>reviewCargoVehicle(vehicle,'approved')}>Approve</button><button className="button ghost" disabled={busy===vehicle.id} onClick={()=>reviewCargoVehicle(vehicle,'rejected')}>Needs correction</button></div></article>):<p className="history-message">No eligible vehicle reviews are waiting.</p>}</section>}
    </section>}
    <section className="cargo-service-guide"><article><span>01</span><div><b>Request, then review</b><p>MoVara confirms the service details and price before anything is charged.</p></div></article><article><span>02</span><div><b>Pay securely</b><p>Paystack confirms the amount before dispatch. Your payment is tied to this tracking code.</p></div></article><article><span>03</span><div><b>Follow the handoff</b><p>See courier assignment, pickup, transit, and delivery confirmation in your account.</p></div></article></section>
  </motion.div>;
}

function ServiceCard({ icon, number, title, text, onClick }) {
  return <motion.button className="service-card" onClick={onClick} whileHover={{ y: -5 }} whileTap={{ scale: .985 }} transition={{ type: 'spring', stiffness: 330, damping: 24 }}>
    <div className="service-top"><span className="service-icon"><Icon icon={icon} size={22} /></span><span className="service-number">{number}</span></div><div><h3>{title}</h3><p>{text}</p></div><span className="service-arrow"><Icon icon={ArrowUpRight01Icon} size={19} /></span>
  </motion.button>;
}

const rideOptions = [
  { key: 'economy', name: 'MoVara Economy', description: 'Simple, reliable everyday rides', price: 500, capacity: 4 },
  { key: 'comfort', name: 'MoVara Comfort', description: 'More comfort for your journey', price: 700, capacity: 4 },
  { key: 'xl', name: 'MoVara XL', description: 'Extra room for people and luggage', price: 1000, capacity: 6 },
  { key: 'executive', name: 'MoVara Executive', description: 'Premium rides for work and special trips', price: 1500, capacity: 4 },
];

function toLocalDateTime(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function RidePage({ user, showToast, navigate }) {
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupPoint, setPickupPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [city, setCity] = useState({ cityCode: 'NG-DEFAULT', cityName: 'Nigeria' });
  const [airportPickup, setAirportPickup] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [corporateCode, setCorporateCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [vehicle, setVehicle] = useState('economy');
  const [passengers, setPassengers] = useState(1);
  const [scheduledAt, setScheduledAt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [rides, setRides] = useState([]);
  const [payments, setPayments] = useState({});
  const [liveLocations, setLiveLocations] = useState({});
  const [payingRide, setPayingRide] = useState('');
  const [liveRoute, setLiveRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [loadingRides, setLoadingRides] = useState(false);
  const [cancelling, setCancelling] = useState('');
  const [feedback, setFeedback] = useState({});
  const [sharedLinks, setSharedLinks] = useState({});
  const [reporting, setReporting] = useState('');

  const selectedRide = rideOptions.find((option) => option.key === vehicle) ?? rideOptions[0];
  const estimatedFare = liveRoute?.estimatedFareNgnKobo ? liveRoute.estimatedFareNgnKobo / 100 : null;
  const minSchedule = toLocalDateTime(new Date(Date.now() + 30 * 60 * 1000));

  async function loadRides() {
    if (!isConfigured || !user) { setRides([]); return; }
    setLoadingRides(true);
    const { data, error } = await supabase.from('rides')
      .select('id,pickup_label,destination_label,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,driver_arrived_at,rider_no_show_at,cancellation_reason,estimated_fare_ngn_kobo,currency,city_code,surge_multiplier,airport_surcharge_ngn_kobo,promotion_discount_ngn_kobo,cancellation_fee_ngn_kobo,payment_method,driver_id,service_level,passenger_count,scheduled_for,created_at,cancelled_at')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) showToast('Your ride list could not be refreshed. Please try again.');
    else {
      setRides(data ?? []);
      if (data?.length) {
        const { data: paymentRows } = await supabase.from('payments').select('ride_id,payment_type,status').in('ride_id', data.map((ride) => ride.id));
        setPayments(Object.fromEntries((paymentRows ?? []).map((payment) => [`${payment.ride_id}:${payment.payment_type}`, payment.status])));
        const { data: rated } = await supabase.from('ride_feedback').select('ride_id').in('ride_id', data.map((ride) => ride.id)).eq('reviewer_id', user.id);
        setFeedback(Object.fromEntries((rated ?? []).map((item) => [item.ride_id, true])));
      }
    }
    setLoadingRides(false);
  }

  useEffect(() => {
    if (!user || !isConfigured) return undefined;
    loadRides();
    const channel = supabase.channel(`rider-rides-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `customer_id=eq.${user.id}` }, loadRides)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  useEffect(() => {
    const trackable = rides.filter((ride) => ride.driver_id && ['accepted','in_progress'].includes(ride.status));
    if (!trackable.length) { setLiveLocations({}); return undefined; }
    let active = true;
    const ids = trackable.map((ride) => ride.id);
    supabase.from('ride_live_locations').select('ride_id,latitude,longitude,updated_at').in('ride_id', ids).then(({ data }) => {
      if (active) setLiveLocations(Object.fromEntries((data ?? []).map((location) => [location.ride_id, location])));
    });
    const channels = trackable.map((ride) => supabase.channel(`ride-location-${ride.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_live_locations', filter: `ride_id=eq.${ride.id}` }, ({ new: next }) => {
        if (active && next?.ride_id) setLiveLocations((current) => ({ ...current, [next.ride_id]: next }));
      }).subscribe());
    return () => { active = false; channels.forEach((channel) => supabase.removeChannel(channel)); };
  }, [rides]);

  useEffect(() => {
    if (!rides.some((ride) => ride.payment_method === 'paystack' && ride.status === 'accepted' && payments[`${ride.id}:ride`] !== 'succeeded')) return undefined;
    const timer = setInterval(loadRides, 10000);
    return () => clearInterval(timer);
  }, [rides, payments]);

  useEffect(() => {
    if (!pickupPoint || !destinationPoint || !user || !isConfigured) {
      setLiveRoute(null);
      setRouteError('');
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setRouteLoading(true);
      setRouteError('');
      const { data, error } = await supabase.functions.invoke('route-estimate', {
        body: {
          origin: { latitude: pickupPoint[0], longitude: pickupPoint[1] },
          destination: { latitude: destinationPoint[0], longitude: destinationPoint[1] },
          serviceLevel: vehicle,
          passengerCount: passengers,
          scheduledFor: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          cityCode: city.cityCode,
          airportPickup,
          promoCode: promoCode.trim(),
          corporateCode: corporateCode.trim(),
        },
      });
      if (!active) return;
      if (error || !data?.encodedPolyline) {
        setLiveRoute(null);
        setRouteError(error?.message || data?.error || 'Road route could not be calculated.');
      } else {
        setLiveRoute(data);
      }
      setRouteLoading(false);
    }, 550);
    return () => { active = false; clearTimeout(timer); };
  }, [pickupPoint, destinationPoint, user?.id, vehicle, passengers, scheduledAt, city.cityCode, airportPickup, promoCode, corporateCode]);

  async function requestRide(event) {
    event.preventDefault();
    if (!pickup.trim() || !destination.trim()) return showToast('Add both your pickup and destination to continue.');
    if (pickup.trim().toLowerCase() === destination.trim().toLowerCase()) return showToast('Pickup and destination must be different.');
    if (!pickupPoint || !destinationPoint) return showToast('Choose both addresses from suggestions or set both points on the map.');
    if (!isConfigured) return showToast('Ride booking is not connected yet. Add the Supabase settings to continue.');
    if (!user) { showToast('Sign in to request and follow your ride.'); navigate('auth'); return; }
    if (!liveRoute?.quoteToken || !liveRoute?.fareReady) return showToast(routeError || liveRoute?.error || 'Wait for a valid live route and fare quote before sending your request.');
    if (passengers > selectedRide.capacity) return showToast(`${selectedRide.name} is available for up to ${selectedRide.capacity} passengers.`);
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledDate && scheduledDate <= new Date(Date.now() + 30 * 60 * 1000)) return showToast('Choose a pickup time at least 30 minutes from now.');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-ride', { body: {
        quoteToken: liveRoute.quoteToken,
        pickupLabel: pickup.trim(), destinationLabel: destination.trim(),
        origin: { latitude: pickupPoint[0], longitude: pickupPoint[1] },
        destination: { latitude: destinationPoint[0], longitude: destinationPoint[1] },
        serviceLevel: vehicle, passengerCount: passengers, cityCode: liveRoute.cityCode,
        scheduledFor: scheduledDate?.toISOString() ?? null,
        specialInstructions: instructions.trim(), paymentMethod, airportPickup,
        promoCode: promoCode.trim(), corporateCode: corporateCode.trim(),
      } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      showToast('Your ride request is saved. We’ll update this page when its status changes.');
      setPickup(''); setDestination(''); setPickupPoint(null); setDestinationPoint(null);
      setInstructions(''); setScheduledAt(''); setPassengers(1);
      setPaymentMethod('cash'); setLiveRoute(null); setAirportPickup(false); setPromoCode(''); setCorporateCode('');
      await loadRides();
    } catch (error) {
      console.error('Ride request failed', error);
      showToast(error.message?.includes('column') || error.code === '42703'
        ? 'Ride booking needs the latest database update. Please contact support.'
        : 'Your ride could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return showToast('Location access is not available in this browser.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const point = [coords.latitude, coords.longitude];
      setPickupPoint(point);
      setPickup(`My location (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`);
      setCity({ cityCode: 'NG-DEFAULT', cityName: 'Nigeria' });
      setLocating(false);
      showToast('Your current location is set as pickup.');
    }, (error) => {
      setLocating(false);
      showToast(error.code === 1
        ? 'Allow location access in your browser to use your current position.'
        : 'We could not get your location. You can enter a pickup manually.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  function setMapPoint(latlng) {
    const point = [latlng.lat, latlng.lng];
    const label = `Map pin (${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)})`;
    if (!pickupPoint || (pickupPoint && destinationPoint)) {
      setPickupPoint(point); setPickup(label); setCity({ cityCode: 'NG-DEFAULT', cityName: 'Nigeria' }); setDestinationPoint(null); setDestination('');
    } else {
      setDestinationPoint(point); setDestination(label);
    }
  }

  async function cancelRide(ride) {
    let cancellationFee = 0;
    if (ride.status === 'accepted') {
      const { data: rule } = await supabase.from('ride_pricing_rules').select('cancellation_fee_ngn_kobo').eq('city_code', ride.city_code).eq('service_level', ride.service_level).eq('active', true).maybeSingle();
      cancellationFee = Number(rule?.cancellation_fee_ngn_kobo ?? 0);
      if (!window.confirm(`A cancellation fee of ${formatMoneyKobo(cancellationFee,ride.currency)} applies after driver acceptance. Continue?`)) return;
    }
    setCancelling(ride.id);
    const { error } = await supabase.rpc('cancel_ride', { p_ride_id: ride.id, p_reason: 'Cancelled by rider' });
    setCancelling('');
    if (error) showToast(error.message || 'This ride could not be cancelled.');
    else { showToast(cancellationFee ? `Ride cancelled. ${formatMoneyKobo(cancellationFee,ride.currency)} cancellation fee is due.` : 'Ride cancelled.'); await loadRides(); }
  }

  async function payForRide(rideId, paymentType = 'ride') {
    const paymentKey = `${rideId}:${paymentType}`;
    setPayingRide(paymentKey);
    const { data, error } = await supabase.functions.invoke('initialize-paystack-payment', { body: { rideId, paymentType } });
    setPayingRide('');
    if (error || data?.error) return showToast(data?.error || 'Checkout could not be started.');
    if (data?.paid) { showToast('This payment is already confirmed.'); return loadRides(); }
    if (data?.authorizationUrl) window.location.assign(data.authorizationUrl);
  }

  async function shareRide(ride) {
    const { data, error } = await supabase.rpc('create_ride_share', { p_ride_id: ride.id });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.share_token) return showToast(error?.message || 'Trip sharing could not be started.');
    const basePath = import.meta.env.BASE_URL || '/';
    const url = new URL(basePath, window.location.origin);
    url.searchParams.set('share', row.share_token);
    setSharedLinks((current) => ({ ...current, [ride.id]: row.share_id }));
    try {
      if (navigator.share) await navigator.share({ title: 'Follow my MoVara trip', text: 'Here is my live trip link.', url: url.toString() });
      else { await navigator.clipboard.writeText(url.toString()); showToast('Trip link copied. It expires in 8 hours.'); }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') showToast('Trip link created. Copy this page URL to share it.');
    }
  }

  async function reportSafety(ride, eventType) {
    const message = eventType === 'sos'
      ? 'Rider requested urgent safety assistance.'
      : (window.prompt('Tell our safety team what happened. Please include only details that help us respond.') ?? null);
    if (message === null) return;
    setReporting(ride.id);
    const { error } = await supabase.rpc('report_ride_safety_event', { p_ride_id: ride.id, p_event_type: eventType, p_message: message });
    setReporting('');
    if (error) return showToast(error.message || 'Your report could not be sent. Call 112 if anyone is in immediate danger.');
    showToast(eventType === 'sos' ? 'Safety alert sent to MoVara support. If there is immediate danger, call 112 now.' : 'Your report has been sent to MoVara support.');
    if (eventType === 'sos') window.location.href = 'tel:112';
  }

  async function rateRide(rideId, rating, comment) {
    const { error } = await supabase.rpc('submit_ride_feedback', { p_ride_id: rideId, p_rating: rating, p_comment: comment });
    if (error) showToast(error.message || 'Your rating could not be saved.');
    else { setFeedback((current) => ({ ...current, [rideId]: true })); showToast('Thank you for sharing feedback.'); }
  }

  const formatFare = (amount, currency) => amount == null ? 'Fare to be confirmed' : formatMoneyKobo(amount, currency ?? 'NGN');
  const formatStatus = (status) => ({ requested: 'Request sent', matching: 'Finding a driver', accepted: 'Driver confirmed', in_progress: 'On your way', completed: 'Completed', cancelled: 'Cancelled' }[status] ?? status);

  return <motion.div className="page subpage" {...pageMotion}>
    <div className="subpage-intro"><span className="eyebrow">A BETTER WAY THERE</span><h1>Where are you headed?</h1><p>Set your route and choose the ride that feels right.</p></div>
    <div className="ride-layout">
      <form className="panel ride-form" onSubmit={requestRide}>
        <div className="form-heading"><span className="form-step">01</span><div><h2>Your route</h2><p>Where should we pick you up?</p></div></div>
        <RidePlaceField label="Pickup location" value={pickup} placeholder="Pickup location" onChange={(value) => { setPickup(value); setPickupPoint(null); setCity({ cityCode: 'NG-DEFAULT', cityName: 'Nigeria' }); }} onSelect={(label, point, market) => { setPickup(label); setPickupPoint(point); setCity(market); }} />
        <button className="text-action location-action" type="button" onClick={useMyLocation} disabled={locating}>{locating ? 'Finding your location…' : '◎ Use my current location'}</button>
        <RidePlaceField label="Destination" value={destination} placeholder="Where to?" onChange={(value) => { setDestination(value); setDestinationPoint(null); }} onSelect={(label, point) => { setDestination(label); setDestinationPoint(point); }} />
        <p className="map-help">Choose a suggested address or tap the map to set both points.</p>
        <div className="form-heading second"><span className="form-step">02</span><div><h2>Choose a ride</h2><p>Fare combines booking, road distance, and trip time.</p></div></div>
        <div className="vehicle-list">{rideOptions.map((option) => <button type="button" key={option.key} onClick={() => { setVehicle(option.key); if (passengers > option.capacity) setPassengers(option.capacity); }} className={vehicle === option.key ? 'vehicle selected' : 'vehicle'} aria-pressed={vehicle === option.key}><span className="vehicle-icon"><Icon icon={Car01Icon} /></span><span className="vehicle-info"><b>{option.name}</b><small>{option.description} · up to {option.capacity}</small></span><b className="vehicle-price">{liveRoute?.serviceLevel===option.key ? formatMoneyKobo(liveRoute.components?.bookingFeeNgnKobo, liveRoute.currency) : 'Live fare'}</b><span className="radio" /></button>)}</div>
        <div className="ride-extra-grid">
          <label className="input-label">Passengers<select value={passengers} onChange={(event) => setPassengers(Number(event.target.value))}>{Array.from({ length: selectedRide.capacity }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} {index === 0 ? 'passenger' : 'passengers'}</option>)}</select></label>
          <label className="input-label">Pickup time<input type="datetime-local" min={minSchedule} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><small>Leave empty for the soonest pickup.</small></label>
        </div>
        <label className="input-label">Note for your driver <textarea maxLength={300} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Gate, landmark, or other helpful detail" rows={3} /></label>
        <div className="ride-extra-grid"><label className="input-label">Promo code<input value={promoCode} maxLength={40} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} placeholder="Optional" /></label><label className="input-label">Corporate code<input value={corporateCode} maxLength={40} onChange={(event) => setCorporateCode(event.target.value.toUpperCase())} placeholder="Optional" /></label></div>
        <label className="airport-option"><input type="checkbox" checked={airportPickup} onChange={(event) => setAirportPickup(event.target.checked)} /><span>Airport pickup</span><small>Any airport surcharge is shown in your quote.</small></label>
        <label className="input-label">Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash to driver</option><option value="paystack">Pay online with Paystack after driver acceptance</option><option value="wallet">Pay from MoVara wallet</option></select></label>
        <button className="button primary full" disabled={busy || routeLoading || !liveRoute?.quoteToken}>{busy ? 'Sending request…' : routeLoading ? 'Calculating route and fare…' : 'Request this ride'} <Icon icon={ArrowRight01Icon} /></button>
        <div className="fine-print"><Icon icon={Shield01Icon} size={16} /> Your request and trip updates are saved to your account.</div>
      </form>
      <aside className="ride-aside">
        <div className="map-live"><RideMapCanvas pickupPoint={pickupPoint} destinationPoint={destinationPoint} encodedPolyline={liveRoute?.encodedPolyline} onPick={setMapPoint} /><span className="map-caption">{pickupPoint ? destinationPoint ? 'LIVE ROAD ROUTE' : 'TAP TO SET DESTINATION' : 'TAP TO SET PICKUP, THEN DESTINATION'}</span></div>
        <div className="fare-card">
          <span className="fare-icon"><Icon icon={Wallet01Icon} /></span>
          <div><small>{routeLoading ? 'Calculating live route…' : liveRoute ? `${liveRoute.distanceText} road distance · ${liveRoute.durationText}` : 'Estimated fare'}</small><b>{estimatedFare == null ? 'Choose route' : formatMoneyKobo(liveRoute.estimatedFareNgnKobo, liveRoute.currency)}</b></div>
          <p>{routeError || liveRoute?.error || (liveRoute?.surgeMultiplier > 1 ? `Current demand multiplier: ${Number(liveRoute.surgeMultiplier).toFixed(1)}×.` : 'Fare includes booking fee, road distance, trip time, and active adjustments.')}{liveRoute && <small className="route-attribution">Road routing © openrouteservice.org by HeiGIT.</small>}</p>
          {liveRoute?.components && <dl className="fare-breakdown"><div><dt>Booking fee</dt><dd>{formatMoneyKobo(liveRoute.components.bookingFeeNgnKobo, liveRoute.currency)}</dd></div><div><dt>Road distance</dt><dd>{formatMoneyKobo(liveRoute.components.distanceFareNgnKobo, liveRoute.currency)}</dd></div><div><dt>Trip time</dt><dd>{formatMoneyKobo(liveRoute.components.timeFareNgnKobo, liveRoute.currency)}</dd></div>{liveRoute.components.airportSurchargeNgnKobo > 0 && <div><dt>Airport pickup</dt><dd>{formatMoneyKobo(liveRoute.components.airportSurchargeNgnKobo, liveRoute.currency)}</dd></div>}{liveRoute.components.promotionDiscountNgnKobo > 0 && <div><dt>Code savings</dt><dd>−{formatMoneyKobo(liveRoute.components.promotionDiscountNgnKobo, liveRoute.currency)}</dd></div>}</dl>}
        </div>
        <div className="service-note"><b>Live route</b><span>{user ? 'Road distance and ETA are calculated by OpenRouteService.' : 'Sign in to calculate a road route and save your request.'}</span></div>
      </aside>
    </div>
    {user && <section className="ride-history"><div className="section-head"><div><span className="eyebrow">YOUR JOURNEYS</span><h2>Recent rides</h2></div><button className="text-action" type="button" onClick={loadRides}>Refresh</button></div>
      {loadingRides && rides.length === 0 ? <p className="history-message">Loading your rides…</p> : rides.length === 0 ? <p className="history-message">Your ride requests will appear here.</p> : <div className="ride-history-list">{rides.map((ride) => {
        const location = liveLocations[ride.id];
        const mapPoint = location ? [location.latitude, location.longitude] : null;
        const paymentStatus = payments[`${ride.id}:ride`];
        const cancellationStatus = payments[`${ride.id}:cancellation_fee`];
        return <article className="ride-history-card" key={ride.id}>
          <div className="ride-history-top"><span className={`ride-status status-${ride.status}`}>{formatStatus(ride.status)}</span><b>{formatFare(ride.estimated_fare_ngn_kobo,ride.currency)}</b></div>
          <p><span>{ride.pickup_label}</span><i aria-hidden="true" /><span>{ride.destination_label}</span></p>
          <small>{ride.service_level ?? 'Ride'} · {ride.passenger_count} {ride.passenger_count === 1 ? 'passenger' : 'passengers'} · {new Date(ride.scheduled_for ?? ride.created_at).toLocaleString()}</small>
          {ride.driver_arrived_at && <div className="ride-live-note">Your driver marked arrival at {new Date(ride.driver_arrived_at).toLocaleTimeString()}.</div>}
          {ride.cancellation_reason === 'rider_no_show' && <div className="ride-live-note">The driver reported a rider no-show after waiting at pickup. No no-show cancellation fee was added. If you prepaid online, contact support to review the payment.</div>}
          {ride.payment_method === 'paystack' && <div className="ride-live-note">Ride payment: {paymentStatus === 'succeeded' ? 'Confirmed' : paymentStatus === 'pending' ? 'Checkout started' : 'Awaiting payment'}{ride.status === 'accepted' && paymentStatus !== 'succeeded' && <button className="text-action" type="button" onClick={() => payForRide(ride.id,'ride')} disabled={payingRide === `${ride.id}:ride`}>{payingRide === `${ride.id}:ride` ? 'Opening checkout…' : 'Pay securely'}</button>}</div>}
          {ride.cancellation_fee_ngn_kobo > 0 && <div className="ride-live-note">Cancellation fee: {formatMoneyKobo(ride.cancellation_fee_ngn_kobo,ride.currency)}{ride.payment_method === 'paystack' && cancellationStatus !== 'succeeded' && <button className="text-action" type="button" onClick={() => payForRide(ride.id,'cancellation_fee')} disabled={payingRide === `${ride.id}:cancellation_fee`}>{payingRide === `${ride.id}:cancellation_fee` ? 'Opening checkout…' : 'Pay cancellation fee'}</button>}{ride.payment_method === 'cash' && <small>Settle with the driver directly.</small>}</div>}
          {['accepted','in_progress'].includes(ride.status) && <div className="ride-live-note">{location ? `Driver location updated ${new Date(location.updated_at).toLocaleTimeString()}` : 'Waiting for your driver to share their location.'}{location && <div className="ride-live-map"><RideMapCanvas pickupPoint={[ride.pickup_latitude, ride.pickup_longitude]} destinationPoint={[ride.destination_latitude, ride.destination_longitude]} driverPoint={mapPoint} encodedPolyline={null} onPick={() => {}} /></div>}</div>}
          {['accepted','in_progress'].includes(ride.status) && <div className="ride-action-row"><button type="button" className="button ghost" onClick={() => shareRide(ride)}>Share trip</button><button type="button" className="button danger" disabled={reporting === ride.id} onClick={() => reportSafety(ride,'sos')}>{reporting === ride.id ? 'Sending alert…' : 'SOS / urgent help'}</button><button type="button" className="text-action" disabled={reporting === ride.id} onClick={() => reportSafety(ride,'incident')}>Report a safety concern</button></div>}
          {ride.status === 'completed' && !feedback[ride.id] && <RideRating onSubmit={(rating, comment) => rateRide(ride.id, rating, comment)} />}
          {ride.status === 'completed' && feedback[ride.id] && <div className="ride-live-note">Feedback received. Thank you.</div>}
          {['requested','matching','accepted'].includes(ride.status) && <button className="ride-cancel" type="button" onClick={() => cancelRide(ride)} disabled={cancelling === ride.id}>{cancelling === ride.id ? 'Cancelling…' : ride.status==='accepted' ? 'Cancel trip' : 'Cancel request'}</button>}
        </article>;
      })}</div>}
    </section>}
  </motion.div>;
}

async function prepareProperties(rows = []) {
  return Promise.all(rows.map(async (home) => {
    const images = [...(home.property_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const urls = await Promise.all(images.map(async (image) => {
      const { data } = await supabase.storage.from('property-images').createSignedUrl(image.object_path, 3600);
      return data?.signedUrl;
    }));
    return { ...home, imageUrls: urls.filter(Boolean), imageUrl: urls.find(Boolean) };
  }));
}

function PropertyCards({ homes, states = [], user, showToast, navigate, onUnsave }) {
  const stateNames = Object.fromEntries(states.map(({ code, name }) => [code, name]));
  const [busy, setBusy] = useState(null);
  const [localSaved, setLocalSaved] = useState({});
  async function toggleSaved(event, home) {
    event.stopPropagation();
    if (!user) return navigate('auth');
    setBusy(home.id);
    const saved = localSaved[home.id] ?? home.saved;
    const result = saved
      ? await supabase.from('favourites').delete().eq('user_id', user.id).eq('property_id', home.id)
      : await supabase.from('favourites').insert({ user_id: user.id, property_id: home.id });
    setBusy(null);
    if (result.error) return showToast('We could not update your saved homes. Please try again.');
    if (onUnsave && saved) onUnsave(home.id);
    else { setLocalSaved((current) => ({ ...current, [home.id]: !saved })); showToast(saved ? 'Removed from saved homes.' : 'Saved to your homes.'); }
  }
  return <div className="home-grid">{homes.map((home, index) => <motion.article className="home-card" key={home.id} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .045, .24) }}>
    <div className={`home-image image-${index % 3}`}>{home.imageUrl && <img src={home.imageUrl} alt={home.title} />}<span>{home.transaction_type}</span>{!home.imageUrl && <Icon icon={Home01Icon} size={36} />}<button className={`save-home ${(localSaved[home.id] ?? home.saved) ? 'is-saved' : ''}`} type="button" aria-label={(localSaved[home.id] ?? home.saved) ? 'Remove from saved homes' : 'Save home'} onClick={(event) => toggleSaved(event, home)} disabled={busy === home.id}>{(localSaved[home.id] ?? home.saved) ? '♥' : '♡'}</button></div>
    <div className="home-details"><small><Icon icon={Location01Icon} size={14} /> {home.address}{stateNames[home.state_code] ? `, ${stateNames[home.state_code]}` : ''}</small><h3><button type="button" className="home-card-title" onClick={() => navigate('property', { propertyId: home.id })}>{home.title}</button></h3><p>{home.category?.replaceAll('_', ' ')}</p><b>₦{Math.round(home.price_ngn_kobo / 100).toLocaleString()} <small>{home.transaction_type === 'rent' ? '/ year' : ''}</small></b></div>
  </motion.article>)}</div>;
}

function HomesPage({ user, showToast, navigate }) {
  const [query, setQuery] = useState(''); const [state, setState] = useState(''); const [category, setCategory] = useState(''); const [transaction, setTransaction] = useState(''); const [minPrice, setMinPrice] = useState(''); const [maxPrice, setMaxPrice] = useState('');
  const [homes, setHomes] = useState([]); const [states, setStates] = useState([]); const [savedIds, setSavedIds] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; async function load() {
    if (!isConfigured) { setLoading(false); return; }
    const [{ data, error }, { data: stateRows }, savedResult] = await Promise.all([
      supabase.from('properties').select('id,title,description,category,transaction_type,price_ngn_kobo,state_code,address,property_images(object_path,sort_order)').eq('status','published').order('created_at',{ascending:false}).limit(100),
      supabase.from('nigerian_states').select('code,name').order('name'),
      user ? supabase.from('favourites').select('property_id').eq('user_id', user.id) : Promise.resolve({ data: [] }),
    ]);
    if (!active) return;
    if (error) showToast('We could not load homes right now. Please try again shortly.');
    const prepared = await prepareProperties(data ?? []);
    if (!active) return;
    setHomes(prepared); setStates(stateRows ?? []); setSavedIds((savedResult.data ?? []).map((row) => row.property_id)); setLoading(false);
  } load(); return () => { active = false; }; }, [user?.id]);
  const stateNames = useMemo(() => Object.fromEntries(states.map(({ code, name }) => [code, name])), [states]);
  const filtered = useMemo(() => homes.filter((home) => `${home.title} ${home.description} ${home.address} ${stateNames[home.state_code] ?? home.state_code}`.toLowerCase().includes(query.trim().toLowerCase()) && (!state || home.state_code === state) && (!category || home.category === category) && (!transaction || home.transaction_type === transaction) && (!minPrice || home.price_ngn_kobo >= Number(minPrice) * 100) && (!maxPrice || home.price_ngn_kobo <= Number(maxPrice) * 100)).map((home) => ({ ...home, saved: savedIds.includes(home.id) })), [homes, query, state, category, transaction, minPrice, maxPrice, savedIds, stateNames]);
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">FIND SOMEWHERE TO BELONG</span><h1>A place that feels like yours.</h1><p>Explore homes across Nigeria, with the details you need to choose well.</p></div><div className="search-panel home-search"><label className="field"><Icon icon={Search01Icon} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search homes, areas or addresses" /></label><select aria-label="State" value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option>{states.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select><select aria-label="Rent or sale" value={transaction} onChange={(e) => setTransaction(e.target.value)}><option value="">Rent or buy</option><option value="rent">For rent</option><option value="sale">For sale</option></select><select aria-label="Home type" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Any home type</option>{['self_contained','one_bedroom','two_bedroom','three_bedroom','duplex','commercial','land'].map((item) => <option key={item} value={item}>{item.replaceAll('_',' ')}</option>)}</select><input aria-label="Minimum price in naira" inputMode="numeric" type="number" min="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Min ₦"/><input aria-label="Maximum price in naira" inputMode="numeric" type="number" min="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max ₦"/></div>
    <div className="property-results-head"><b>{loading ? 'Finding homes…' : `${filtered.length} ${filtered.length === 1 ? 'home' : 'homes'}`}</b><button className="text-action" type="button" onClick={() => navigate(user ? 'saved-homes' : 'auth')}>Saved homes <Icon icon={ArrowRight01Icon}/></button></div>
    {loading ? <div className="empty-state">Finding available homes…</div> : filtered.length ? <PropertyCards homes={filtered} states={states} user={user} showToast={showToast} navigate={navigate} /> : <div className="empty-state"><Icon icon={Home01Icon} size={32} /><h2>{isConfigured ? 'No homes match those filters' : 'Connect Supabase to explore homes'}</h2><p>Try a different area or clear one of the filters.</p><button className="button ghost" onClick={() => { setQuery(''); setState(''); setCategory(''); setTransaction(''); setMinPrice(''); setMaxPrice(''); }}>Clear filters</button></div>}
  </motion.div>;
}

function SavedHomesPage({ user, showToast, navigate }) {
  const [homes, setHomes] = useState([]); const [states, setStates] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; async function load() {
    if (!user) { setLoading(false); return; }
    const [{ data: favourites, error }, { data: stateRows }] = await Promise.all([supabase.from('favourites').select('property_id').eq('user_id', user.id), supabase.from('nigerian_states').select('code,name').order('name')]);
    if (!active) return;
    if (error) { showToast('We could not load your saved homes.'); setLoading(false); return; }
    const ids = (favourites ?? []).map((row) => row.property_id);
    if (ids.length) { const { data, error: homesError } = await supabase.from('properties').select('id,title,description,category,transaction_type,price_ngn_kobo,state_code,address,property_images(object_path,sort_order)').in('id', ids).eq('status','published'); if (homesError) showToast('Some saved homes are temporarily unavailable.'); const prepared = await prepareProperties(data ?? []); if (active) setHomes(prepared.map((home) => ({ ...home, saved: true }))); }
    setStates(stateRows ?? []); setLoading(false);
  } load(); return () => { active = false; }; }, [user?.id]);
  if (!user) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state"><Icon icon={Home01Icon} size={32}/><h2>Sign in to see your saved homes</h2><p>Your shortlist stays with your account when you return.</p><button className="button primary" onClick={() => navigate('auth')}>Sign in</button></div></motion.div>;
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">YOUR SHORTLIST</span><h1>Saved homes</h1><p>Places you want to come back to.</p></div>{loading ? <div className="empty-state">Loading your shortlist…</div> : homes.length ? <PropertyCards homes={homes} states={states} user={user} showToast={showToast} navigate={navigate} onUnsave={(id) => setHomes((items) => items.filter((item) => item.id !== id))}/> : <div className="empty-state"><Icon icon={Home01Icon} size={32}/><h2>No saved homes yet</h2><p>Tap the heart on a listing to keep it here.</p><button className="button primary" onClick={() => navigate('homes')}>Explore homes</button></div>}</motion.div>;
}

function PropertyDetailPage({ propertyId, user, showToast, navigate }) {
  const [property, setProperty] = useState(null); const [stateName, setStateName] = useState(''); const [landlord, setLandlord] = useState(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false); const [message, setMessage] = useState('Hello, I’m interested in this home. Could you share more details?'); const [viewingTime, setViewingTime] = useState(''); const [imageIndex, setImageIndex] = useState(0);
  useEffect(() => { let active = true; async function load() {
    if (!propertyId || !isConfigured) { setLoading(false); return; }
    const { data, error } = await supabase.from('properties').select('id,landlord_id,title,description,category,transaction_type,price_ngn_kobo,state_code,address,verification,created_at,property_images(object_path,sort_order)').eq('id', propertyId).eq('status','published').maybeSingle();
    if (!active) return;
    if (error || !data) { setLoading(false); showToast('This home is no longer available.'); return; }
    const [prepared] = await prepareProperties([data]);
    const [{ data: stateRow }, { data: profile }, favouriteResult] = await Promise.all([supabase.from('nigerian_states').select('name').eq('code', data.state_code).maybeSingle(), supabase.from('profiles').select('display_name').eq('id', data.landlord_id).maybeSingle(), user ? supabase.from('favourites').select('property_id').eq('user_id', user.id).eq('property_id', data.id).maybeSingle() : Promise.resolve({ data: null })]);
    if (!active) return;
    setProperty(prepared); setStateName(stateRow?.name ?? data.state_code); setLandlord(profile?.display_name); setSaved(Boolean(favouriteResult.data)); setLoading(false);
  } load(); return () => { active = false; }; }, [propertyId, user?.id]);
  async function saveHome() {
    if (!user) return navigate('auth'); setBusy(true);
    const result = saved ? await supabase.from('favourites').delete().eq('user_id', user.id).eq('property_id', propertyId) : await supabase.from('favourites').insert({ user_id: user.id, property_id: propertyId });
    setBusy(false); if (result.error) return showToast('We could not update your saved homes.'); setSaved(!saved); showToast(saved ? 'Removed from saved homes.' : 'Saved to your homes.');
  }
  async function contactLandlord(event) {
    event.preventDefault(); if (!user) return navigate('auth'); if (!message.trim()) return showToast('Add a short message before sending.');
    setBusy(true);
    const { data: enquiryId, error } = await supabase.rpc('create_enquiry', { p_property_id: propertyId, p_message: message.trim(), p_idempotency_key: crypto.randomUUID() });
    if (error) { setBusy(false); return showToast(error.message.includes('Property is unavailable') ? 'This home is no longer available.' : 'We could not send your enquiry. Please try again.'); }
    if (viewingTime) {
      const { data: cycle } = await supabase.from('tenancy_search_cycles').select('id').eq('property_id', propertyId).eq('tenant_id', user.id).eq('status', 'open').maybeSingle();
      if (!cycle) { setBusy(false); return showToast('Your message was sent. You can request a viewing after the landlord responds.'); }
      const { error: viewingError } = await supabase.rpc('create_property_viewing', { p_enquiry_id: enquiryId, p_cycle_id: cycle.id, p_proposed_at: new Date(viewingTime).toISOString(), p_idempotency_key: crypto.randomUUID() });
      if (viewingError) { setBusy(false); return showToast('Your message was sent, but the viewing time could not be reserved. Please try another time.'); }
    }
    setBusy(false); showToast(viewingTime ? 'Enquiry and viewing request sent.' : 'Your enquiry was sent to the landlord.'); setMessage(''); setViewingTime('');
  }
  if (loading) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state">Loading home details…</div></motion.div>;
  if (!property) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state"><h2>Home unavailable</h2><p>This listing may have been withdrawn.</p><button className="button primary" onClick={() => navigate('homes')}>Back to homes</button></div></motion.div>;
  return <motion.div className="page subpage property-page" {...pageMotion}><button className="text-action" onClick={() => navigate('homes')}>← Back to homes</button><div className="property-detail-layout"><section><div className="property-gallery">{property.imageUrls?.length ? <><img src={property.imageUrls[imageIndex]} alt={`${property.title}, photo ${imageIndex + 1}`} />{property.imageUrls.length > 1 && <div className="gallery-controls"><button onClick={() => setImageIndex((imageIndex + property.imageUrls.length - 1) % property.imageUrls.length)}>Previous</button><span>{imageIndex + 1} / {property.imageUrls.length}</span><button onClick={() => setImageIndex((imageIndex + 1) % property.imageUrls.length)}>Next</button></div>}</> : <div className="property-no-image"><Icon icon={Home01Icon} size={58}/><span>Photos will be added by the landlord</span></div>}</div><div className="property-detail-copy"><span className="eyebrow">{property.transaction_type === 'rent' ? 'FOR RENT' : 'FOR SALE'} · {property.category?.replaceAll('_',' ')}</span><h1>{property.title}</h1><p className="property-address"><Icon icon={Location01Icon}/>{property.address}, {stateName}</p><h2>About this home</h2><p className="property-description">{property.description || 'Contact the landlord for more details about this home.'}</p><div className="property-facts"><span>Listing type <b>{property.transaction_type}</b></span><span>Home type <b>{property.category?.replaceAll('_',' ')}</b></span><span>Listed <b>{new Date(property.created_at).toLocaleDateString()}</b></span></div></div></section><aside className="property-contact panel"><span className="eyebrow">LISTING PRICE</span><strong>₦{Math.round(property.price_ngn_kobo / 100).toLocaleString()} <small>{property.transaction_type === 'rent' ? '/ year' : ''}</small></strong><p>Shared by {landlord || 'a MoVara landlord'}</p><button className="button ghost full" type="button" onClick={saveHome} disabled={busy}>{saved ? '♥  Saved' : '♡  Save this home'}</button><form onSubmit={contactLandlord}><label className="input-label">Message to the landlord<textarea rows="4" maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} required /></label><label className="input-label">Suggest a viewing time <small>Optional. The landlord can respond to your request.</small><input type="datetime-local" min={new Date(Date.now() + 3600000).toISOString().slice(0,16)} value={viewingTime} onChange={(event) => setViewingTime(event.target.value)} /></label><button className="button primary full" disabled={busy}>{busy ? 'Sending…' : viewingTime ? 'Send enquiry and request viewing' : 'Contact landlord'} <Icon icon={ArrowRight01Icon}/></button></form><small className="property-privacy"><Icon icon={Shield01Icon} size={15}/> Your contact starts inside MoVara.</small></aside></div></motion.div>;
}

function PropertyInboxPage({ user, showToast, navigate }) {
  const [threads, setThreads] = useState([]); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(null); const [drafts, setDrafts] = useState({});
  async function loadInbox() {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data: enquiries, error } = await supabase.from('enquiries').select('id,property_id,landlord_id,customer_id,last_message_at,created_at').or(`customer_id.eq.${user.id},landlord_id.eq.${user.id}`).order('last_message_at', { ascending: false }).limit(100);
    if (error) { showToast('We could not load your home conversations.'); setLoading(false); return; }
    if (!enquiries?.length) { setThreads([]); setLoading(false); return; }
    const enquiryIds = enquiries.map((item) => item.id); const propertyIds = [...new Set(enquiries.map((item) => item.property_id))]; const partyIds = [...new Set(enquiries.flatMap((item) => [item.landlord_id, item.customer_id]))];
    const [messageResult, viewingResult, propertyResult, profileResult] = await Promise.all([
      supabase.from('enquiry_messages').select('id,enquiry_id,sender_id,body,created_at').in('enquiry_id', enquiryIds).order('created_at'),
      supabase.from('property_viewings').select('id,enquiry_id,proposed_at,status,requested_by').in('enquiry_id', enquiryIds).order('proposed_at'),
      supabase.from('properties').select('id,title,status').in('id', propertyIds),
      supabase.from('profiles').select('id,display_name').in('id', partyIds),
    ]);
    const propertyMap = Object.fromEntries((propertyResult.data ?? []).map((row) => [row.id, row])); const profileMap = Object.fromEntries((profileResult.data ?? []).map((row) => [row.id, row.display_name]));
    setThreads(enquiries.map((item) => ({ ...item, property: propertyMap[item.property_id], otherParty: profileMap[item.landlord_id === user.id ? item.customer_id : item.landlord_id] || (item.landlord_id === user.id ? 'Home seeker' : 'Landlord'), messages: (messageResult.data ?? []).filter((message) => message.enquiry_id === item.id), viewings: (viewingResult.data ?? []).filter((viewing) => viewing.enquiry_id === item.id) })));
    setLoading(false);
  }
  useEffect(() => { let active = true; loadInbox(); return () => { active = false; }; }, [user?.id]);
  async function sendReply(event, thread) {
    event.preventDefault(); const body = (drafts[thread.id] ?? '').trim(); if (!body) return;
    setSending(thread.id); const { error } = await supabase.rpc('send_enquiry_message', { p_enquiry_id: thread.id, p_body: body, p_idempotency_key: crypto.randomUUID() }); setSending(null);
    if (error) return showToast('Your reply could not be sent. Please try again.');
    setDrafts((current) => ({ ...current, [thread.id]: '' })); await loadInbox(); showToast('Reply sent.');
  }
  async function respondToViewing(viewing, confirm) {
    setSending(viewing.id); const result = confirm ? await supabase.rpc('confirm_property_viewing', { p_viewing_id: viewing.id }) : await supabase.rpc('cancel_property_viewing', { p_viewing_id: viewing.id, p_reason: 'Cancelled by participant' }); setSending(null);
    if (result.error) return showToast('We could not update the viewing. Please refresh and try again.');
    await loadInbox(); showToast(confirm ? 'Viewing confirmed.' : 'Viewing cancelled.');
  }
  if (!user) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state"><h2>Sign in to view conversations</h2><p>Your property enquiries and viewing requests live here.</p><button className="button primary" onClick={() => navigate('auth')}>Sign in</button></div></motion.div>;
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">PROPERTY MESSAGES</span><h1>Your home conversations.</h1><p>Keep enquiries and viewing plans together in one place.</p></div><div className="property-inbox-head"><span>{threads.length} {threads.length === 1 ? 'conversation' : 'conversations'}</span><button className="text-action" onClick={loadInbox}>Refresh</button></div>{loading ? <div className="empty-state">Loading conversations…</div> : threads.length ? <div className="property-inbox-list">{threads.map((thread) => <article className="panel property-thread" key={thread.id}><header><div><span className="eyebrow">{thread.property?.status === 'published' ? 'ACTIVE LISTING' : 'LISTING UPDATE'}</span><h2>{thread.property?.title ?? 'Home listing unavailable'}</h2><small>{thread.otherParty} · Updated {new Date(thread.last_message_at).toLocaleString()}</small></div><button className="text-action" onClick={() => navigate('property', { propertyId: thread.property_id })}>View home <Icon icon={ArrowUpRight01Icon}/></button></header><div className="property-thread-messages">{thread.messages.map((message) => <div key={message.id} className={`property-thread-message ${message.sender_id === user.id ? 'mine' : ''}`}><p>{message.body}</p><small>{message.sender_id === user.id ? 'You' : thread.otherParty} · {new Date(message.created_at).toLocaleString()}</small></div>)}</div>{thread.viewings.map((viewing) => <div className="viewing-request" key={viewing.id}><div><b>Viewing {viewing.status}</b><small>{new Date(viewing.proposed_at).toLocaleString()}</small></div>{viewing.status === 'proposed' && <div className="viewing-actions"><button className="button primary" disabled={sending === viewing.id} onClick={() => respondToViewing(viewing, true)}>Confirm</button><button className="button ghost" disabled={sending === viewing.id} onClick={() => respondToViewing(viewing, false)}>Cancel</button></div>}</div>)}<form className="support-reply" onSubmit={(event) => sendReply(event, thread)}><input aria-label="Write a reply" value={drafts[thread.id] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [thread.id]: event.target.value }))} maxLength={5000} placeholder="Write a reply to the other person"/><button className="button primary" disabled={sending === thread.id || !(drafts[thread.id] ?? '').trim()}>{sending === thread.id ? 'Sending…' : 'Reply'}</button></form></article>)}</div> : <div className="empty-state"><Icon icon={Home01Icon} size={32}/><h2>No conversations yet</h2><p>When you enquire about a home or receive an enquiry on your listing, it will show up here.</p><button className="button primary" onClick={() => navigate('homes')}>Explore homes</button></div>}</motion.div>;
}

function AuthPage({ showToast, navigate, user }) {
  const [mode, setMode] = useState('signin'); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  const authRedirect = new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
  useEffect(() => { if (user) navigate('home'); }, [user]);
  async function submit(event) {
    event.preventDefault();
    if (!isConfigured) return showToast('Account service is not configured yet.');
    setBusy(true);
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() }, emailRedirectTo: authRedirect } });
      setBusy(false);
      if (result.error) return showToast(result.error.message);
      if (mode === 'signup' && !result.data.session) return showToast('Check your email, then use the confirmation link to finish creating your account.');
      showToast(mode === 'signin' ? 'Welcome back.' : 'Your account is ready. Welcome to MoVara.');
      navigate('home');
    } catch (error) { setBusy(false); showToast(error?.message || 'We could not sign you in. Please try again.'); }
  }
  async function google() {
    if (!isConfigured) return showToast('Account service is not configured yet.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirect } });
      if (error) { setBusy(false); showToast(error.message); }
    } catch (error) { setBusy(false); showToast(error?.message || 'Google sign-in could not start. Please try again.'); }
  }
  return <motion.div className="page subpage auth-page" {...pageMotion}><form className="panel auth-panel" onSubmit={submit}>
    <span className="auth-mark"><Icon icon={Shield01Icon} size={30} /></span><span className="eyebrow">WELCOME TO MOVARA</span>
    <h1>{mode === 'signin' ? 'Good to see you.' : 'Let’s get you started.'}</h1>
    <p>{mode === 'signin' ? 'Sign in to pick up where you left off with rides, homes, and your account.' : 'Create an account to save your rides, home search, and profile details.'}</p>
    <div className="auth-tabs" role="group" aria-label="Choose sign in or account creation">
      <button type="button" className={mode === 'signin' ? 'selected' : ''} aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
      <button type="button" className={mode === 'signup' ? 'selected' : ''} aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>Create account</button>
    </div>
    {mode === 'signup' && <label className="input-label">Full name<input value={name} onChange={(e)=>setName(e.target.value)} required autoComplete="name" placeholder="Your name" /></label>}
    <label className="input-label">Email address<input type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} required placeholder="you@example.com" /></label>
    <label className="input-label">Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(e)=>setPassword(e.target.value)} required placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'} />
      {mode === 'signup' && <small className="auth-help">Use 8 or more characters. After creating your account, check your email for a confirmation link.</small>}
    </label>
    <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <Icon icon={ArrowRight01Icon} /></button>
    <div className="or"><span /> or <span /></div>
    <button type="button" className="button google full" onClick={google} disabled={busy}><GoogleMark /><span>{busy ? 'Connecting…' : 'Continue with Google'}</span></button>
    <small className="auth-foot">{mode === 'signup' ? 'New here? Your email confirmation keeps your account secure.' : 'Your account keeps your MoVara details together, wherever you go.'}</small>
  </form></motion.div>;
}

function AccountPage({ user, navigate, showToast }) {
  if (!user) return <AuthPage user={user} showToast={showToast} navigate={navigate} />;
  return <AccountDashboard user={user} navigate={navigate} showToast={showToast} />;
}

function WalletPage({user,showToast,navigate}){
  const [balance,setBalance]=useState(0);const[transactions,setTransactions]=useState([]);const[topups,setTopups]=useState([]);const[withdrawals,setWithdrawals]=useState([]);const[queue,setQueue]=useState([]);const[admin,setAdmin]=useState(false);const[busy,setBusy]=useState(false);
  const[topupAmount,setTopupAmount]=useState('2000');const[withdraw,setWithdraw]=useState({amount:'',bankCode:'',accountNumber:'',accountName:''});const[adjust,setAdjust]=useState({userId:'',amount:'',type:'admin_adjustment',reason:''});const[payoutRefs,setPayoutRefs]=useState({});
  async function load(){if(!user)return;const[bal,tx,tu,wd,role]=await Promise.all([
    supabase.rpc('wallet_balance',{p_user_id:user.id}),
    supabase.from('wallet_transactions').select('id,amount_kobo,entry_type,reference,memo,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(60),
    supabase.from('wallet_topups').select('id,amount_kobo,status,created_at,completed_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(30),
    supabase.from('wallet_withdrawals').select('id,amount_kobo,status,bank_code,account_number,account_name,created_at,provider_reference,admin_note').eq('user_id',user.id).order('created_at',{ascending:false}).limit(30),
    supabase.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle(),
  ]);if(bal.error||tx.error||tu.error||wd.error)showToast('Wallet information could not be fully loaded.');setBalance(Number(bal.data??0));setTransactions(tx.data??[]);setTopups(tu.data??[]);setWithdrawals(wd.data??[]);setAdmin(Boolean(role.data));if(role.data){const{data}=await supabase.rpc('admin_wallet_withdrawal_queue');setQueue(data??[]);}}
  useEffect(()=>{if(!user){navigate('auth');return;}load();},[user?.id]);
  async function startTopup(event){event.preventDefault();const amount=Math.round(Number(topupAmount)*100);if(!Number.isSafeInteger(amount)||amount<50000||amount>100000000)return showToast('Enter an amount from ₦500 to ₦1,000,000.');setBusy(true);const{data:topupId,error}=await supabase.rpc('wallet_request_topup',{p_amount_kobo:amount});if(error){setBusy(false);return showToast(error.message||'Wallet top up could not be created.');}const{data,error:checkoutError}=await supabase.functions.invoke('initialize-wallet-topup',{body:{topupId}});setBusy(false);if(checkoutError||!data?.authorizationUrl){showToast(data?.error||'Paystack checkout could not be started.');await load();return;}window.location.assign(data.authorizationUrl);}
  async function requestWithdrawal(event){event.preventDefault();const amount=Math.round(Number(withdraw.amount)*100);setBusy(true);const{error}=await supabase.rpc('wallet_request_withdrawal',{p_amount_kobo:amount,p_bank_code:withdraw.bankCode.trim(),p_account_number:withdraw.accountNumber.trim(),p_account_name:withdraw.accountName.trim()});setBusy(false);if(error)showToast(error.message||'Withdrawal request could not be submitted.');else{showToast('Withdrawal requested. Funds are held while the details are reviewed.');setWithdraw({amount:'',bankCode:'',accountNumber:'',accountName:''});await load();}}
  async function updateWithdrawal(row,status){const ref=payoutRefs[row.id]??'';if(status==='paid'&&!ref.trim())return showToast('Add the bank transfer reference before marking paid.');setBusy(true);const{error}=await supabase.rpc('admin_update_wallet_withdrawal',{p_id:row.id,p_status:status,p_provider_reference:ref.trim()||null,p_note:null});setBusy(false);if(error)showToast(error.message||'Withdrawal could not be updated.');else{showToast('Withdrawal status updated.');await load();}}
  async function processWithdrawal(row){setBusy(true);const{data,error}=await supabase.functions.invoke('process-wallet-withdrawal',{body:{withdrawalId:row.id}});setBusy(false);if(error||data?.error)showToast(data?.error||'Paystack transfer could not be started.');else showToast(data.message||`Paystack transfer status: ${data.status}.`);await load();}
  async function finalizeLegacyWithdrawal(row,status){const reference=payoutRefs[row.id]??'';if(status==='paid'&&reference.trim().length<2)return showToast('Enter the existing bank transfer reference.');setBusy(true);const{error}=await supabase.rpc('admin_finalize_legacy_withdrawal',{p_id:row.id,p_status:status,p_provider_reference:reference.trim()||null,p_note:'Resolved from legacy manual payout queue.'});setBusy(false);if(error)showToast(error.message||'Legacy payout could not be recorded.');else{showToast('Legacy payout record updated.');await load();}}
  async function adjustWallet(event){event.preventDefault();const amount=Math.round(Number(adjust.amount)*100);if(!adjust.userId.trim()||!Number.isSafeInteger(amount)||amount===0)return showToast('Enter a user ID and a non-zero amount.');setBusy(true);const{error}=await supabase.rpc('admin_wallet_adjustment',{p_user_id:adjust.userId.trim(),p_amount_kobo:amount,p_entry_type:adjust.type,p_reason:adjust.reason.trim()});setBusy(false);if(error)showToast(error.message||'Adjustment could not be recorded.');else{showToast('Ledger adjustment recorded.');setAdjust({...adjust,amount:'',reason:''});await load();}}
  if(!user)return <div className="page subpage"><h1>Sign in to open your wallet.</h1><button className="button primary" onClick={()=>navigate('auth')}>Sign in</button></div>;
  return <motion.div className="page subpage wallet-page" {...pageMotion}><div className="section-head"><div><span className="eyebrow">YOUR MONEY</span><h1>Wallet</h1><p>Funds and earnings are recorded as individual ledger entries.</p></div><button className="button ghost" onClick={load} disabled={busy}>Refresh</button></div>
    <section className="wallet-balance-card"><span>Available balance</span><strong>{formatMoneyKobo(balance,'NGN')}</strong><small>Nigerian naira wallet</small></section>
    <div className="wallet-actions-grid"><form className="ride-history wallet-form" onSubmit={startTopup}><h2>Add money</h2><p>Secure checkout is handled by Paystack. Top ups are credited only after server verification.</p><label className="input-label">Amount in naira<input type="number" min="500" max="1000000" step="100" value={topupAmount} onChange={e=>setTopupAmount(e.target.value)} required/></label><button className="button primary" disabled={busy}>{busy?'Preparing checkout…':'Continue to Paystack'}</button></form>
    <form className="ride-history wallet-form" onSubmit={requestWithdrawal}><h2>Request a withdrawal</h2><p>Minimum ₦1,000. Funds stay reserved until Paystack confirms the transfer.</p><label className="input-label">Amount in naira<input type="number" min="1000" max="5000000" step="100" value={withdraw.amount} onChange={e=>setWithdraw({...withdraw,amount:e.target.value})} required/></label><div className="wallet-bank-fields"><label className="input-label">Bank code<input value={withdraw.bankCode} onChange={e=>setWithdraw({...withdraw,bankCode:e.target.value})} maxLength={20} required/></label><label className="input-label">10 digit account number<input inputMode="numeric" pattern="[0-9]{10}" value={withdraw.accountNumber} onChange={e=>setWithdraw({...withdraw,accountNumber:e.target.value})} required/></label></div><label className="input-label">Account name<input value={withdraw.accountName} onChange={e=>setWithdraw({...withdraw,accountName:e.target.value})} maxLength={120} required/></label><button className="button primary" disabled={busy}>Request withdrawal</button></form></div>
    <section className="ride-history"><div className="section-head"><div><span className="eyebrow">ACCOUNT ACTIVITY</span><h2>Wallet statement</h2></div></div>{transactions.length?<div className="wallet-ledger">{transactions.map(row=><article className="wallet-ledger-row" key={row.id}><div><b>{row.memo}</b><small>{row.entry_type.replaceAll('_',' ')} · {new Date(row.created_at).toLocaleString()}</small></div><strong className={row.amount_kobo>0?'wallet-credit':'wallet-debit'}>{Number(row.amount_kobo)>0?'+':'−'}{formatMoneyKobo(Math.abs(Number(row.amount_kobo)),'NGN')}</strong></article>)}</div>:<p className="history-message">Your completed wallet activity will appear here.</p>}</section>
    <div className="wallet-actions-grid"><section className="ride-history"><h2>Top ups</h2>{topups.length?topups.map(row=><div className="wallet-ledger-row" key={row.id}><span>{new Date(row.created_at).toLocaleString()} · {row.status}</span><b>{formatMoneyKobo(row.amount_kobo,'NGN')}</b></div>):<p className="history-message">No top ups yet.</p>}</section><section className="ride-history"><h2>Withdrawals</h2>{withdrawals.length?withdrawals.map(row=><div className="wallet-ledger-row" key={row.id}><div><b>{formatMoneyKobo(row.amount_kobo,'NGN')} · {row.status}</b><small>{row.bank_code} · ••••{row.account_number.slice(-4)} · {new Date(row.created_at).toLocaleString()}</small>{row.admin_note&&<small>{row.admin_note}</small>}</div></div>):<p className="history-message">No withdrawal requests yet.</p>}</section></div>
    {admin&&<section className="ride-history wallet-admin"><span className="eyebrow">ADMIN FINANCE</span><h2>Withdrawal queue</h2><p>Paystack verifies the destination account and sends payouts from the MoVara Paystack balance. Final status comes from Paystack verification or webhook.</p>{queue.length?queue.map(row=><article className="wallet-admin-row" key={row.id}><div><b>{formatMoneyKobo(row.amount_kobo,'NGN')} · {row.status}</b><small>{row.account_name} · {row.bank_code} · {row.account_number}</small><small>User {row.user_id} · {new Date(row.created_at).toLocaleString()}</small></div><div className="wallet-admin-actions">{row.status==='requested'&&<><button className="button primary" onClick={()=>processWithdrawal(row)} disabled={busy}>Verify and send payout</button><button className="button ghost" onClick={()=>updateWithdrawal(row,'rejected')} disabled={busy}>Reject request</button></>}{row.status==='processing'&&row.provider==='paystack'&&<button className="button ghost" onClick={()=>processWithdrawal(row)} disabled={busy}>Check Paystack status</button>}{row.status==='processing'&&row.provider==='manual'&&<><input placeholder="Existing bank transfer reference" value={payoutRefs[row.id]??''} onChange={e=>setPayoutRefs({...payoutRefs,[row.id]:e.target.value})}/><button className="button primary" onClick={()=>finalizeLegacyWithdrawal(row,'paid')} disabled={busy}>Record existing payout</button><button className="button ghost" onClick={()=>finalizeLegacyWithdrawal(row,'failed')} disabled={busy}>Return held funds</button></>}</div></article>):<p className="history-message">No withdrawals need review.</p>}
    <form className="wallet-form wallet-adjust-form" onSubmit={adjustWallet}><h2>Credit or debit a wallet</h2><label className="input-label">User ID<input value={adjust.userId} onChange={e=>setAdjust({...adjust,userId:e.target.value})} required/></label><label className="input-label">Signed amount in naira<input type="number" step="0.01" value={adjust.amount} onChange={e=>setAdjust({...adjust,amount:e.target.value})} required/><small>Use a negative amount for a debit.</small></label><label className="input-label">Entry type<select value={adjust.type} onChange={e=>setAdjust({...adjust,type:e.target.value})}><option value="admin_adjustment">Admin adjustment</option><option value="promo_credit">Promo credit</option><option value="referral_credit">Referral credit</option><option value="refund_credit">Refund credit</option></select></label><label className="input-label">Reason<input value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})} maxLength={240} required/></label><button className="button primary" disabled={busy}>Record ledger entry</button></form></section>}
  </motion.div>;
}

const notificationKinds=[
  ['ride_accepted','Ride accepted'],['driver_arrived','Driver arrived'],['ride_started','Ride started'],
  ['ride_completed','Ride completed'],['ride_cancelled','Ride cancelled'],['property_enquiry','Property enquiry'],
  ['viewing_scheduled','Viewing scheduled'],['viewing_approved','Viewing approved'],['viewing_cancelled','Viewing cancelled'],
  ['support_updated','Support updated'],['sos_raised','Safety alert'],['driver_approved','Driver approved'],
  ['driver_rejected','Driver needs attention'],['landlord_approved','Landlord approved'],
  ['landlord_rejected','Landlord needs attention'],['wallet_transaction','Wallet update'],
  ['refund_approved','Refund update'],['corporate_approval','Corporate approval'],
];
const notificationChannels=[['in_app','In app'],['email','Email'],['sms','SMS'],['push','Push']];
const notificationCopy=(row)=>({ride_accepted:'Your ride is confirmed.',driver_arrived:'Your driver has arrived.',ride_started:'Your ride is underway.',ride_completed:'Your ride has been completed.',ride_cancelled:'A ride in your account has been cancelled.',enquiry_received:'Someone is interested in your property.',property_enquiry:'Someone is interested in your property.',viewing_scheduled:'A property viewing has been arranged.',viewing_approved:'Your property viewing has been confirmed.',viewing_cancelled:'A property viewing has been cancelled.',support_updated:'There is an update to your support request.',sos_raised:'MoVara has received your safety report.',driver_approved:'Your driver identity review is complete.',driver_rejected:'Review your driver account for next steps.',landlord_approved:'Your landlord identity review is complete.',landlord_rejected:'Review your landlord account for next steps.',wallet_transaction:'There is an update to your wallet.',refund_approved:'Your refund request has been approved.',corporate_approval:'There is an update to a corporate ride request.'}[row.kind]??row.payload?.body??'You have a new account update.');

function NotificationsPage({user,showToast,navigate}){
  const [rows,setRows]=useState([]);const [logs,setLogs]=useState([]);const [preferences,setPreferences]=useState([]);const [busy,setBusy]=useState(false);const [admin,setAdmin]=useState(false);
  const [broadcast,setBroadcast]=useState({kind:'service_announcement',title:'',body:'',role:''});
  async function load(){if(!user)return;const [n,p,d,r]=await Promise.all([
    supabase.from('notifications').select('id,kind,payload,read_at,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(80),
    supabase.from('notification_preferences').select('kind,channel,enabled').eq('user_id',user.id),
    supabase.from('notification_delivery_logs').select('id,channel,provider,status,error_code,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(80),
    supabase.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle(),
  ]);if(n.error||p.error||d.error)showToast('Some notification history could not be loaded.');setRows(n.data??[]);setPreferences(p.data??[]);setLogs(d.data??[]);setAdmin(Boolean(r.data));}
  useEffect(()=>{if(!user){navigate('auth');return;}load();const channel=supabase.channel(`notifications-page-${user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${user.id}`},load).subscribe();return()=>supabase.removeChannel(channel);},[user?.id]);
  const enabled=(kind,channel)=>{const exact=preferences.find((item)=>item.kind===kind&&item.channel===channel);const all=preferences.find((item)=>item.kind==='all'&&item.channel===channel);if(exact)return exact.enabled;if(all)return all.enabled;return channel==='in_app'||channel==='email';};
  async function toggle(kind,channel){const value=!enabled(kind,channel);setBusy(true);const{error}=await supabase.rpc('notification_set_preference',{p_kind:kind,p_channel:channel,p_enabled:value});setBusy(false);if(error)showToast('That notification setting could not be saved.');else{await load();showToast(`${channel==='in_app'?'In-app':channel} notifications ${value?'on':'off'}.`);}}
  async function markRead(row){const{error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',row.id).eq('user_id',user.id);if(error)showToast('Notification could not be marked read.');else setRows((items)=>items.map((item)=>item.id===row.id?{...item,read_at:new Date().toISOString()}:item));}
  async function markAll(){setBusy(true);const{data,error}=await supabase.rpc('notification_mark_all_read');setBusy(false);if(error)showToast('Notifications could not be marked read.');else{showToast(`${data??0} notifications marked read.`);load();}}
  async function sendBroadcast(event){event.preventDefault();setBusy(true);const{data,error}=await supabase.rpc('admin_notification_broadcast',{p_kind:broadcast.kind,p_title:broadcast.title.trim(),p_body:broadcast.body.trim(),p_role:broadcast.role||null});setBusy(false);if(error)showToast('Broadcast was not created.');else{showToast(`Announcement sent to ${data} accounts.`);setBroadcast({...broadcast,title:'',body:''});}}
  if(!user)return <div className="page subpage"><h1>Sign in to view updates.</h1><button className="button primary" onClick={()=>navigate('auth')}>Sign in</button></div>;
  const unread=rows.filter((item)=>!item.read_at).length;
  return <motion.div className="page subpage notification-page" {...pageMotion}>
    <div className="section-head"><div><span className="eyebrow">YOUR UPDATES</span><h1>Notifications</h1><p>{unread?`${unread} unread update${unread===1?'':'s'}`:'You are all caught up.'}</p></div><button className="button ghost" onClick={markAll} disabled={busy||!unread}>Mark all read</button></div>
    <div className="notification-layout"><section className="notification-list"><h2>Recent updates</h2>{rows.length?rows.map((row)=><article className={`notification-card ${row.read_at?'is-read':'is-unread'}`} key={row.id}><div className="notification-card-head"><b>{row.payload?.title??row.kind.replaceAll('_',' ')}</b><time>{new Date(row.created_at).toLocaleString()}</time></div><p>{notificationCopy(row)}</p>{!row.read_at&&<button className="text-action" onClick={()=>markRead(row)}>Mark read</button>}</article>):<div className="empty-state"><h3>No updates yet</h3><p>Ride, home, and account updates will appear here.</p></div>}
    <div className="notification-history"><h2>Delivery history</h2>{logs.length?logs.map((item)=><div className="notification-log" key={item.id}><span>{item.channel.toUpperCase()} · {item.provider}</span><b className={`delivery-${item.status}`}>{item.status}</b><time>{new Date(item.created_at).toLocaleString()}</time></div>):<p className="history-message">No email, SMS, or push delivery attempts yet.</p>}</div></section>
    <aside className="notification-settings"><h2>How to reach you</h2><p>Choose where MoVara can send service updates. Transactional updates use your account details.</p><div className="notification-preference"><span>All notifications</span>{notificationChannels.map(([channel,label])=><label key={channel}><input type="checkbox" checked={enabled('all',channel)} onChange={()=>toggle('all',channel)} disabled={busy}/>{label}</label>)}</div><details className="notification-detail"><summary>Choose by update type</summary>{notificationKinds.map(([kind,label])=><div className="notification-preference" key={kind}><span>{label}</span>{notificationChannels.map(([channel,chLabel])=><label key={channel} title={chLabel}><input type="checkbox" checked={enabled(kind,channel)} onChange={()=>toggle(kind,channel)} disabled={busy}/><small>{chLabel}</small></label>)}</div>)}</details>
    {admin&&<div className="notification-broadcast"><h2>Admin broadcast</h2><p>Send an in-app notice to all accounts or one role.</p><form onSubmit={sendBroadcast}><label className="input-label">Notice type<select value={broadcast.kind} onChange={(e)=>setBroadcast({...broadcast,kind:e.target.value})}><option value="service_announcement">Service announcement</option><option value="maintenance_notice">Maintenance notice</option><option value="safety_notice">Safety notice</option></select></label><label className="input-label">Audience<select value={broadcast.role} onChange={(e)=>setBroadcast({...broadcast,role:e.target.value})}><option value="">All accounts</option>{['customer','driver','landlord','administrator'].map((role)=><option key={role} value={role}>{role}</option>)}</select></label><label className="input-label">Title<input maxLength={120} required value={broadcast.title} onChange={(e)=>setBroadcast({...broadcast,title:e.target.value})}/></label><label className="input-label">Message<textarea maxLength={1000} required rows={4} value={broadcast.body} onChange={(e)=>setBroadcast({...broadcast,body:e.target.value})}/></label><button className="button primary" disabled={busy}>{busy?'Sending…':'Send announcement'}</button></form></div>}
    </aside></div>
  </motion.div>;
}

function AdminFinancePage({user,showToast,navigate}){
  const[authorized,setAuthorized]=useState(null);const[payments,setPayments]=useState([]);const[refunds,setRefunds]=useState([]);const[runs,setRuns]=useState([]);const[items,setItems]=useState([]);const[selectedRun,setSelectedRun]=useState(null);const[busy,setBusy]=useState(false);const[refundDraft,setRefundDraft]=useState(null);
  async function load(){
    if(!user){setAuthorized(false);return;}
    const{data:role}=await supabase.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle();
    if(!role){setAuthorized(false);return;}setAuthorized(true);
    const[paymentResult,refundResult,runResult]=await Promise.all([
      supabase.from('payments').select('id,ride_id,payer_id,payment_type,amount_kobo,currency,status,provider,provider_reference,created_at,updated_at').eq('provider','paystack').order('created_at',{ascending:false}).limit(100),
      supabase.from('paystack_refunds').select('id,payment_id,amount_kobo,currency,customer_reason,merchant_reason,status,provider_reference,provider_status,failure_reason,created_at,processed_at').order('created_at',{ascending:false}).limit(100),
      supabase.from('payment_reconciliation_runs').select('id,status,checked_count,mismatch_count,error_summary,started_at,completed_at').order('started_at',{ascending:false}).limit(20),
    ]);
    if(paymentResult.error||refundResult.error||runResult.error)showToast('Some finance records could not be loaded. Check that the finance migration is applied.');
    setPayments(paymentResult.data??[]);setRefunds(refundResult.data??[]);setRuns(runResult.data??[]);
  }
  useEffect(()=>{load();},[user?.id]);
  async function reconcile(){setBusy(true);const{data,error}=await supabase.functions.invoke('reconcile-payments',{body:{}});setBusy(false);if(error||data?.error){showToast(data?.error??'Reconciliation could not be completed.');return;}showToast(`Checked ${data.checkedCount} payments. ${data.mismatchCount} need review.`);await load();}
  async function submitRefund(event){event.preventDefault();if(!refundDraft)return;const amount=Math.round(Number(refundDraft.amount)*100);if(!Number.isSafeInteger(amount)||amount<=0)return showToast('Enter a valid refund amount.');setBusy(true);const{data:refundId,error}=await supabase.rpc('admin_request_paystack_refund',{p_payment_id:refundDraft.paymentId,p_amount_kobo:amount,p_customer_reason:refundDraft.customerReason.trim(),p_merchant_reason:refundDraft.merchantReason.trim()});if(error){setBusy(false);showToast(error.message||'Refund request could not be recorded.');return;}const{data,error:providerError}=await supabase.functions.invoke('process-paystack-refund',{body:{refundId}});setBusy(false);if(providerError||data?.error)showToast(data?.error||'Refund was created but provider processing needs review.');else showToast(`Refund sent to Paystack: ${data.status}.`);setRefundDraft(null);await load();}
  async function openRun(run){if(selectedRun===run.id){setSelectedRun(null);setItems([]);return;}setSelectedRun(run.id);const{data,error}=await supabase.from('payment_reconciliation_items').select('id,payment_id,expected_status,provider_status,expected_amount_kobo,provider_amount_kobo,provider_currency,matches,detail,checked_at').eq('run_id',run.id).order('checked_at',{ascending:false});if(error)showToast('Reconciliation details could not be loaded.');setItems(data??[]);}
  if(authorized===false)return <motion.div className="page subpage" {...pageMotion}><div className="panel"><h1>Finance operations</h1><p>Administrator access is required.</p><button className="button ghost" onClick={()=>navigate('account')}>Back to account</button></div></motion.div>;
  if(authorized===null)return <div className="page subpage"><p className="history-message">Loading finance records…</p></div>;
  return <motion.div className="page subpage admin-finance-page" {...pageMotion}>
    <div className="section-head"><div><span className="eyebrow">ADMIN CONTROL</span><h1>Payments and refunds</h1><p>Review provider payments, issue refunds, and compare local records with Paystack.</p></div><div className="admin-finance-controls"><button className="button ghost" onClick={load} disabled={busy}>Refresh</button><button className="button primary" onClick={reconcile} disabled={busy}>{busy?'Working…':'Reconcile payments'}</button></div></div>
    <div className="admin-finance-note"><b>Reconciliation checks the latest 100 Paystack transactions.</b><span>It verifies amount, currency, and provider status. It does not initiate transfers or change successful payment records to failed.</span></div>
    <section className="ride-history admin-finance-section"><div className="section-head"><div><span className="eyebrow">PAYMENT REGISTER</span><h2>Recent payments</h2></div></div>
      {payments.length?payments.map(payment=>{const open=refundDraft?.paymentId===payment.id;return <article className="admin-finance-row" key={payment.id}><div className="admin-finance-main"><b>{formatMoneyKobo(payment.amount_kobo,payment.currency)} · {payment.status}</b><span>{payment.payment_type.replaceAll('_',' ')} · {new Date(payment.created_at).toLocaleString()}</span><small>Customer {payment.payer_id} · Ref {payment.provider_reference??'not assigned'}</small>{payment.ride_id&&<small>Ride {payment.ride_id}</small>}</div>{payment.status==='succeeded'&&payment.provider_reference&&<button className="button ghost" disabled={busy} onClick={()=>setRefundDraft(open?null:{paymentId:payment.id,amount:String(Number(payment.amount_kobo)/100),customerReason:'Refund requested by customer',merchantReason:''})}>{open?'Close':'Request refund'}</button>}{open&&<form className="admin-finance-refund-form" onSubmit={submitRefund}><label className="input-label">Refund amount in naira<input type="number" min="1" max={Number(payment.amount_kobo)/100} step="0.01" required value={refundDraft.amount} onChange={e=>setRefundDraft({...refundDraft,amount:e.target.value})}/></label><label className="input-label">Customer reason<input required maxLength={500} value={refundDraft.customerReason} onChange={e=>setRefundDraft({...refundDraft,customerReason:e.target.value})}/></label><label className="input-label">Internal reason<input required minLength="3" maxLength={500} value={refundDraft.merchantReason} onChange={e=>setRefundDraft({...refundDraft,merchantReason:e.target.value})}/></label><button className="button primary" disabled={busy}>Send refund request to Paystack</button><small>Refunds remain pending until Paystack confirms their final status by webhook.</small></form>}</article>;}):<p className="history-message">No Paystack payments found.</p>}
    </section>
    <section className="ride-history admin-finance-section"><span className="eyebrow">PROVIDER REFUNDS</span><h2>Refund history</h2>{refunds.length?refunds.map(refund=><article className="admin-finance-row" key={refund.id}><div className="admin-finance-main"><b>{formatMoneyKobo(refund.amount_kobo,refund.currency)} · {refund.status}</b><span>Provider status: {refund.provider_status??'awaiting submission'} · {new Date(refund.created_at).toLocaleString()}</span><small>{refund.provider_reference} · payment {refund.payment_id}</small><small>Customer reason: {refund.customer_reason}</small>{refund.failure_reason&&<small className="admin-finance-error">{refund.failure_reason}</small>}</div></article>):<p className="history-message">No refund requests yet.</p>}</section>
    <section className="ride-history admin-finance-section"><span className="eyebrow">RECONCILIATION</span><h2>Recent checks</h2>{runs.length?runs.map(run=><div className="admin-finance-run" key={run.id}><button className="admin-finance-run-button" onClick={()=>openRun(run)}><b>{run.status} · {run.mismatch_count} need review</b><span>{run.checked_count} checked · {new Date(run.started_at).toLocaleString()}</span></button>{selectedRun===run.id&&<div className="admin-finance-items">{items.length?items.map(item=><article className="admin-finance-row" key={item.id}><div className="admin-finance-main"><b>{item.matches?'Matched':'Review required'} · {item.payment_id}</b><span>Local {item.expected_status} · Paystack {item.provider_status}</span>{item.detail&&<small>{item.detail}</small>}</div>{item.provider_amount_kobo!=null&&<strong>{formatMoneyKobo(item.provider_amount_kobo,item.provider_currency??'NGN')}</strong>}</article>):<p className="history-message">This run has no transaction detail rows.</p>}</div>}</div>):<p className="history-message">No reconciliation runs yet.</p>}</section>
    <button className="button ghost" onClick={()=>navigate('account')}>Back to account</button>
  </motion.div>;
}

function AccountDashboard({ user, navigate, showToast }) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'administrator').maybeSingle().then(({ data }) => setIsAdmin(Boolean(data))); }, [user.id]);
  return <motion.div className="page subpage account-page" {...pageMotion}><span className="eyebrow">YOUR SPACE</span><h1>Welcome back.</h1><p>{user.email}</p><div className="account-grid"><div className="account-tile"><Icon icon={Car01Icon} /><h3>Your rides</h3><p>Ride history and updates from your trips.</p><button className="text-action" onClick={()=>navigate('rides')}>Book a ride <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Home01Icon}/><h3>Saved homes</h3><p>Keep the places you love close by.</p><button className="text-action" onClick={()=>navigate('saved-homes')}>View saved homes <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Building03Icon}/><h3>Manage listings</h3><p>Create a home listing and track its review status.</p><button className="text-action" onClick={()=>navigate('landlord-properties')}>Open landlord space <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Building03Icon}/><h3>Property conversations</h3><p>Reply to home enquiries and manage viewing requests.</p><button className="text-action" onClick={()=>navigate('home-inbox')}>Open inbox <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Shield01Icon}/><h3>Safety and support</h3><p>Emergency contacts, trip concerns, and help from MoVara.</p><button className="text-action" onClick={()=>navigate('safety')}>Open safety center <Icon icon={ArrowRight01Icon}/></button></div>{isAdmin && <><div className="account-tile"><Icon icon={Wallet01Icon}/><h3>Pricing control</h3><p>Manage fares, surge, service areas, airport pricing, promos, and commissions.</p><button className="text-action" onClick={()=>navigate('admin-pricing')}>Open fare engine <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Wallet01Icon}/><h3>Finance operations</h3><p>Review provider payments, process refunds, and check reconciliation runs.</p><button className="text-action" onClick={()=>navigate('admin-finance')}>Open finance <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Shield01Icon}/><h3>Support and safety queue</h3><p>Review customer tickets and ride safety events.</p><button className="text-action" onClick={()=>navigate('admin-support')}>Open operations queue <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Building03Icon}/><h3>Property review</h3><p>Review listings and verify marketplace readiness.</p><button className="text-action" onClick={()=>navigate('admin-properties')}>Open review queue <Icon icon={ArrowRight01Icon}/></button></div></>}</div><button className="button ghost" onClick={async()=>{await supabase.auth.signOut();showToast('You have signed out.');navigate('home');}}>Sign out</button></motion.div>;
}

function RideRating({ onSubmit }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="ride-feedback" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(rating, comment); setBusy(false); }}>
    <b>How was your ride?</b><div className="rating-stars" role="group" aria-label="Rate your ride">{[1,2,3,4,5].map((value) => <button type="button" key={value} aria-label={`${value} star${value > 1 ? 's' : ''}`} aria-pressed={rating === value} onClick={() => setRating(value)}><Icon icon={StarIcon} size={22} className={value <= rating ? 'star-filled' : ''} /></button>)}</div>
    <label className="input-label"><textarea maxLength={1000} rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a note for the team, if you like" /></label><button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Send rating'}</button>
  </form>;
}

function SupportTicketCard({ ticket, onReply }) {
  const [messages,setMessages]=useState([]); const [body,setBody]=useState(''); const [busy,setBusy]=useState(false);
  async function loadMessages(){const {data,error}=await supabase.rpc('my_support_messages',{p_ticket_id:ticket.id});if(!error)setMessages(data??[]);}
  useEffect(()=>{loadMessages();},[ticket.id,ticket.updated_at]);
  async function send(event){event.preventDefault();if(!body.trim())return;setBusy(true);await onReply(ticket.id,body.trim());setBody('');setBusy(false);loadMessages();}
  return <article className="ride-history-card"><div className="ride-history-top"><span className={`ride-status status-${ticket.status.replaceAll('_',' ')}`}>{ticket.status.replaceAll('_',' ')}</span><b>{ticket.category.replaceAll('_',' ')}</b></div><p className="ticket-message">{ticket.message}</p><small>{new Date(ticket.created_at).toLocaleString()}</small>{ticket.resolution&&<div className="ride-live-note">{ticket.resolution}</div>}<div className="support-thread">{messages.map(message=><div className="support-message" key={message.id}><p>{message.body}</p><small>{message.author_id===ticket.reporter_id?'You':'MoVara support'} · {new Date(message.created_at).toLocaleString()}</small></div>)}</div>{ticket.status!=='closed'&&<form className="support-reply" onSubmit={send}><input value={body} onChange={e=>setBody(e.target.value)} maxLength={4000} placeholder="Reply to support" aria-label="Reply to support"/><button className="button primary" disabled={busy||!body.trim()}>{busy?'Sending…':'Reply'}</button></form>}</article>;
}

function SafetyCenterPage({ user, showToast, navigate }) {
  const [contacts, setContacts] = useState([]); const [tickets, setTickets] = useState([]); const [rides, setRides] = useState([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [relationship, setRelationship] = useState('');
  const [category, setCategory] = useState('ride_issue'); const [rideId, setRideId] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function load() {
    if (!user) return;
    const [contactResult, ticketResult, rideResult] = await Promise.all([
      supabase.from('emergency_contacts').select('id,name,phone,relationship,created_at').order('created_at'),
      supabase.rpc('my_support_tickets'),
      supabase.from('rides').select('id,pickup_label,destination_label,status,created_at').order('created_at',{ascending:false}).limit(20),
    ]);
    if (contactResult.error || ticketResult.error || rideResult.error) showToast('Safety center data could not be loaded. Please retry.');
    setContacts(contactResult.data ?? []); setTickets(ticketResult.data ?? []); setRides(rideResult.data ?? []);
  }
  useEffect(() => { if (!user) navigate('auth'); else load(); }, [user?.id]);
  async function addContact(event) {
    event.preventDefault(); if (!/^\+?[0-9 ()-]{7,32}$/.test(phone.trim())) return showToast('Enter a valid phone number.');
    setBusy(true); const { error } = await supabase.from('emergency_contacts').insert({ user_id:user.id,name:name.trim(),phone:phone.trim(),relationship:relationship.trim() }); setBusy(false);
    if (error) showToast('Emergency contact could not be saved.'); else { setName('');setPhone('');setRelationship('');showToast('Emergency contact saved.');load(); }
  }
  async function removeContact(id) { const { error } = await supabase.from('emergency_contacts').delete().eq('id',id); if (error) showToast('Contact could not be removed.'); else load(); }
  async function submitTicket(event) {
    event.preventDefault(); setBusy(true); const { error } = await supabase.rpc('create_support_ticket',{p_category:category,p_message:message,p_ride_id:rideId || null}); setBusy(false);
    if (error) showToast(error.message || 'Your request could not be sent.'); else { setMessage('');setRideId('');showToast('Your support request is in the queue.');load(); }
  }
  if (!user) return null;
  async function replyToTicket(ticketId, body) { const {error}=await supabase.rpc('add_support_reply',{p_ticket_id:ticketId,p_body:body}); if(error)showToast('Reply could not be sent.');else load(); }
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">HERE WHEN YOU NEED US</span><h1>Safety and support</h1><p>Keep a trusted contact nearby and tell our team what happened. If there is immediate danger, call 112.</p></div><div className="safety-grid"><section className="panel safety-panel"><h2>Emergency contacts</h2><p>Add people you trust. Your contact list stays private to your account.</p><form onSubmit={addContact}><label className="input-label">Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" /></label><div className="ride-extra-grid"><label className="input-label">Phone<input required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+234…" /></label><label className="input-label">Relationship<input maxLength={60} value={relationship} onChange={e=>setRelationship(e.target.value)} placeholder="Friend, family" /></label></div><button className="button primary" disabled={busy}>{busy?'Saving…':'Add contact'}</button></form><div className="contact-list">{contacts.map(contact=><article key={contact.id}><div><b>{contact.name}</b><small>{contact.phone}{contact.relationship?` · ${contact.relationship}`:''}</small></div><button className="text-action" onClick={()=>removeContact(contact.id)}>Remove</button></article>)}{!contacts.length&&<p className="history-message">No emergency contacts saved yet.</p>}</div></section><section className="panel safety-panel"><h2>Contact support</h2><p>Choose a category and include the ride if your request is about a trip.</p><form onSubmit={submitTicket}><label className="input-label">What do you need help with?<select value={category} onChange={e=>setCategory(e.target.value)}><option value="ride_issue">A ride</option><option value="payment">Payment</option><option value="lost_item">Lost item</option><option value="account">Account</option><option value="property">Property</option><option value="other">Something else</option></select></label><label className="input-label">Related ride<select value={rideId} onChange={e=>setRideId(e.target.value)}><option value="">No ride selected</option>{rides.map(ride=><option key={ride.id} value={ride.id}>{ride.pickup_label} to {ride.destination_label} · {ride.status}</option>)}</select></label><label className="input-label">Tell us what happened<textarea required minLength={5} maxLength={4000} rows={5} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Include the details our team needs to help." /></label><button className="button primary" disabled={busy}>{busy?'Sending…':'Send to support'}</button></form></section></div><section className="ride-history"><div className="section-head"><div><span className="eyebrow">YOUR REQUESTS</span><h2>Support history</h2></div><button className="text-action" onClick={load}>Refresh</button></div><div className="ride-history-list">{tickets.map(ticket=><SupportTicketCard key={ticket.id} ticket={ticket} onReply={replyToTicket} />)}{!tickets.length&&<p className="history-message">Your support requests will appear here.</p>}</div></section></motion.div>;
}

function AdminPropertyReviewPage({ user, showToast, navigate }) {
  const [isAdmin, setIsAdmin] = useState(false); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(null); const [reasons, setReasons] = useState({});
  async function load() {
    if (!user) { setLoading(false); return; }
    const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'administrator').maybeSingle();
    const allowed = Boolean(role); setIsAdmin(allowed);
    if (!allowed) { setLoading(false); return; }
    const { data, error } = await supabase.from('properties').select('id,landlord_id,title,description,category,transaction_type,price_ngn_kobo,state_code,address,status,verification,created_at,property_images(object_path,sort_order)').in('status', ['pending_review','published','paused','rejected']).order('created_at', { ascending: false }).limit(100);
    if (error) showToast('The property review queue could not be loaded.');
    const landlordIds = [...new Set((data ?? []).map((row) => row.landlord_id))];
    const { data: verifications } = landlordIds.length ? await supabase.from('landlord_verifications').select('landlord_id,status').in('landlord_id', landlordIds) : { data: [] };
    const verificationMap = Object.fromEntries((verifications ?? []).map((row) => [row.landlord_id, row.status]));
    setRows((data ?? []).map((row) => ({ ...row, landlordVerification: verificationMap[row.landlord_id] ?? 'not_submitted' }))); setLoading(false);
  }
  useEffect(() => { if (!user) navigate('auth'); else load(); }, [user?.id]);
  async function review(row, status) {
    const reason = (reasons[row.id] ?? '').trim();
    if (reason.length < 3) return showToast('Add a short review note before making a decision.');
    setBusy(row.id);
    const { error } = await supabase.rpc('admin_review_property', { p_property_id: row.id, p_status: status, p_reason: reason });
    setBusy(null);
    if (error) return showToast(error.message.includes('identity verification') ? 'Approve the landlord’s identity check before approving this listing.' : 'The listing review could not be saved. Refresh and try again.');
    showToast(`Listing ${status}.`); await load();
  }
  if (!isAdmin && !loading) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state"><h2>Administrator access required</h2><p>This review queue is available to authorized MoVara administrators.</p><button className="button ghost" onClick={() => navigate('account')}>Back to your account</button></div></motion.div>;
  const queue = rows.filter((row) => row.status === 'pending_review' || row.verification !== 'approved');
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">MARKETPLACE OPERATIONS</span><h1>Property review</h1><p>Check listing details and verification status before approving homes for the marketplace.</p></div><div className="property-inbox-head"><span>{queue.length} awaiting review</span><button className="text-action" onClick={load}>Refresh</button></div>{loading ? <div className="empty-state">Loading listings…</div> : queue.length ? <div className="property-review-list">{queue.map((row) => <article className="panel property-review-card" key={row.id}><div className="property-review-image">{row.property_images?.[0]?.object_path ? <PropertyReviewImage path={row.property_images[0].object_path} title={row.title}/> : <Icon icon={Home01Icon} size={32}/>}</div><div className="property-review-body"><div className="ride-history-top"><span className={`ride-status status-${row.status}`}>{row.status.replaceAll('_',' ')}</span><span className={`ride-status status-${row.verification}`}>{row.verification.replaceAll('_',' ')}</span></div><h2>{row.title}</h2><p>{row.address}, {row.state_code} · {row.category.replaceAll('_',' ')} · {row.transaction_type}</p><b>₦{Math.round(row.price_ngn_kobo / 100).toLocaleString()}</b><p>{row.description || 'No listing description supplied.'}</p><small>Landlord identity: {row.landlordVerification.replaceAll('_',' ')}</small>{row.landlordVerification !== 'approved' && <p className="review-hint">Landlord identity verification must be approved before this listing can be published.</p>}<label className="input-label">Decision note<textarea rows="2" maxLength="2000" value={reasons[row.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Add a clear review reason" /></label><div className="review-actions"><button className="button primary" disabled={busy === row.id || row.landlordVerification !== 'approved'} onClick={() => review(row, 'approved')}>Approve and publish</button><button className="button ghost" disabled={busy === row.id} onClick={() => review(row, 'rejected')}>Reject listing</button></div></div></article>)}</div> : <div className="empty-state"><Icon icon={CheckmarkCircle02Icon} size={32}/><h2>Review queue is clear</h2><p>New listings awaiting a decision will appear here.</p></div>}</motion.div>;
}

function PropertyReviewImage({ path, title }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let active = true; supabase.storage.from('property-images').createSignedUrl(path, 3600).then(({ data }) => { if (active) setUrl(data?.signedUrl ?? ''); }); return () => { active = false; }; }, [path]);
  return url ? <img src={url} alt={title}/> : <Icon icon={Home01Icon} size={32}/>;
}

function LandlordPropertiesPage({ user, showToast, navigate }) {
  const blank = { id: null, title: '', description: '', category: 'self_contained', transaction_type: 'rent', price: '', state_code: '', lga_id: '', address: '' };
  const [isLandlord, setIsLandlord] = useState(false); const [loading, setLoading] = useState(true); const [rows, setRows] = useState([]); const [states, setStates] = useState([]); const [lgas, setLgas] = useState([]); const [form, setForm] = useState(blank); const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false);
  async function load() {
    if (!user) { setLoading(false); return; }
    const [roleResult, stateResult, lgaResult] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'landlord').maybeSingle(),
      supabase.from('nigerian_states').select('code,name').order('name'),
      supabase.from('nigerian_lgas').select('id,name,state_code').order('name'),
    ]);
    const allowed = Boolean(roleResult.data); setIsLandlord(allowed); setStates(stateResult.data ?? []); setLgas(lgaResult.data ?? []);
    if (allowed) { const { data, error } = await supabase.from('properties').select('id,title,description,category,transaction_type,price_ngn_kobo,state_code,lga_id,address,status,verification,created_at,property_images(object_path,sort_order)').eq('landlord_id', user.id).order('created_at', { ascending: false }); if (error) showToast('Your property listings could not be loaded.'); setRows(data ?? []); }
    setLoading(false);
  }
  useEffect(() => { if (!user) navigate('auth'); else load(); }, [user?.id]);
  function editListing(row) { setForm({ id: row.id, title: row.title, description: row.description ?? '', category: row.category, transaction_type: row.transaction_type, price: String(Math.round(row.price_ngn_kobo / 100)), state_code: row.state_code, lga_id: row.lga_id, address: row.address }); setFiles([]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  async function submit(event) {
    event.preventDefault(); if (!isLandlord) return;
    setBusy(true);
    const { data: propertyId, error } = await supabase.rpc('submit_property_listing', { p_property_id: form.id, p_title: form.title.trim(), p_description: form.description.trim(), p_category: form.category, p_transaction_type: form.transaction_type, p_price_ngn_kobo: Math.round(Number(form.price) * 100), p_state_code: form.state_code, p_lga_id: form.lga_id, p_neighbourhood_id: null, p_address: form.address.trim() });
    if (error) { setBusy(false); showToast(error.message.includes('Landlord access required') ? 'Your landlord role needs approval before you can submit a listing.' : 'The listing could not be submitted. Check the details and try again.'); return; }
    let imageFailed = false;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]; const imageId = crypto.randomUUID();
      const { data: objectPath, error: registerError } = await supabase.rpc('register_property_image', { p_property_id: propertyId, p_image_id: imageId, p_sort_order: index });
      if (registerError) { imageFailed = true; continue; }
      const { error: uploadError } = await supabase.storage.from('property-images').upload(objectPath, file, { contentType: file.type, upsert: false });
      if (uploadError) imageFailed = true;
    }
    setBusy(false); setForm(blank); setFiles([]); await load();
    showToast(imageFailed ? 'Listing submitted for review, but one or more photos could not be uploaded. Edit the listing to try again.' : form.id ? 'Listing updated and returned to review.' : 'Listing submitted for review.');
  }
  async function requestLandlordRole() {
    setBusy(true); const { error } = await supabase.rpc('request_marketplace_role', { p_role: 'landlord' }); setBusy(false);
    showToast(error ? 'We could not submit your landlord application. Please try again.' : 'Landlord access requested. Complete identity verification while the team reviews your application.');
  }
  if (!user) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state"><h2>Sign in to list a home</h2><button className="button primary" onClick={() => navigate('auth')}>Sign in</button></div></motion.div>;
  if (loading) return <motion.div className="page subpage" {...pageMotion}><div className="empty-state">Loading your properties…</div></motion.div>;
  if (!isLandlord) return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">LIST WITH MOVARA</span><h1>Bring your home to the right people.</h1><p>Request landlord access to create and manage property listings.</p></div><section className="panel landlord-apply"><Icon icon={Building03Icon} size={32}/><h2>Landlord access</h2><p>Applications require identity verification before listings can be published.</p><button className="button primary" disabled={busy} onClick={requestLandlordRole}>{busy ? 'Sending request…' : 'Request landlord access'}</button></section></motion.div>;
  const filteredLgas = lgas.filter((lga) => lga.state_code === form.state_code);
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">LANDLORD SPACE</span><h1>Your property listings.</h1><p>Create a listing and track it through review to publication.</p></div><div className="landlord-layout"><form className="panel landlord-form" onSubmit={submit}><div className="form-heading"><span className="form-step">{form.id ? 'EDIT' : 'NEW'}</span><div><h2>{form.id ? 'Edit your listing' : 'Add a property'}</h2><p>Every new or changed listing is reviewed before publication.</p></div></div><label className="input-label">Listing title<input required minLength={3} maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="A bright two-bedroom apartment"/></label><div className="ride-extra-grid"><label className="input-label">Rent or sale<select value={form.transaction_type} onChange={(event) => setForm({ ...form, transaction_type: event.target.value })}><option value="rent">For rent</option><option value="sale">For sale</option></select></label><label className="input-label">Home type<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{['self_contained','one_bedroom','two_bedroom','three_bedroom','duplex','commercial','land'].map((item)=><option key={item} value={item}>{item.replaceAll('_',' ')}</option>)}</select></label></div><label className="input-label">Price in naira<input required type="number" min="1" step="1" inputMode="numeric" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })}/></label><div className="ride-extra-grid"><label className="input-label">State<select required value={form.state_code} onChange={(event) => setForm({ ...form, state_code: event.target.value, lga_id: '' })}><option value="">Choose state</option>{states.map((item)=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label><label className="input-label">Local government<select required disabled={!form.state_code} value={form.lga_id} onChange={(event) => setForm({ ...form, lga_id: event.target.value })}><option value="">Choose LGA</option>{filteredLgas.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label className="input-label">Street address<input required maxLength={500} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Street, area or neighbourhood"/></label><label className="input-label">About the home<textarea rows="5" maxLength={10000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the space, amenities, and anything a home seeker should know."/></label><label className="input-label">Photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 8))}/><small>JPG, PNG, or WebP. Up to 8 photos, 10 MB each.</small></label>{files.length > 0 && <small>{files.length} photo{files.length === 1 ? '' : 's'} ready to upload.</small>}<div className="landlord-form-actions"><button className="button primary" disabled={busy}>{busy ? 'Submitting…' : form.id ? 'Save and resubmit' : 'Submit for review'}</button>{form.id && <button type="button" className="button ghost" onClick={() => { setForm(blank); setFiles([]); }}>Cancel edit</button>}</div></form><section className="landlord-listings"><div className="section-head"><div><span className="eyebrow">YOUR LISTINGS</span><h2>{rows.length} {rows.length === 1 ? 'property' : 'properties'}</h2></div><button className="text-action" onClick={load}>Refresh</button></div>{rows.length ? rows.map((row) => <article className="panel landlord-listing" key={row.id}><div className="landlord-listing-cover">{row.property_images?.[0]?.object_path && <PropertyReviewImage path={row.property_images[0].object_path} title={row.title}/>}</div><div><span className={`ride-status status-${row.status}`}>{row.status.replaceAll('_',' ')}</span><h3>{row.title}</h3><small>{row.address} · ₦{Math.round(row.price_ngn_kobo/100).toLocaleString()}</small>{row.status !== 'pending_review' && <button className="text-action" onClick={() => editListing(row)}>Edit listing <Icon icon={ArrowRight01Icon}/></button>}</div></article>) : <div className="empty-state"><h3>No listings yet</h3><p>Your submitted homes will be listed here.</p></div>}</section></div></motion.div>;
}

function AdminSupportPage({ user, showToast, navigate }) {
  const [authorized,setAuthorized]=useState(null); const [tickets,setTickets]=useState([]); const [events,setEvents]=useState([]); const [busy,setBusy]=useState(''); const [resolutions,setResolutions]=useState({});
  async function load() { const [ticketRows,eventRows]=await Promise.all([supabase.rpc('admin_list_support_tickets'),supabase.rpc('admin_list_safety_events')]); if(ticketRows.error||eventRows.error) showToast('Operations queue could not be loaded.');setTickets(ticketRows.data??[]);setEvents(eventRows.data??[]); }
  useEffect(()=>{if(!user){navigate('auth');return;}supabase.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle().then(({data})=>{setAuthorized(Boolean(data));if(data)load();});},[user?.id]);
  async function updateTicket(ticket,status){setBusy(ticket.id);const {error}=await supabase.rpc('admin_update_support_ticket',{p_ticket_id:ticket.id,p_status:status,p_resolution:resolutions[ticket.id]??ticket.resolution??null});setBusy('');if(error)showToast('Ticket update failed.');else{showToast('Ticket updated.');load();}}
  async function updateEvent(event,status){setBusy(event.id);const {error}=await supabase.rpc('admin_update_safety_event',{p_event_id:event.id,p_status:status});setBusy('');if(error)showToast('Safety report update failed.');else load();}
  async function assignTicket(ticket, assignee) { const {error}=await supabase.rpc('admin_assign_support_ticket',{p_ticket_id:ticket.id,p_assignee:assignee||null});if(error)showToast('Ticket assignment failed.');else{showToast('Ticket assigned.');load();} }
  async function addEventNote(event) { const note=window.prompt('Add a private note for MoVara safety staff.');if(!note?.trim())return;const {error}=await supabase.rpc('admin_add_safety_event_note',{p_event_id:event.id,p_note:note.trim()});if(error)showToast('Private note could not be saved.');else showToast('Private note saved.'); }
  async function addTicketMessage(ticket) { const body=window.prompt('Write a reply or private note.');if(!body?.trim())return;const internal=window.confirm('Keep this message internal to MoVara staff? Choose Cancel to send it to the customer.');const {error}=await supabase.rpc('admin_add_support_message',{p_ticket_id:ticket.id,p_body:body.trim(),p_internal:internal});if(error)showToast('Support message could not be saved.');else showToast(internal?'Internal note saved.':'Reply sent to the customer.'); }
  if(authorized===null)return <div className="page subpage"><p className="history-message">Checking administrator access…</p></div>;if(!authorized)return <div className="page subpage"><h1>Access restricted</h1><p>Administrator permission is required to review customer reports.</p></div>;
  return <motion.div className="page subpage" {...pageMotion}><div className="section-head"><div><span className="eyebrow">OPERATIONS</span><h1>Support and safety</h1><p>Review reports and record the next action.</p></div><button className="text-action" onClick={load}>Refresh queue</button></div><section className="ride-history"><h2>Safety reports</h2><div className="ride-history-list">{events.map(event=><article className="ride-history-card" key={event.id}><div className="ride-history-top"><span className={`ride-status status-${event.status}`}>{event.status}</span><b>{event.event_type==='sos'?'SOS alert':'Incident report'}</b></div><p>{event.message||'No additional message.'}</p><small>Ride {event.ride_id} · Reporter {event.reporter_id} · {new Date(event.created_at).toLocaleString()}</small>{event.internal_note&&<div className="ride-live-note">Private staff note: {event.internal_note}</div>}<div className="ride-action-row"><button className="button ghost" disabled={busy===event.id||event.status==='acknowledged'} onClick={()=>updateEvent(event,'acknowledged')}>Acknowledge</button><button className="button primary" disabled={busy===event.id||event.status==='resolved'} onClick={()=>updateEvent(event,'resolved')}>Resolve</button><button className="text-action" onClick={()=>addEventNote(event)}>Add private note</button></div></article>)}{!events.length&&<p className="history-message">No safety reports in the queue.</p>}</div></section><section className="ride-history"><h2>Support tickets</h2><div className="ride-history-list">{tickets.map(ticket=><article className="ride-history-card" key={ticket.id}><div className="ride-history-top"><span className={`ride-status status-${ticket.status}`}>{ticket.status.replaceAll('_',' ')}</span><b>{ticket.category.replaceAll('_',' ')}</b></div><p>{ticket.message}</p><small>{ticket.ride_id?`Ride ${ticket.ride_id} · `:''}Reporter {ticket.reporter_id} · {new Date(ticket.created_at).toLocaleString()}</small><label className="input-label">Resolution note<textarea rows={2} maxLength={4000} value={resolutions[ticket.id]??ticket.resolution??''} onChange={e=>setResolutions(current=>({...current,[ticket.id]:e.target.value}))}/></label><div className="ride-action-row"><button className="button ghost" disabled={busy===ticket.id} onClick={()=>updateTicket(ticket,'in_progress')}>In progress</button><button className="button primary" disabled={busy===ticket.id} onClick={()=>updateTicket(ticket,'resolved')}>Resolve ticket</button><button className="button ghost" onClick={()=>assignTicket(ticket,user.id)}>Assign to me</button><button className="text-action" onClick={()=>addTicketMessage(ticket)}>Reply or add note</button></div></article>)}{!tickets.length&&<p className="history-message">No support requests in the queue.</p>}</div></section></motion.div>;
}

function SharedRidePage({ token, showToast, navigate }) {
  const [data,setData]=useState(null);const [error,setError]=useState('');
  useEffect(()=>{let alive=true;async function load(){if(!token){setError('Trip link is missing.');return;}const {data:result,error:invokeError}=await supabase.functions.invoke('shared-ride',{body:{token}});if(!alive)return;if(invokeError||result?.error){setError(result?.error||'Trip could not be loaded.');return;}setData(result);setError('');}load();const timer=setInterval(load,15000);return()=>{alive=false;clearInterval(timer);};},[token]);
  if(error)return <motion.div className="page subpage" {...pageMotion}><div className="panel safety-panel"><span className="eyebrow">MOVARA TRIP SHARE</span><h1>Trip link unavailable</h1><p>{error}</p><button className="button primary" onClick={()=>navigate('home')}>Go to MoVara</button></div></motion.div>;
  if(!data)return <div className="page subpage"><p className="history-message">Loading shared trip…</p></div>;
  const ride=data.ride;return <motion.div className="page subpage shared-trip" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">MOVARA TRIP SHARE</span><h1>Trip status: {ride.status.replaceAll('_',' ')}</h1><p>Shared with you for safety. This link expires {new Date(data.expiresAt).toLocaleString()}.</p></div><article className="panel safety-panel"><span className={`ride-status status-${ride.status}`}>{ride.service_level??'Ride'} · {ride.status.replaceAll('_',' ')}</span><p className="share-route"><span>{ride.pickup_label}</span><i /><span>{ride.destination_label}</span></p><small>Last update {new Date(data.location?.updated_at??ride.updated_at).toLocaleTimeString()}</small>{data.location&&<div className="ride-live-map"><RideMapCanvas pickupPoint={null} destinationPoint={null} driverPoint={[data.location.latitude,data.location.longitude]} encodedPolyline={null} onPick={()=>{}} /></div>}<p className="share-privacy">This view shows ride progress and driver position only. It does not include contact or account details.</p></article></motion.div>;
}

function AdminPricingPage({ user, showToast, navigate }) {
  const [authorized, setAuthorized] = useState(null);
  const [cities, setCities] = useState([]);
  const [cityCode, setCityCode] = useState('NG-DEFAULT');
  const [rules, setRules] = useState([]);
  const [surge, setSurge] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [cityDraft, setCityDraft] = useState({ city_name: '', country_code: 'NG', country_name: 'Nigeria', currency: 'NGN' });
  const [draft, setDraft] = useState({ adjustment_type: 'zone', name: '', code: '', amount: '0', multiplier: '1', discount: '0', boundary: '', starts_at: '', ends_at: '', service_level: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) { setAuthorized(false); setLoading(false); return; }
    const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'administrator').maybeSingle();
    if (!role) { setAuthorized(false); setLoading(false); return; }
    setAuthorized(true);
    const [{ data: cityRows }, { data: tariffRows }, { data: surgeRow }, { data: adjustmentRows }] = await Promise.all([
      supabase.from('ride_cities').select('city_code,city_name,country_code,country_name,currency,active').order('city_name'),
      supabase.from('ride_pricing_rules').select('city_code,service_level,booking_fee_ngn_kobo,per_kilometer_ngn_kobo,per_minute_ngn_kobo,minimum_fare_ngn_kobo,cancellation_fee_ngn_kobo,commission_basis_points,active').eq('city_code', cityCode),
      supabase.from('ride_surge_settings').select('*').eq('city_code', cityCode).maybeSingle(),
      supabase.from('ride_pricing_adjustments').select('*').eq('city_code', cityCode).order('created_at', { ascending: false }),
    ]);
    setCities(cityRows ?? []); setRules(tariffRows ?? []); setSurge(surgeRow); setAdjustments(adjustmentRows ?? []); setLoading(false);
  }
  useEffect(() => { load(); }, [user?.id, cityCode]);

  async function saveRule(rule) {
    const next = { ...rule, city_code: cityCode,
      base_fare_ngn_kobo: Number(rule.booking_fee_ngn_kobo),
      booking_fee_ngn_kobo: Number(rule.booking_fee_ngn_kobo),
      per_kilometer_ngn_kobo: Number(rule.per_kilometer_ngn_kobo),
      per_minute_ngn_kobo: Number(rule.per_minute_ngn_kobo),
      minimum_fare_ngn_kobo: Number(rule.minimum_fare_ngn_kobo),
      cancellation_fee_ngn_kobo: Number(rule.cancellation_fee_ngn_kobo),
      commission_basis_points: Number(rule.commission_basis_points) };
    const { error } = await supabase.from('ride_pricing_rules').upsert(next, { onConflict: 'city_code,service_level' });
    if (error) showToast('Fare settings were not saved.'); else { showToast(`${serviceName(rule.service_level)} fare saved.`); await load(); }
  }

  async function saveCity(event) {
    event.preventDefault();
    const slug = `${cityDraft.country_code}-${cityDraft.city_name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toUpperCase()}`.slice(0,24);
    const { error } = await supabase.from('ride_cities').insert({ ...cityDraft, city_code: slug, country_code: 'NG', country_name: 'Nigeria', currency: 'NGN', active: false });
    if (error) showToast('The new pricing market could not be saved.'); else {
      const surgeResult = await supabase.from('ride_surge_settings').upsert({ city_code: slug });
      setCityCode(slug); setCityDraft((item)=>({...item,city_name:''}));
      showToast(surgeResult.error ? 'Market added. Surge settings need a retry.' : 'Market added as inactive. Set all four service rates, then activate it to accept rides.'); await load();
    }
  }

  async function toggleMarket(city) {
    if (!city.active) {
      const { count, error: rateError } = await supabase.from('ride_pricing_rules').select('service_level', { count: 'exact', head: true }).eq('city_code', city.city_code).eq('active', true);
      if (rateError || count !== 4) { showToast('Save active rates for all four service classes before opening this market.'); return; }
    }
    const { error } = await supabase.from('ride_cities').update({ active: !city.active }).eq('city_code', city.city_code);
    if (error) showToast('Market status could not be updated.'); else { showToast(city.active ? 'Market paused.' : 'Market activated.'); await load(); }
  }

  async function saveSurge(next) {
    const { error } = await supabase.from('ride_surge_settings').upsert({ ...next, city_code: cityCode });
    if (error) showToast('Surge settings were not saved.'); else { setSurge(next); showToast('Surge settings saved.'); }
  }

  async function saveAdjustment(event) {
    event.preventDefault();
    let boundary = null;
    if (draft.boundary.trim()) { try { boundary = JSON.parse(draft.boundary); } catch { showToast('Zone boundary must be valid GeoJSON.'); return; } }
    const payload = { city_code: cityCode, adjustment_type: draft.adjustment_type, name: draft.name.trim(), code: draft.code.trim().toUpperCase() || null,
      amount_ngn_kobo: Math.round(Number(draft.amount) * 100), multiplier: Number(draft.multiplier), discount_basis_points: Math.round(Number(draft.discount) * 100),
      boundary, starts_at: draft.starts_at ? new Date(draft.starts_at).toISOString() : null, ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
      configuration: draft.service_level ? { service_level: draft.service_level } : {}, active: true };
    const { error } = await supabase.from('ride_pricing_adjustments').insert(payload);
    if (error) showToast('Pricing adjustment could not be saved.'); else { setDraft((item)=>({...item,name:'',code:'',amount:'0',boundary:''})); showToast('Pricing adjustment is active.'); await load(); }
  }

  async function toggleAdjustment(adjustment) {
    const { error } = await supabase.from('ride_pricing_adjustments').update({ active: !adjustment.active }).eq('id', adjustment.id);
    if (error) showToast('Pricing adjustment could not be updated.'); else await load();
  }
  async function deleteAdjustment(id) {
    if (!window.confirm('Delete this pricing adjustment?')) return;
    const { error } = await supabase.from('ride_pricing_adjustments').delete().eq('id', id);
    if (error) showToast('Pricing adjustment could not be removed.'); else await load();
  }

  if (authorized === false) return <motion.div className="page subpage" {...pageMotion}><span className="eyebrow">ACCOUNT ACCESS</span><h1>Admin pricing</h1><p>This control is only available to MoVara administrators.</p><button className="button primary" onClick={()=>navigate('account')}>Return to account</button></motion.div>;
  if (loading || !surge) return <motion.div className="page subpage" {...pageMotion}><p>Loading pricing controls…</p></motion.div>;
  return <motion.div className="page subpage admin-pricing-page" {...pageMotion}>
    <div className="section-head"><div><span className="eyebrow">ADMIN CONTROL</span><h1>Fare engine</h1><p>Manage service rates and local pricing conditions.</p></div><button className="button ghost" onClick={()=>navigate('account')}>Back to account</button></div>
    <section className="pricing-panel"><label className="input-label">Pricing market<select value={cityCode} onChange={(event)=>setCityCode(event.target.value)}>{cities.map((item)=><option key={item.city_code} value={item.city_code}>{item.city_name} · {item.active ? 'Live' : 'Inactive'}</option>)}</select></label>
      <p className="service-note">Nigeria launch pricing is in naira. International currencies should be enabled only after local rates and payment settlement are supported.</p><div className="market-list">{cities.map((item)=><article key={item.city_code}><span><b>{item.city_name}</b><small>{item.city_code} · {item.currency}</small></span><button className="text-action" onClick={()=>toggleMarket(item)}>{item.active ? 'Pause market' : 'Activate market'}</button></article>)}</div>
      <form className="city-create" onSubmit={saveCity}><h2>Add a Nigerian market</h2><div className="ride-extra-grid"><label className="input-label">City or market<input required value={cityDraft.city_name} onChange={(e)=>setCityDraft({...cityDraft,city_name:e.target.value})} placeholder="Abuja" /></label></div><button className="button primary">Add inactive market</button></form>
    </section>
    <section className="pricing-panel"><div className="section-head"><div><span className="eyebrow">SERVICE CLASSES</span><h2>Fare and commission</h2></div></div><div className="pricing-rules">{['economy','comfort','xl','executive'].map((service)=>{
      const rule = rules.find((item)=>item.service_level===service) ?? { city_code:cityCode,service_level:service,booking_fee_ngn_kobo:0,per_kilometer_ngn_kobo:0,per_minute_ngn_kobo:0,minimum_fare_ngn_kobo:0,cancellation_fee_ngn_kobo:0,commission_basis_points:1200,active:false };
      const amount = (value) => (Number(value ?? 0)/100).toFixed(0);
      return <article className="pricing-rule" key={service}><h3>{serviceName(service)}</h3><div className="ride-extra-grid">
        {[["Booking fee (₦)",'booking_fee_ngn_kobo'],['Per km (₦)','per_kilometer_ngn_kobo'],['Per minute (₦)','per_minute_ngn_kobo'],['Minimum fare (₦)','minimum_fare_ngn_kobo'],['Cancellation fee (₦)','cancellation_fee_ngn_kobo'],['Driver commission (%)','commission_basis_points']].map(([label,key])=><label className="input-label" key={key}>{label}<input type="number" min="0" step={key==='commission_basis_points'?'1':'1'} value={key==='commission_basis_points'?(Number(rule[key]??0)/100).toFixed(0):amount(rule[key])} onChange={(event)=>{const v=key==='commission_basis_points'?Math.round(Number(event.target.value)*100):Math.round(Number(event.target.value)*100);setRules((rows)=>{const rest=rows.filter((row)=>row.service_level!==service);return [...rest,{...rule,[key]:v,active:true}]})}} /></label>)}
      </div><button className="button primary" onClick={()=>saveRule({...rule,active:true})}>Save {serviceName(service)}</button></article>;
    })}</div></section>
    <section className="pricing-panel"><div className="section-head"><div><span className="eyebrow">SURGE SETTINGS</span><h2>Supply and demand</h2></div></div><label className="airport-option"><input type="checkbox" checked={surge.enabled} onChange={(e)=>saveSurge({...surge,enabled:e.target.checked})}/><span>Enable surge pricing</span></label><label className="airport-option"><input type="checkbox" checked={surge.automatic_demand} onChange={(e)=>saveSurge({...surge,automatic_demand:e.target.checked})}/><span>Adjust for request-to-driver demand</span></label><div className="ride-extra-grid">{[['Maximum multiplier','max_multiplier',1,3,.1],['Demand per driver threshold','demand_per_driver_threshold',.1,50,.1]].map(([label,key,min,max,step])=><label className="input-label" key={key}>{label}<input type="number" min={min} max={max} step={step} value={surge[key]} onChange={(e)=>setSurge({...surge,[key]:Number(e.target.value)})} onBlur={()=>saveSurge(surge)}/></label>)}</div><div className="surge-trigger-grid">{['rain','holiday','event','airport'].map((trigger)=><label className="input-label" key={trigger}>{trigger[0].toUpperCase()+trigger.slice(1)} multiplier<input type="number" min="1" max="3" step="0.1" value={surge.trigger_multipliers?.[trigger]??1} onChange={(e)=>setSurge({...surge,trigger_multipliers:{...surge.trigger_multipliers,[trigger]:Number(e.target.value)}})} onBlur={()=>saveSurge(surge)}/></label>)}</div><small>Demand surge updates automatically from open ride requests and online drivers. Rain and event multipliers are administrator-set until live data feeds are connected.</small></section>
    <section className="pricing-panel"><div className="section-head"><div><span className="eyebrow">LOCAL PRICING</span><h2>Zones, airports, events, promos, and incentives</h2></div></div><form onSubmit={saveAdjustment}><div className="ride-extra-grid"><label className="input-label">Adjustment type<select value={draft.adjustment_type} onChange={(e)=>setDraft({...draft,adjustment_type:e.target.value})}>{['zone','airport','event','corporate','promo','incentive'].map((type)=><option key={type}>{type}</option>)}</select></label><label className="input-label">Service class, optional<select value={draft.service_level} onChange={(e)=>setDraft({...draft,service_level:e.target.value})}><option value="">All classes</option>{['economy','comfort','xl','executive'].map((service)=><option key={service} value={service}>{serviceName(service)}</option>)}</select></label><label className="input-label">Name<input required value={draft.name} onChange={(e)=>setDraft({...draft,name:e.target.value})} /></label><label className="input-label">Code, if needed<input value={draft.code} onChange={(e)=>setDraft({...draft,code:e.target.value.toUpperCase()})} /></label><label className="input-label">Added amount (₦)<input type="number" min="0" value={draft.amount} onChange={(e)=>setDraft({...draft,amount:e.target.value})} /></label><label className="input-label">Multiplier<input type="number" min="0" max="3" step=".1" value={draft.multiplier} onChange={(e)=>setDraft({...draft,multiplier:e.target.value})} /></label><label className="input-label">Discount (%)<input type="number" min="0" max="100" value={draft.discount} onChange={(e)=>setDraft({...draft,discount:e.target.value})} /></label><label className="input-label">Starts<input type="datetime-local" value={draft.starts_at} onChange={(e)=>setDraft({...draft,starts_at:e.target.value})} /></label><label className="input-label">Ends<input type="datetime-local" value={draft.ends_at} onChange={(e)=>setDraft({...draft,ends_at:e.target.value})} /></label></div><label className="input-label">Zone boundary GeoJSON (Polygon)<textarea rows="4" value={draft.boundary} onChange={(e)=>setDraft({...draft,boundary:e.target.value})} placeholder={'{"type":"Polygon","coordinates":[[[longitude,latitude],...]]}'} /></label><button className="button primary">Add pricing adjustment</button></form><div className="ride-history-list">{adjustments.map((item)=><article className="ride-history-card pricing-adjustment" key={item.id}><div className="ride-history-top"><b>{item.name}</b><span className={`ride-status ${item.active?'status-accepted':'status-cancelled'}`}>{item.active?'Active':'Paused'}</span></div><small>{item.adjustment_type} {item.code?`· ${item.code}`:''} · +₦{Math.round(item.amount_ngn_kobo/100).toLocaleString()} · {Number(item.multiplier).toFixed(1)}× · {Number(item.discount_basis_points)/100}% off</small><div><button className="text-action" onClick={()=>toggleAdjustment(item)}>{item.active?'Pause':'Activate'}</button><button className="ride-cancel" onClick={()=>deleteAdjustment(item.id)}>Delete</button></div></article>)}</div></section>
  </motion.div>;
}

function serviceName(service) { return ({economy:'MoVara Economy',comfort:'MoVara Comfort',xl:'MoVara XL',executive:'MoVara Executive'}[service] ?? service); }

async function deliverNotificationChannels(notification,userId) {
  const {data:preferences=[]}=await supabase.from('notification_preferences').select('kind,channel,enabled').eq('user_id',userId);
  const enabled=(channel)=>{
    const exact=preferences.find((item)=>item.kind===notification.kind&&item.channel===channel);
    const all=preferences.find((item)=>item.kind==='all'&&item.channel===channel);
    if(exact)return exact.enabled;if(all)return all.enabled;
    return channel==='email';
  };
  for(const [channel,fn] of [['email','send-email'],['sms','send-sms'],['push','send-push']]){
    if(enabled(channel))await supabase.functions.invoke(fn,{body:{notification_id:notification.id}}).catch(()=>{});
  }
}

function DrivePage({ user, showToast, navigate }) {
  const [clockNow, setClockNow] = useState(Date.now());
  const [roleReady, setRoleReady] = useState(false);
  const [verification, setVerification] = useState('not_submitted');
  const [online, setOnline] = useState(false);
  const [driverCity, setDriverCity] = useState('NG-DEFAULT');
  const [driverCities, setDriverCities] = useState([]);
  const [rides, setRides] = useState([]);
  const [cargoDeliveries, setCargoDeliveries] = useState([]);
  const [driverVehicles, setDriverVehicles] = useState([]);
  const [vehicleDraft, setVehicleDraft] = useState({ type: 'motorcycle', make: '', model: '', registration: '', capacity: '1' });
  const [deliveryProof, setDeliveryProof] = useState({});
  const [busyRide, setBusyRide] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    if (!user || !isConfigured) return;
    const [{ data: role }, { data: verify }, { data: profile }, { data: cityRows }, { data: cargoRows }, { data: vehicleRows }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'driver').maybeSingle(),
      supabase.from('driver_verifications').select('status').eq('driver_id', user.id).maybeSingle(),
      supabase.from('driver_profiles').select('is_online,city_code').eq('driver_id', user.id).maybeSingle(),
      supabase.from('ride_cities').select('city_code,city_name').eq('active',true).order('city_name'),
      supabase.from('cargo_orders').select('id,tracking_code,service_type,package_size,package_count,weight_kg,pickup_label,pickup_city,pickup_region,destination_label,destination_city,destination_region,recipient_name,recipient_phone,contents_description,sender_note,status,payment_status,quote_amount_ngn_kobo,pickup_at,created_at,delivery_proof,issue_note').eq('driver_id', user.id).in('status',['assigned','picked_up','in_transit','issue']).order('created_at',{ascending:true}),
      supabase.from('vehicles').select('id,vehicle_type,make,model,registration_number,capacity,verification').eq('driver_id',user.id).order('created_at',{ascending:false}),
    ]);
    setRoleReady(Boolean(role)); setVerification(verify?.status ?? 'not_submitted'); setOnline(Boolean(profile?.is_online));
    setDriverCity(profile?.city_code ?? 'NG-DEFAULT'); setDriverCities(cityRows ?? []);
    setCargoDeliveries(cargoRows ?? []); setDriverVehicles(vehicleRows ?? []);
    const [{ data: assigned, error }, offers] = await Promise.all([
      supabase.from('rides').select('id,pickup_label,destination_label,status,driver_arrived_at,rider_no_show_at,estimated_fare_ngn_kobo,driver_earnings_ngn_kobo,driver_commission_ngn_kobo,driver_incentive_ngn_kobo,currency,service_level,passenger_count,scheduled_for,created_at,driver_id').eq('driver_id',user.id).in('status',['accepted','in_progress','completed']).limit(100),
      role && profile?.is_online ? supabase.rpc('driver_poll_ride_offers') : Promise.resolve({data:[],error:null}),
    ]);
    if (error || offers.error) showToast('Ride offers could not be loaded.');
    const combined = [...(offers.data ?? []), ...(assigned ?? [])];
    setRides([...new Map(combined.map((ride) => [ride.id, ride])).values()]);
  }

  useEffect(() => {
    if (!user) return undefined;
    refresh();
    const channel = supabase.channel(`driver-rides-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_orders' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !rides.length) return undefined;
    const active = rides.find((ride) => ride.driver_id === user.id && ['accepted','in_progress'].includes(ride.status));
    if (!active || !navigator.geolocation) return undefined;
    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition(({ coords }) => {
      if (Date.now() - lastSent < 10000) return;
      lastSent = Date.now();
      supabase.rpc('driver_update_ride_location', { p_ride_id: active.id, p_latitude: coords.latitude, p_longitude: coords.longitude });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [user?.id, rides]);

  async function setAvailability(value) {
    if (!user) return navigate('auth');
    let result = await supabase.from('driver_profiles').select('driver_id').eq('driver_id', user.id).maybeSingle();
    if (!result.data && !result.error) result = await supabase.from('driver_profiles').insert({ driver_id: user.id });
    if (result.error) { showToast('Driver availability could not be updated.'); return; }
    const update = await supabase.from('driver_profiles').update({ is_online: value, city_code: driverCity }).eq('driver_id', user.id);
    if (update.error) showToast('Availability requires approved driver identity and vehicle documents.');
    else { setOnline(value); showToast(value ? 'You are online for ride offers.' : 'You are offline.'); }
  }

  async function rideAction(ride, action) {
    setBusyRide(ride.id);
    let result;
    if (action === 'accept') result = await supabase.rpc('driver_accept_ride', { p_ride_id: ride.id });
    else if (action === 'decline') result = await supabase.rpc('driver_decline_ride_offer', { p_ride_id: ride.id });
    else if (action === 'arrived') result = await supabase.rpc('driver_mark_arrived', { p_ride_id: ride.id });
    else if (action === 'no_show') result = await supabase.rpc('driver_report_rider_no_show', { p_ride_id: ride.id });
    else result = await supabase.rpc('driver_update_ride_status', { p_ride_id: ride.id, p_new_status: action });
    setBusyRide('');
    if (result.error) showToast(result.error.message || 'That ride update could not be saved.');
    else { showToast(({ accept: 'Ride accepted.', decline: 'Offer declined.', arrived: 'Your arrival was shared with the rider.', no_show: 'Rider no-show recorded and ride cancelled.', in_progress: 'Trip started.', completed: 'Trip completed.' })[action]); await refresh(); }
  }

  async function submitCargoVehicle(event) {
    event.preventDefault();
    const { error } = await supabase.rpc('submit_driver_vehicle', { p_vehicle_type: vehicleDraft.type, p_make: vehicleDraft.make.trim(), p_model: vehicleDraft.model.trim(), p_registration_number: vehicleDraft.registration.trim(), p_capacity: Number(vehicleDraft.capacity) });
    if (error) showToast(error.message || 'Vehicle details could not be submitted.');
    else { showToast('Vehicle submitted for MoVara review.'); setVehicleDraft({ type: 'motorcycle', make: '', model: '', registration: '', capacity: '1' }); await refresh(); }
  }
  async function cargoAction(order, status) {
    const proof = status === 'delivered' ? (deliveryProof[order.id] ?? '').trim() : status === 'issue' ? (window.prompt('What happened?') ?? '').trim() : '';
    if (status === 'delivered' && proof.length < 3) return showToast('Add the name of the person who received the delivery.');
    if (status === 'issue' && proof.length < 3) return;
    setBusyRide(order.id);
    const { error } = await supabase.rpc('driver_update_cargo_status', { p_order_id: order.id, p_new_status: status, p_note: proof });
    setBusyRide('');
    if (error) showToast(error.message || 'Delivery update could not be saved.');
    else { showToast(status === 'delivered' ? 'Delivery marked complete.' : status === 'issue' ? 'Issue sent to MoVara operations.' : status === 'picked_up' ? 'Pickup confirmed.' : 'Shipment marked in transit.'); await refresh(); }
  }

  if (!user) return <JoinPage kind="driver" showToast={showToast} navigate={navigate} />;
  if (!roleReady) return <motion.div className="page subpage join-page" {...pageMotion}><span className="eyebrow">DRIVER PARTNER</span><h1>Drive on your terms.</h1><p>Complete driver registration and receive approval before you can go online and accept trips.</p><div className="join-panel"><Icon icon={Car01Icon} size={30} /><h2>{verification === 'approved' ? 'Driver account not active' : `Verification: ${verification.replaceAll('_',' ')}`}</h2><p>Submit your identity and vehicle documents from your account to continue. We only show you trips after approval.</p><button className="button primary" onClick={() => navigate('account')}>Open your account <Icon icon={ArrowRight01Icon} /></button></div></motion.div>;
  const available = rides.filter((ride) => !ride.driver_id && ['requested','matching'].includes(ride.status));
  const active = rides.filter((ride) => ride.driver_id === user.id);
  const completed = active.filter((ride) => ride.status === 'completed');
  const dayStart = new Date(); dayStart.setHours(0,0,0,0);
  const weekStart = new Date(dayStart); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const earningsIn = (start) => completed.filter((ride) => new Date(ride.created_at) >= start).reduce((sum, ride) => sum + Number(ride.driver_earnings_ngn_kobo ?? 0), 0);
  return <motion.div className="page subpage" {...pageMotion}><div className="section-head"><div><span className="eyebrow">DRIVER PARTNER</span><h1>Your driving day</h1><p>Trip offers are matched to your approved vehicle and capacity.</p></div><button className={`button ${online ? 'ghost driver-online' : 'primary'}`} onClick={() => setAvailability(!online)}>{online ? 'Go offline' : 'Go online'}</button></div><label className="input-label driver-city">Operating market<select value={driverCity} disabled={online} onChange={(event)=>setDriverCity(event.target.value)}>{driverCities.map((item)=><option key={item.city_code} value={item.city_code}>{item.city_name}</option>)}</select></label><div className="earnings-grid"><article><small>Today</small><b>{formatMoneyKobo(earningsIn(dayStart),'NGN')}</b></article><article><small>This week</small><b>{formatMoneyKobo(earningsIn(weekStart),'NGN')}</b></article><article><small>Completed rides</small><b>{completed.length}</b></article></div>
    {verification==='approved'&&<section className="ride-history cargo-fleet-panel"><div><span className="eyebrow">CARGO COURIER</span><h2>Register a delivery vehicle</h2><p>Vehicle documents are reviewed before dispatch can assign cargo. Motorcycle, keke, car, van, and truck are supported.</p></div><form className="cargo-form-grid" onSubmit={submitCargoVehicle}><label className="input-label">Vehicle class<select value={vehicleDraft.type} onChange={e=>setVehicleDraft({...vehicleDraft,type:e.target.value})}>{[['motorcycle','Motorcycle'],['keke','Keke'],['car','Car'],['van','Van'],['truck','Truck']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="input-label">Make<input required maxLength="80" value={vehicleDraft.make} onChange={e=>setVehicleDraft({...vehicleDraft,make:e.target.value})}/></label><label className="input-label">Model<input required maxLength="80" value={vehicleDraft.model} onChange={e=>setVehicleDraft({...vehicleDraft,model:e.target.value})}/></label><label className="input-label">Registration number<input required maxLength="32" value={vehicleDraft.registration} onChange={e=>setVehicleDraft({...vehicleDraft,registration:e.target.value.toUpperCase()})}/></label><label className="input-label">Passenger seats<input type="number" min="1" max="20" required value={vehicleDraft.capacity} onChange={e=>setVehicleDraft({...vehicleDraft,capacity:e.target.value})}/><small>Used for ride offers. Cargo size is checked separately.</small></label><button className="button primary">Submit vehicle for review</button></form><div className="cargo-driver-vehicles">{driverVehicles.map(vehicle=><span key={vehicle.id} className={`ride-status status-${vehicle.verification}`}>{vehicle.vehicle_type} · {vehicle.make} {vehicle.model} · {vehicle.verification.replaceAll('_',' ')}</span>)}</div></section>}
    <div className="ride-history"><div className="section-head"><div><span className="eyebrow">ON YOUR RADAR</span><h2>Available rides</h2></div><button className="text-action" onClick={refresh}>Refresh</button></div>{!online && <p className="history-message">Go online to receive ride offers. Only verified drivers with an approved, matching vehicle can accept.</p>}{online && available.length === 0 && <p className="history-message">No rides in this market right now. Keep this page open and we’ll refresh as offers arrive.</p>}<div className="ride-history-list">{available.map((ride) => <article className="ride-history-card" key={ride.id}><div className="ride-history-top"><span className="ride-status status-requested">{ride.service_level}</span><b>{formatMoneyKobo(ride.estimated_fare_ngn_kobo,ride.currency)} estimated</b></div><p><span>{ride.pickup_label}</span><i /><span>{ride.destination_label}</span></p><small>{ride.passenger_count} passengers · {new Date(ride.scheduled_for ?? ride.created_at).toLocaleString()}</small><button className="ride-cancel" onClick={() => rideAction(ride,'accept')} disabled={!online || busyRide === ride.id}>{busyRide === ride.id ? 'Accepting…' : 'Accept ride'}</button><button className="text-action" onClick={() => rideAction(ride,'decline')} disabled={busyRide === ride.id}>Decline</button></article>)}</div></div>
    <div className="ride-history cargo-driver-panel"><div className="section-head"><div><span className="eyebrow">DELIVERY RUNS</span><h2>Assigned cargo</h2></div><button className="text-action" onClick={refresh}>Refresh</button></div>{cargoDeliveries.length? <div className="ride-history-list">{cargoDeliveries.map(order=><article className="cargo-order-card" key={order.id}><div className="cargo-order-top"><div><span className="eyebrow">{order.tracking_code}</span><h3>{cargoServiceNames[order.service_type]}</h3></div><span className={`ride-status status-${order.status}`}>{cargoStatusNames[order.status]}</span></div><p className="cargo-route"><span><small>PICKUP</small>{order.pickup_city}, {order.pickup_region}<em>{order.pickup_label}</em></span><i/><span><small>DELIVERY</small>{order.destination_city}, {order.destination_region}<em>{order.destination_label}</em></span></p><div className="cargo-order-facts"><span>{order.package_size} · {order.package_count} item(s) · {order.weight_kg} kg</span><span>Recipient: {order.recipient_name} · {order.recipient_phone}</span><span>{order.contents_description}</span>{order.sender_note&&<span>Sender note: {order.sender_note}</span>}</div>{order.status==='assigned'&&<button className="button primary" disabled={busyRide===order.id} onClick={()=>cargoAction(order,'picked_up')}>Confirm pickup</button>}{order.status==='picked_up'&&<button className="button primary" disabled={busyRide===order.id} onClick={()=>cargoAction(order,'in_transit')}>Start delivery</button>}{order.status==='in_transit'&&<div className="cargo-driver-complete"><label className="input-label">Who received the shipment?<input required maxLength="500" value={deliveryProof[order.id]??''} onChange={e=>setDeliveryProof({...deliveryProof,[order.id]:e.target.value})} placeholder="Recipient name and handoff detail"/></label><button className="button primary" disabled={busyRide===order.id} onClick={()=>cargoAction(order,'delivered')}>Confirm delivery</button></div>}{order.status!=='issue'&&<button className="text-action" onClick={()=>cargoAction(order,'issue')} disabled={busyRide===order.id}>Report a delivery issue</button>}{order.issue_note&&<p className="cargo-issue-note">Issue: {order.issue_note}</p>}</article>)}</div>:<p className="history-message">No cargo deliveries are assigned yet. Keep your approved contact details current.</p>}</div>
    {active.filter((ride) => ride.status !== 'completed').length > 0 && <div className="ride-history"><div className="section-head"><div><span className="eyebrow">YOUR TRIPS</span><h2>Assigned rides</h2></div></div><div className="ride-history-list">{active.filter((ride) => ride.status !== 'completed').map((ride) => <DriverTripCard key={ride.id} ride={ride} busy={busyRide === ride.id} now={clockNow} onAction={rideAction} />)}</div></div>}{completed.length > 0 && <div className="ride-history"><div className="section-head"><div><span className="eyebrow">YOUR EARNINGS</span><h2>Recent completed rides</h2></div></div><div className="ride-history-list">{completed.slice(0,12).map((ride)=><article className="ride-history-card" key={ride.id}><div className="ride-history-top"><span className="ride-status status-completed">Completed</span><b>{formatMoneyKobo(ride.driver_earnings_ngn_kobo,ride.currency)}</b></div><p><span>{ride.pickup_label}</span><i/><span>{ride.destination_label}</span></p><small>Commission: {formatMoneyKobo(ride.driver_commission_ngn_kobo,ride.currency)} · Incentive: {formatMoneyKobo(ride.driver_incentive_ngn_kobo,ride.currency)}</small></article>)}</div></div>}</motion.div>;
}

function DriverTripCard({ ride, busy, now, onAction }) {
  const arrived = Boolean(ride.driver_arrived_at);
  const canReportNoShow = arrived && now >= new Date(ride.driver_arrived_at).getTime() + 5 * 60_000;
  return <article className="ride-history-card">
    <div className="ride-history-top"><span className={`ride-status status-${ride.status}`}>{ride.status.replaceAll('_',' ')}</span><b>{formatMoneyKobo(ride.estimated_fare_ngn_kobo,ride.currency)}</b></div>
    <p><span>{ride.pickup_label}</span><i /><span>{ride.destination_label}</span></p>
    {ride.status === 'accepted' && <div className="driver-arrival-actions">{arrived ? <>
      <div className="ride-live-note">Arrival shared with rider at {new Date(ride.driver_arrived_at).toLocaleTimeString()}. {canReportNoShow ? 'You can report a no-show if the rider is still absent.' : 'Wait five minutes before reporting a no-show.'}</div>
      <button className="button ghost" onClick={() => onAction(ride,'no_show')} disabled={busy || !canReportNoShow}>Report rider no-show</button>
      <button className="button primary" onClick={() => onAction(ride,'in_progress')} disabled={busy}>Start trip</button>
    </> : <button className="button primary" onClick={() => onAction(ride,'arrived')} disabled={busy}>I have arrived</button>}</div>}
    {ride.status === 'in_progress' && <button className="button primary" onClick={() => onAction(ride,'completed')} disabled={busy}>Complete trip</button>}
  </article>;
}

function JoinPage({ kind, showToast, navigate }) {
  return <motion.div className="page subpage join-page" {...pageMotion}><span className="eyebrow">GROW WITH MOVARA</span><h1>{kind === 'driver' ? 'Drive on your terms.' : 'Bring your property to more people.'}</h1><p>{kind === 'driver' ? 'Create an account to get started with your driver profile.' : 'Create an account to list a home and manage enquiries.'}</p><div className="join-panel"><Icon icon={kind === 'driver' ? Car01Icon : Building03Icon} size={30} /><h2>Start with a MoVara account</h2><p>We’ll guide you through the details and documents needed for your role.</p><button className="button primary" onClick={()=>navigate('auth')}>Create your account <Icon icon={ArrowRight01Icon}/></button></div></motion.div>;
}
