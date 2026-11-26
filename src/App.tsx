import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { PrivacyPage, SupportPage, TermsPage } from './pages/legal/LegalPages';

// Lazy-loaded Auth pages
const LoginPage = lazy(() =>
  import('./pages/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const RegisterPage = lazy(() =>
  import('./pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);
const VerifyEmailPage = lazy(() =>
  import('./pages/auth/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const AuthCallbackPage = lazy(() =>
  import('./pages/auth/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage }))
);

// Lazy-loaded App pages (primary tabs preloaded on idle when authenticated)
const loadHomePage = () => import('./pages/app/HomePage');
const loadFriendsPage = () => import('./pages/app/FriendsPage');
const loadGroupsPage = () => import('./pages/app/GroupsPage');
const loadActivityPage = () => import('./pages/app/ActivityPage');
const loadProfilePage = () => import('./pages/app/ProfilePage');

const HomePage = lazy(() => loadHomePage().then((m) => ({ default: m.HomePage })));
const FriendsPage = lazy(() => loadFriendsPage().then((m) => ({ default: m.FriendsPage })));
const GroupsPage = lazy(() => loadGroupsPage().then((m) => ({ default: m.GroupsPage })));
const ActivityPage = lazy(() => loadActivityPage().then((m) => ({ default: m.ActivityPage })));
const ProfilePage = lazy(() => loadProfilePage().then((m) => ({ default: m.ProfilePage })));

const GroupDetailPage = lazy(() =>
  import('./pages/app/GroupDetailPage').then((m) => ({ default: m.GroupDetailPage }))
);
const ExpenseDetailPage = lazy(() =>
  import('./pages/app/ExpenseDetailPage').then((m) => ({ default: m.ExpenseDetailPage }))
);
const AddExpensePage = lazy(() =>
  import('./pages/app/AddExpensePage').then((m) => ({ default: m.AddExpensePage }))
);
const EditExpensePage = lazy(() =>
  import('./pages/app/EditExpensePage').then((m) => ({ default: m.EditExpensePage }))
);
const FriendDetailPage = lazy(() =>
  import('./pages/app/FriendDetailPage').then((m) => ({ default: m.FriendDetailPage }))
);
const SettlementsPage = lazy(() =>
  import('./pages/app/SettlementsPage').then((m) => ({ default: m.SettlementsPage }))
);
const NotificationsPage = lazy(() =>
  import('./pages/app/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))
);
const SearchPage = lazy(() =>
  import('./pages/app/SearchPage').then((m) => ({ default: m.SearchPage }))
);
const InvitePage = lazy(() =>
  import('./pages/app/InvitePage').then((m) => ({ default: m.InvitePage }))
);
const CreateGroupPage = lazy(() =>
  import('./pages/app/CreateGroupPage').then((m) => ({ default: m.CreateGroupPage }))
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

export default function App() {
  const { session, loading } = useAuth();
  const [introDone, setIntroDone] = useState(() => {
    if (import.meta.env.MODE === 'test') return true;
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/auth/') ||
        window.location.pathname === '/reset-password' ||
        window.location.pathname === '/verify-email')
    ) {
      return true;
    }
    try {
      return sessionStorage.getItem('fs_intro_shown') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (introDone) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const timer = setTimeout(
      () => {
        try {
          sessionStorage.setItem('fs_intro_shown', '1');
        } catch {
          // Ignore storage unavailability
        }
        setIntroDone(true);
      },
      prefersReducedMotion ? 0 : 800
    );
    return () => clearTimeout(timer);
  }, [introDone]);

  // Preload primary tab chunks on idle once authenticated so tab navigation is instant
  useEffect(() => {
    if (!session || import.meta.env.MODE === 'test') return;
    const preload = () => {
      void loadHomePage();
      void loadFriendsPage();
      void loadGroupsPage();
      void loadActivityPage();
      void loadProfilePage();
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
          cancelIdleCallback: (id: number) => void;
        }
      ).requestIdleCallback(preload, { timeout: 2000 });
      return () =>
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 300);
    return () => clearTimeout(timer);
  }, [session]);

  if (loading || !introDone) return <LoadingScreen />;

  if (!session) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LoadingScreen variant="inline" />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AppShell>
        <Suspense fallback={<LoadingScreen variant="inline" />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/friends/:userId" element={<FriendDetailPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/groups/new" element={<CreateGroupPage />} />
            <Route path="/groups/:groupId" element={<GroupDetailPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/expenses/new" element={<AddExpensePage />} />
            <Route path="/expenses/:expenseId" element={<ExpenseDetailPage />} />
            <Route path="/expenses/:expenseId/edit" element={<EditExpensePage />} />
            <Route path="/settlements" element={<SettlementsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </ErrorBoundary>
  );
}
