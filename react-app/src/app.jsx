import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowRight01Icon, ArrowUpRight01Icon, Building03Icon, Car01Icon,
  CheckmarkCircle02Icon, Home01Icon, Location01Icon, Menu01Icon,
  Search01Icon, Shield01Icon, UserCircleIcon, Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { supabase, isConfigured } from './supabase.js';

const pageMotion = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
};

const nigerianStates = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
const defaultCenter = [9.082, 8.6753];
const pinIcon = new L.DivIcon({ className: 'map-marker', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

function MapClick({ onPick }) { useMapEvents({ click(event) { onPick(event.latlng); } }); return null; }
function FocusPoint({ point }) { const map = useMap(); useEffect(() => { if (point) map.setView(point, 14, { animate: true }); }, [map, point]); return null; }

function Icon({ icon, size = 20, className = '' }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={className} />;
}

export function App() {
  const [page, setPage] = useState('home');
  const [user, setUser] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timeout);
  }, [toast]);

  const navigate = (next) => { setPage(next); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const showToast = (message) => setToast(message);

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => navigate('home')} aria-label="MoVara home">
        <img src="/movara_logo.png" alt="MoVara" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
        <span className="brand-fallback">MoVara<span>.</span></span>
      </button>
      <nav className={mobileMenu ? 'nav open' : 'nav'}>
        <button className={page === 'rides' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('rides')}>Rides</button>
        <button className={page === 'homes' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('homes')}>Find a home</button>
        <button className="nav-link" onClick={() => navigate('drive')}>Drive</button>
        <button className="nav-link" onClick={() => navigate('list')}>List property</button>
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
        {page === 'homes' && <HomesPage key="homes" showToast={showToast} />}
        {page === 'auth' && <AuthPage key="auth" user={user} showToast={showToast} navigate={navigate} />}
        {page === 'account' && <AccountPage key="account" user={user} navigate={navigate} showToast={showToast} />}
        {page === 'drive' && <JoinPage key="drive" kind="driver" showToast={showToast} navigate={navigate} />}
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
        <ServiceCard icon={Building03Icon} number="03" title="Grow with us" text="Build your driving or property journey on MoVara." onClick={() => navigate('drive')} />
      </div>
    </section>
    <section className="quiet-banner"><span className="quiet-mark">M</span><div><span className="eyebrow">BUILT AROUND PEOPLE</span><h2>Good service should feel simple.</h2><p>Clear choices, thoughtful details, and support when you need it.</p></div><button className="text-action" onClick={() => navigate('auth')}>Get started <Icon icon={ArrowRight01Icon} /></button></section>
  </motion.div>;
}

function ServiceCard({ icon, number, title, text, onClick }) {
  return <motion.button className="service-card" onClick={onClick} whileHover={{ y: -5 }} whileTap={{ scale: .985 }} transition={{ type: 'spring', stiffness: 330, damping: 24 }}>
    <div className="service-top"><span className="service-icon"><Icon icon={icon} size={22} /></span><span className="service-number">{number}</span></div><div><h3>{title}</h3><p>{text}</p></div><span className="service-arrow"><Icon icon={ArrowUpRight01Icon} size={19} /></span>
  </motion.button>;
}

const rideOptions = [
  { key: 'standard', name: 'Standard car', description: 'Everyday rides', price: 3500, capacity: 4 },
  { key: 'comfort', name: 'Comfort car', description: 'A little more room', price: 5000, capacity: 4 },
  { key: 'keke', name: 'Keke', description: 'Quick city trips', price: 1500, capacity: 3 },
];

function routeDistanceKm(first, second) {
  if (!first || !second) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const [lat1, lon1] = first.map(radians);
  const [lat2, lon2] = second.map(radians);
  const a = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toLocalDateTime(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function RidePage({ user, showToast, navigate }) {
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupPoint, setPickupPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [vehicle, setVehicle] = useState('standard');
  const [passengers, setPassengers] = useState(1);
  const [scheduledAt, setScheduledAt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [rides, setRides] = useState([]);
  const [loadingRides, setLoadingRides] = useState(false);
  const [cancelling, setCancelling] = useState('');

  const selectedRide = rideOptions.find((option) => option.key === vehicle) ?? rideOptions[0];
  const distanceKm = routeDistanceKm(pickupPoint, destinationPoint);
  const estimatedFare = distanceKm === null
    ? selectedRide.price
    : Math.max(selectedRide.price, Math.round((selectedRide.price + Math.max(0, distanceKm - 2) * (vehicle === 'keke' ? 220 : 480)) / 100) * 100);
  const minSchedule = toLocalDateTime(new Date(Date.now() + 30 * 60 * 1000));

  async function loadRides() {
    if (!isConfigured || !user) { setRides([]); return; }
    setLoadingRides(true);
    const { data, error } = await supabase.from('rides')
      .select('id,pickup_label,destination_label,status,estimated_fare_ngn_kobo,service_level,passenger_count,scheduled_for,created_at,cancelled_at')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) showToast('Your ride list could not be refreshed. Please try again.');
    else setRides(data ?? []);
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

  async function requestRide(event) {
    event.preventDefault();
    if (!pickup.trim() || !destination.trim()) return showToast('Add both your pickup and destination to continue.');
    if (pickup.trim().toLowerCase() === destination.trim().toLowerCase()) return showToast('Pickup and destination must be different.');
    if (!isConfigured) return showToast('Ride booking is not connected yet. Add the Supabase settings to continue.');
    if (!user) { showToast('Sign in to request and follow your ride.'); navigate('auth'); return; }
    if (passengers > selectedRide.capacity) return showToast(`${selectedRide.name} is available for up to ${selectedRide.capacity} passengers.`);
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledDate && scheduledDate <= new Date(Date.now() + 30 * 60 * 1000)) return showToast('Choose a pickup time at least 30 minutes from now.');
    setBusy(true);
    try {
      const booking = {
        customer_id: user.id,
        pickup_label: pickup.trim(),
        destination_label: destination.trim(),
        pickup_latitude: pickupPoint?.[0] ?? null,
        pickup_longitude: pickupPoint?.[1] ?? null,
        destination_latitude: destinationPoint?.[0] ?? null,
        destination_longitude: destinationPoint?.[1] ?? null,
        service_level: vehicle,
        passenger_count: passengers,
        estimated_fare_ngn_kobo: estimatedFare * 100,
        scheduled_for: scheduledDate?.toISOString() ?? null,
        special_instructions: instructions.trim() || null,
        payment_method: 'cash',
        status: 'requested',
      };
      const { error } = await supabase.from('rides').insert(booking);
      if (error) throw error;
      showToast('Your ride request is saved. We’ll update this page when its status changes.');
      setPickup(''); setDestination(''); setPickupPoint(null); setDestinationPoint(null);
      setInstructions(''); setScheduledAt(''); setPassengers(1);
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
      setPickupPoint(point); setPickup(label); setDestinationPoint(null); setDestination('');
    } else {
      setDestinationPoint(point); setDestination(label);
    }
  }

  async function cancelRide(rideId) {
    setCancelling(rideId);
    const { error } = await supabase.rpc('cancel_ride', { p_ride_id: rideId, p_reason: 'Cancelled by rider' });
    setCancelling('');
    if (error) showToast(error.message || 'This ride could not be cancelled.');
    else { showToast('Ride cancelled.'); await loadRides(); }
  }

  const formatFare = (amount) => amount == null ? 'Fare to be confirmed' : `₦${Math.round(amount / 100).toLocaleString()}`;
  const formatStatus = (status) => ({ requested: 'Request sent', matching: 'Finding a driver', accepted: 'Driver confirmed', in_progress: 'On your way', completed: 'Completed', cancelled: 'Cancelled' }[status] ?? status);
  const chosenPoints = [pickupPoint, destinationPoint].filter(Boolean);

  return <motion.div className="page subpage" {...pageMotion}>
    <div className="subpage-intro"><span className="eyebrow">A BETTER WAY THERE</span><h1>Where are you headed?</h1><p>Set your route and choose the ride that feels right.</p></div>
    <div className="ride-layout">
      <form className="panel ride-form" onSubmit={requestRide}>
        <div className="form-heading"><span className="form-step">01</span><div><h2>Your route</h2><p>Where should we pick you up?</p></div></div>
        <label className="field"><Icon icon={Location01Icon} /><input value={pickup} onChange={(event) => { setPickup(event.target.value); setPickupPoint(null); }} placeholder="Pickup location" autoComplete="street-address" required /></label>
        <button className="text-action location-action" type="button" onClick={useMyLocation} disabled={locating}>{locating ? 'Finding your location…' : '◎ Use my current location'}</button>
        <label className="field"><Icon icon={Location01Icon} /><input value={destination} onChange={(event) => { setDestination(event.target.value); setDestinationPoint(null); }} placeholder="Where to?" autoComplete="off" required /></label>
        <p className="map-help">Choose a point on the map for a distance estimate. You can also type either address.</p>
        <div className="form-heading second"><span className="form-step">02</span><div><h2>Choose a ride</h2><p>Final fare is confirmed when a driver accepts.</p></div></div>
        <div className="vehicle-list">{rideOptions.map((option) => <button type="button" key={option.key} onClick={() => { setVehicle(option.key); if (passengers > option.capacity) setPassengers(option.capacity); }} className={vehicle === option.key ? 'vehicle selected' : 'vehicle'} aria-pressed={vehicle === option.key}><span className="vehicle-icon"><Icon icon={Car01Icon} /></span><span className="vehicle-info"><b>{option.name}</b><small>{option.description} · up to {option.capacity}</small></span><b className="vehicle-price">₦{option.price.toLocaleString()}+</b><span className="radio" /></button>)}</div>
        <div className="ride-extra-grid">
          <label className="input-label">Passengers<select value={passengers} onChange={(event) => setPassengers(Number(event.target.value))}>{Array.from({ length: selectedRide.capacity }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} {index === 0 ? 'passenger' : 'passengers'}</option>)}</select></label>
          <label className="input-label">Pickup time<input type="datetime-local" min={minSchedule} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><small>Leave empty for the soonest pickup.</small></label>
        </div>
        <label className="input-label">Note for your driver <textarea maxLength={300} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Gate, landmark, or other helpful detail" rows={3} /></label>
        <div className="ride-payment-line"><span><Icon icon={Wallet01Icon} size={18} /> Payment</span><b>Cash to driver</b><small>In-app payments are not available yet.</small></div>
        <button className="button primary full" disabled={busy}>{busy ? 'Sending request…' : 'Request this ride'} <Icon icon={ArrowRight01Icon} /></button>
        <div className="fine-print"><Icon icon={Shield01Icon} size={16} /> Your request and trip updates are saved to your account.</div>
      </form>
      <aside className="ride-aside">
        <div className="map-live"><MapContainer center={pickupPoint ?? defaultCenter} zoom={pickupPoint ? 14 : 6} scrollWheelZoom={false}><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FocusPoint point={pickupPoint}/><MapClick onPick={setMapPoint}/>{pickupPoint && <Marker position={pickupPoint} icon={pinIcon}/ >}{destinationPoint && <Marker position={destinationPoint} icon={pinIcon}/ >}{chosenPoints.length === 2 && <Polyline positions={chosenPoints} color="#ba9655"/>}</MapContainer><span className="map-caption">{pickupPoint ? destinationPoint ? 'ROUTE PREVIEW' : 'TAP TO SET DESTINATION' : 'TAP TO SET PICKUP, THEN DESTINATION'}</span></div>
        <div className="fare-card"><span className="fare-icon"><Icon icon={Wallet01Icon} /></span><div><small>{distanceKm === null ? 'Starting fare estimate' : `About ${distanceKm.toFixed(1)} km straight-line`}</small><b>₦{estimatedFare.toLocaleString()}</b></div><p>Indicative estimate only. Actual road distance, traffic, and driver confirmation can change the fare.</p></div>
        <div className="service-note"><b>Trip updates</b><span>Requests are saved securely. Driver availability and arrival updates depend on your local driver network.</span></div>
      </aside>
    </div>
    {user && <section className="ride-history"><div className="section-head"><div><span className="eyebrow">YOUR JOURNEYS</span><h2>Recent rides</h2></div><button className="text-action" type="button" onClick={loadRides}>Refresh</button></div>
      {loadingRides && rides.length === 0 ? <p className="history-message">Loading your rides…</p> : rides.length === 0 ? <p className="history-message">Your ride requests will appear here.</p> : <div className="ride-history-list">{rides.map((ride) => <article className="ride-history-card" key={ride.id}><div className="ride-history-top"><span className={`ride-status status-${ride.status}`}>{formatStatus(ride.status)}</span><b>{formatFare(ride.estimated_fare_ngn_kobo)}</b></div><p><span>{ride.pickup_label}</span><i aria-hidden="true" /><span>{ride.destination_label}</span></p><small>{ride.service_level ?? 'Ride'} · {ride.passenger_count} {ride.passenger_count === 1 ? 'passenger' : 'passengers'} · {new Date(ride.scheduled_for ?? ride.created_at).toLocaleString()}</small>{['requested','matching'].includes(ride.status) && <button className="ride-cancel" type="button" onClick={() => cancelRide(ride.id)} disabled={cancelling === ride.id}>{cancelling === ride.id ? 'Cancelling…' : 'Cancel request'}</button>}</article>)}</div>}
    </section>}
  </motion.div>;
}

function HomesPage({ showToast }) {
  const [query, setQuery] = useState(''); const [state, setState] = useState(''); const [homes, setHomes] = useState([]); const [states, setStates] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!isConfigured) { setLoading(false); return; }
      const [{ data, error }, { data: stateRows }] = await Promise.all([supabase.from('properties').select('id,title,description,category,transaction_type,price_ngn_kobo,state_code,address,property_images(object_path,sort_order)').eq('status','published').order('created_at',{ascending:false}).limit(30), supabase.from('nigerian_states').select('code,name').order('name')]);
      if (!active) return;
      if (error) showToast('We could not load homes right now. Please try again shortly.');
      const withImages = await Promise.all((data ?? []).map(async (home) => { const firstImage = [...(home.property_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]; if (!firstImage) return home; const { data: signed } = await supabase.storage.from('property-images').createSignedUrl(firstImage.object_path, 3600); return { ...home, imageUrl: signed?.signedUrl }; }));
      setHomes(withImages); setStates(stateRows ?? []); setLoading(false);
    }
    load(); return () => { active = false; };
  }, []);
  const stateNames = useMemo(() => Object.fromEntries(states.map(({ code, name }) => [code, name])), [states]);
  const filtered = useMemo(() => homes.filter((home) => `${home.title} ${home.address} ${stateNames[home.state_code] ?? home.state_code}`.toLowerCase().includes(query.toLowerCase()) && (!state || home.state_code === state)), [homes, query, state, stateNames]);
  return <motion.div className="page subpage" {...pageMotion}><div className="subpage-intro"><span className="eyebrow">FIND SOMEWHERE TO BELONG</span><h1>A place that feels like yours.</h1><p>Browse verified listings and discover your next chapter.</p></div><div className="search-panel"><label className="field"><Icon icon={Search01Icon} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by neighbourhood, address or state" /></label><select value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option>{states.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select><button className="button primary" type="button"><Icon icon={Search01Icon} /> Search</button></div>{loading ? <div className="empty-state">Finding available homes…</div> : filtered.length ? <div className="home-grid">{filtered.map((home, index) => <motion.article className="home-card" key={home.id} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .055 }}><div className={`home-image image-${index % 3}`}>{home.imageUrl && <img src={home.imageUrl} alt={home.title} /> }<span>{home.transaction_type}</span>{!home.imageUrl && <Icon icon={Home01Icon} size={36} />}</div><div className="home-details"><small><Icon icon={Location01Icon} size={14} /> {home.address}, {stateNames[home.state_code] ?? home.state_code}</small><h3>{home.title}</h3><p>{home.category}</p><b>₦{Math.round(home.price_ngn_kobo / 100).toLocaleString()} <small>{home.transaction_type === 'rent' ? '/ year' : ''}</small></b></div></motion.article>)}</div> : <div className="empty-state"><Icon icon={Home01Icon} size={32} /><h2>{isConfigured ? 'No listed homes yet' : 'Connect Supabase to explore homes'}</h2><p>{isConfigured ? 'Check back soon as new listings are added.' : 'The property catalogue will appear here once the app is configured.'}</p></div>}</motion.div>;
}

function AuthPage({ showToast, navigate, user }) {
  const [mode, setMode] = useState('signin'); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) navigate('account'); }, [user]);
  async function submit(event) {
    event.preventDefault();
    if (!isConfigured) return showToast('Account service is not configured yet.');
    setBusy(true);
    const result = mode === 'signin' ? await supabase.auth.signInWithPassword({email,password}) : await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});
    setBusy(false);
    showToast(result.error ? result.error.message : mode === 'signin' ? 'You are signed in.' : 'Check your email to confirm your account.');
  }
  async function google() { if (!isConfigured) return showToast('Account service is not configured yet.'); const { error } = await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}}); if(error) showToast(error.message); }
  return <motion.div className="page subpage auth-page" {...pageMotion}><form className="panel auth-panel" onSubmit={submit}><span className="auth-mark"><Icon icon={Shield01Icon} size={30} /></span><span className="eyebrow">WELCOME TO MOVARA</span><h1>{mode === 'signin' ? 'Good to see you.' : 'Let’s get you started.'}</h1><p>Sign in to keep your journeys and home search together.</p><div className="auth-tabs"><button type="button" className={mode === 'signin' ? 'selected' : ''} onClick={() => setMode('signin')}>Sign in</button><button type="button" className={mode === 'signup' ? 'selected' : ''} onClick={() => setMode('signup')}>Create account</button></div>{mode === 'signup' && <label className="input-label">Full name<input value={name} onChange={(e)=>setName(e.target.value)} required placeholder="Your name" /></label>}<label className="input-label">Email address<input type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} required placeholder="you@example.com" /></label><label className="input-label">Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(e)=>setPassword(e.target.value)} required placeholder="At least 8 characters" /></label><button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <Icon icon={ArrowRight01Icon} /></button><div className="or"><span /> or <span /></div><button type="button" className="button google full" onClick={google}>G <span>Continue with Google</span></button><small className="auth-foot">By continuing, you agree to use MoVara with care and respect.</small></form></motion.div>;
}

function AccountPage({ user, navigate, showToast }) {
  if (!user) return <AuthPage user={user} showToast={showToast} navigate={navigate} />;
  return <motion.div className="page subpage account-page" {...pageMotion}><span className="eyebrow">YOUR SPACE</span><h1>Welcome back.</h1><p>{user.email}</p><div className="account-grid"><div className="account-tile"><Icon icon={Car01Icon} /><h3>Your rides</h3><p>Ride history and updates from your trips.</p><button className="text-action" onClick={()=>navigate('rides')}>Book a ride <Icon icon={ArrowRight01Icon}/></button></div><div className="account-tile"><Icon icon={Home01Icon}/><h3>Saved homes</h3><p>Keep the places you love close by.</p><button className="text-action" onClick={()=>navigate('homes')}>Explore homes <Icon icon={ArrowRight01Icon}/></button></div></div><button className="button ghost" onClick={async()=>{await supabase.auth.signOut();showToast('You have signed out.');navigate('home');}}>Sign out</button></motion.div>;
}

function JoinPage({ kind, showToast, navigate }) {
  return <motion.div className="page subpage join-page" {...pageMotion}><span className="eyebrow">GROW WITH MOVARA</span><h1>{kind === 'driver' ? 'Drive on your terms.' : 'Bring your property to more people.'}</h1><p>{kind === 'driver' ? 'Create an account to get started with your driver profile.' : 'Create an account to list a home and manage enquiries.'}</p><div className="join-panel"><Icon icon={kind === 'driver' ? Car01Icon : Building03Icon} size={30} /><h2>Start with a MoVara account</h2><p>We’ll guide you through the details and documents needed for your role.</p><button className="button primary" onClick={()=>navigate('auth')}>Create your account <Icon icon={ArrowRight01Icon}/></button></div></motion.div>;
}
