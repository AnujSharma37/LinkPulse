import { lazy, Suspense } from 'react';
import { BrowserRouter, Link as RLink, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import { ConfigProvider } from './config';
import { Layout } from './components/Layout';
import { Empty, Spinner, ToastProvider } from './components/ui';
import { AuthPage } from './pages/Auth';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/AccountEmail';
import { Landing } from './pages/Landing';

// Signed-in pages (and the charting library) load on demand to keep the first page fast.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Links = lazy(() => import('./pages/Links').then((m) => ({ default: m.Links })));
const NewLink = lazy(() => import('./pages/NewLink').then((m) => ({ default: m.NewLink })));
const LinkDetail = lazy(() => import('./pages/LinkDetail').then((m) => ({ default: m.LinkDetail })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Campaigns = lazy(() => import('./pages/Campaigns').then((m) => ({ default: m.Campaigns })));

export function App() {
  return (
    <BrowserRouter>
      <ConfigProvider>
        <ToastProvider>
          <AuthProvider>
            <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/signup" element={<AuthPage mode="signup" />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route element={<RequireAuth><Layout /></RequireAuth>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/links" element={<Links />} />
                <Route path="/links/new" element={<NewLink />} />
                <Route path="/links/:id" element={<LinkDetail />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/campaigns" element={<Campaigns />} />
              </Route>
              <Route path="*" element={<div className="auth-wrap"><div className="card"><Empty title="Page not found" action={<RLink className="btn" to="/">Go home</RLink>} /></div></div>} />
            </Routes>
            </Suspense>
          </AuthProvider>
        </ToastProvider>
      </ConfigProvider>
    </BrowserRouter>
  );
}
