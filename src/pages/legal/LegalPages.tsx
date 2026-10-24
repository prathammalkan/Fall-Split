import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function LegalLinks() {
  return (
    <nav
      aria-label="Legal and support"
      className="text-muted flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs"
    >
      <Link className="hover:text-primary underline-offset-4 hover:underline" to="/privacy">
        Privacy
      </Link>
      <Link className="hover:text-primary underline-offset-4 hover:underline" to="/terms">
        Terms
      </Link>
      <Link className="hover:text-primary underline-offset-4 hover:underline" to="/support">
        Support
      </Link>
    </nav>
  );
}

function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  const { session } = useAuth();
  const homePath = session ? '/' : '/login';

  return (
    <main className="bg-app text-primary min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <Link className="text-muted text-sm underline-offset-4 hover:underline" to={homePath}>
            ← Fall Split
          </Link>
          <h1 className="mt-5 text-3xl font-bold">{title}</h1>
          <p className="text-muted mt-2 text-sm">
            Private-use expense-sharing application for personal use among friends.
          </p>
        </header>
        <article className="text-secondary [&_h2]:text-primary space-y-7 text-sm leading-7 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </article>
        <footer className="border-subtle mt-10 border-t pt-5">
          <LegalLinks />
          <p className="text-muted mt-4 text-center text-xs">
            <Link className="underline-offset-4 hover:underline" to={homePath}>
              {session ? 'Back to Fall Split' : 'Sign in'}
            </Link>
          </p>
        </footer>
      </div>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy">
      <section>
        <h2>Project purpose and scope</h2>
        <p>
          Fall Split is a private, non-commercial expense-sharing application created and maintained
          for personal use among friends. It is not offered as a commercial service.
        </p>
      </section>
      <section>
        <h2>Information handled</h2>
        <p>
          To provide shared-expense features, Fall Split processes account identifiers and email
          addresses; profile information such as display name, username, biography, avatar URL, and
          an optional UPI ID; friendship requests and invitations; group membership; expense
          descriptions, dates, amounts, payers, shares, item allocations, and history; settlement
          proposals and their status; and related notifications and activity records. Only share
          information that you are permitted to share with participants in your groups or expenses.
        </p>
      </section>
      <section>
        <h2>How information is used and shared</h2>
        <p>
          Information is used to authenticate accounts, display profiles and friendships, calculate
          and reconcile shared balances, record expense approvals and settlement confirmations,
          deliver in-app notifications, and synchronize queued operations. Participants in a shared
          group, expense, or settlement can view the details necessary for that feature. A
          settlement recipient may view the UPI ID provided for peer-to-peer settlement. UPI links
          launch external payment apps; Fall Split does not process or verify bank transfers.
        </p>
      </section>
      <section>
        <h2>Hosting and infrastructure</h2>
        <p>
          The application uses Supabase for authentication, database storage, and backend functions,
          and Vercel for web hosting. Google Fonts may be requested by the browser to render
          typography. Payment applications opened through UPI links operate under their own
          independent terms and policies.
        </p>
      </section>
      <section>
        <h2>Browser storage and offline use</h2>
        <p>
          Supabase authentication stores session credentials in browser local storage. Short-lived
          redirect destinations are kept in session storage. Offline expense submissions are cached
          in IndexedDB until synchronized or dismissed. Local queues are scoped to the authenticated
          user and cleared upon account deletion. The service worker precaches application assets
          for fast offline loads but does not cache private user ledger API responses.
        </p>
      </section>
      <section>
        <h2>Retention and account deletion</h2>
        <p>
          Account deletion is available directly in Profile settings. Deleting an account removes
          the personal profile and authentication identity while retaining anonymized ledger records
          so historical balances for other participants remain mathematically sound.
        </p>
      </section>
      <section>
        <h2>Contact and choices</h2>
        <p>
          As a private application, support and inquiries are handled directly by the developer. You
          can update your profile or delete your account at any time in Profile settings.
        </p>
      </section>
    </LegalDocument>
  );
}

export function TermsPage() {
  return (
    <LegalDocument title="Terms & Conditions">
      <section>
        <h2>Private application notice</h2>
        <p>
          Fall Split is a private, personal project intended for shared bill tracking among friends.
          By using the application, participants agree to record shared expenses honestly and
          resolve any personal settlement disagreements directly among themselves.
        </p>
      </section>
      <section>
        <h2>User responsibilities</h2>
        <ul>
          <li>Provide accurate account information and safeguard your sign-in credentials.</li>
          <li>Enter shared expenses, amounts, and participants honestly.</li>
          <li>
            Review split allocations and approval statuses before considering a balance settled.
          </li>
          <li>
            Use the application constructively and respect the privacy of fellow participants.
          </li>
        </ul>
      </section>
      <section>
        <h2>Calculations and payments</h2>
        <p>
          Fall Split is a calculation and ledger-keeping utility. It is not a bank, escrow service,
          money transmitter, or payment processor. All monetary transfers happen directly between
          participants outside the app. An in-app settlement confirms that the recipient
          acknowledges receipt; it is not a verification of funds by Fall Split.
        </p>
      </section>
      <section>
        <h2>Availability</h2>
        <p>
          As a private project, the service is provided on an as-available basis for friends.
          Offline queues remain local to your device until connected. Participants should maintain
          their own external records where needed.
        </p>
      </section>
    </LegalDocument>
  );
}

export function SupportPage() {
  return (
    <LegalDocument title="Contact & Support">
      <section>
        <h2>Private application support</h2>
        <p>
          Fall Split is operated privately for personal use among friends. For questions, bug
          reports, or feedback, reach out directly to the application developer (Pratham Malkan).
        </p>
      </section>
      <section>
        <h2>Account deletion and data management</h2>
        <p>
          To delete your account and profile data, navigate to{' '}
          <strong>Profile → Delete account</strong>. This will permanently remove your login
          credentials, personal profile details, and clear local offline queues, while preserving
          anonymized balance history for other participants.
        </p>
      </section>
    </LegalDocument>
  );
}
