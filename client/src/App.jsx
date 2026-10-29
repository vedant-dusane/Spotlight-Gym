import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { Spinner } from './ui.jsx';
import AdminClasses from './pages/AdminClasses.jsx';
import AdminMembers from './pages/AdminMembers.jsx';
import AdminPlans from './pages/AdminPlans.jsx';
import Alerts from './pages/Alerts.jsx';
import Login from './pages/Login.jsx';
import Membership from './pages/Membership.jsx';
import MyBookings from './pages/MyBookings.jsx';
import Reports from './pages/Reports.jsx';
import Schedule from './pages/Schedule.jsx';
import TrainerClasses from './pages/TrainerClasses.jsx';

const NAV = {
  member: [['/schedule', 'Classes'], ['/bookings', 'My bookings'], ['/membership', 'Membership'], ['/alerts', 'Alerts']],
  trainer: [['/trainer', 'My classes'], ['/alerts', 'Alerts']],
  admin: [['/admin/classes', 'Schedule'], ['/admin/members', 'Members'], ['/admin/plans', 'Plans'], ['/admin/reports', 'Reports']],
};
const HOME = { member: '/schedule', trainer: '/trainer', admin: '/admin/classes' };

function Layout() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (user.role === 'admin') return undefined;
    const load = () => api.get('/notifications/me').then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [user.role]);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">Spotlight<span>Gym</span></div>
        <div className="who">
          <span className="who-name">{user.name} <small>({user.role})</small></span>
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>
      <nav className="nav" aria-label="Main">
        {NAV[user.role].map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            {label}{to === '/alerts' && unread > 0 ? <b className="pip">{unread}</b> : null}
          </NavLink>
        ))}
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  );
}

function Protected({ roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <Layout />;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route element={<Protected roles={['member']} />}>
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/bookings" element={<MyBookings />} />
        <Route path="/membership" element={<Membership />} />
        <Route path="/alerts" element={<Alerts />} />
      </Route>
      <Route element={<Protected roles={['trainer']} />}>
        <Route path="/trainer" element={<TrainerClasses />} />
      </Route>
      <Route element={<Protected roles={['admin']} />}>
        <Route path="/admin/classes" element={<AdminClasses />} />
        <Route path="/admin/members" element={<AdminMembers />} />
        <Route path="/admin/plans" element={<AdminPlans />} />
        <Route path="/admin/reports" element={<Reports />} />
      </Route>
      <Route path="*" element={loading ? null : <Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
