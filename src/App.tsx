import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Auth pages
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AuthCallbackPage } from './pages/auth/AuthCallbackPage';

// App pages
import { HomePage } from './pages/app/HomePage';
import { FriendsPage } from './pages/app/FriendsPage';
import { GroupsPage } from './pages/app/GroupsPage';
import { ActivityPage } from './pages/app/ActivityPage';
import { ProfilePage } from './pages/app/ProfilePage';
import { GroupDetailPage } from './pages/app/GroupDetailPage';
import { ExpenseDetailPage } from './pages/app/ExpenseDetailPage';
import { AddExpensePage } from './pages/app/AddExpensePage';
import { EditExpensePage } from './pages/app/EditExpensePage';
import { FriendDetailPage } from './pages/app/FriendDetailPage';
import { SettlementsPage } from './pages/app/SettlementsPage';
import { NotificationsPage } from './pages/app/NotificationsPage';
import { SearchPage } from './pages/app/SearchPage';
import { InvitePage } from './pages/app/InvitePage';
import { CreateGroupPage } from './pages/app/CreateGroupPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { PrivacyPage, SupportPage, TermsPage } from './pages/legal/LegalPages';

export default function App() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!session) {
    return (
      <ErrorBoundary>
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
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AppShell>
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
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </ErrorBoundary>
  );
}
