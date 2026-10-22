import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const effectiveDate = '[[EFFECTIVE_DATE]]';

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
          <p className="text-muted mt-2 text-sm">Effective date: {effectiveDate}</p>
          <p className="mt-4 rounded-lg border border-[rgb(var(--color-pending)/0.3)] bg-[rgb(var(--color-pending)/0.08)] p-3 text-sm">
            Draft for review. Replace every bracketed placeholder and obtain qualified legal review
            before release.
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
        <h2>Who operates Fall Split</h2>
        <p>
          Fall Split is operated by [[LEGAL_ENTITY_NAME]], with its contact details at
          [[BUSINESS_ADDRESS_OR_SERVICE_ADDRESS]]. These details are required before publication.
        </p>
      </section>
      <section>
        <h2>Information handled</h2>
        <p>
          To provide shared-expense features, Fall Split processes account identifiers and email
          addresses; profile information such as display name, username, biography, avatar URL, and
          an optional UPI ID; friendship requests and invitations; group membership; expense
          descriptions, dates, amounts, payers, shares, item allocations, and history; settlement
          proposals and their status; and related notifications and activity records. Do not enter
          information about another person unless you have a lawful basis to share it with the
          people who use the relevant group or expense.
        </p>
      </section>
      <section>
        <h2>How information is used and shared</h2>
        <p>
          Information is used to authenticate accounts, show profiles and relationships, calculate
          and display shared balances, record expenses and settlement decisions, deliver invitations
          and notifications, synchronize queued expenses, prevent duplicate submissions, and protect
          the service. People in a friendship, group, expense, or settlement may see information
          needed for that feature. A settlement recipient can receive the UPI ID supplied for that
          purpose. A UPI link opens an external payment application; Fall Split does not receive or
          verify the resulting transfer.
        </p>
      </section>
      <section>
        <h2>Service providers and transfers</h2>
        <p>
          The application uses Supabase for authentication, database access, and server functions,
          and Vercel for web hosting. Google and Apple sign-in are implemented as optional Supabase
          OAuth providers; whether they are enabled and which data each provider receives depends on
          the deployment settings and has not been verified for the production project. Google Fonts
          may be requested to render fonts. Payment applications opened through UPI links have their
          own privacy terms. The Supabase project region and any resulting cross-border processing
          must be confirmed by the operator before release:
          [[SUPABASE_REGION_AND_TRANSFER_DETAILS]].
        </p>
      </section>
      <section>
        <h2>Browser storage and offline use</h2>
        <p>
          Supabase authentication stores session data in browser local storage. A short-lived
          post-login redirect is stored in session storage. Expense submissions made offline are
          kept in IndexedDB with their submission data until synchronization or removal. Ordinary
          sign-out retains pending entries to avoid data loss; synchronization is restricted to the
          signed-in owner, and account deletion requests removal of that user's local queue. Anyone
          with access to the same unlocked browser profile or device may be able to access its local
          storage. The service worker precaches application files and icons, uses the application
          shell for navigation fallback, and runtime-caches Google Fonts; it is not configured to
          runtime-cache private Supabase API responses. The application source does not set
          advertising or analytics cookies; hosting and authentication providers may process
          essential request or session data under their own configurations.
        </p>
      </section>
      <section>
        <h2>Retention and account deletion</h2>
        <p>
          The account settings screen provides account deletion. The intended flow removes the
          sign-in identity and personal profile details, clears that account's pending offline
          entries, and retains shared financial records with anonymized attribution so other
          participants' records and balances remain understandable. This behavior depends on
          database changes and an account-deletion server function that have not yet been
          runtime-validated or verified as deployed. Provider backups and retention schedules must
          be confirmed by the operator before release.
        </p>
      </section>
      <section>
        <h2>Security, analytics, and your choices</h2>
        <p>
          The project uses Supabase row-level policies and server-side functions, HTTPS hosting,
          browser security headers, and owner-scoped offline synchronization. These controls reduce
          risk but do not guarantee security; database policies and deletion behavior still require
          isolated runtime verification. No analytics, advertising, or crash-reporting SDK was found
          in the application source inspected for this draft. Depending on your location, you may
          have rights to access, correct, export, or delete personal information or object to
          certain processing. Contact [[SUPPORT_EMAIL]] to make a request or report a concern. The
          operator must confirm applicable rights and response procedures before release.
        </p>
      </section>
    </LegalDocument>
  );
}

export function TermsPage() {
  return (
    <LegalDocument title="Terms & Conditions">
      <section>
        <h2>Operator and acceptance</h2>
        <p>
          Fall Split is operated by [[LEGAL_ENTITY_NAME]] (“Fall Split”, “we”, or “us”). These draft
          terms require review and completion of the operator and governing-law details before
          publication. By using the service after the final terms are published, you agree to those
          terms.
        </p>
      </section>
      <section>
        <h2>Your account and responsibilities</h2>
        <ul>
          <li>
            Provide accurate account details, protect your sign-in credentials, and promptly report
            suspected unauthorized access.
          </li>
          <li>
            Enter expenses and participant information honestly, and share only information you are
            permitted to share.
          </li>
          <li>
            Use the service lawfully and do not harass, impersonate, defraud, disrupt, or attempt
            unauthorized access to other users or systems.
          </li>
          <li>
            Review entries, participants, currency, and split settings before relying on a displayed
            calculation.
          </li>
        </ul>
      </section>
      <section>
        <h2>Expense calculations and payments</h2>
        <p>
          Fall Split records user-entered shared expenses and calculates shares using the selected
          split settings and rounding rules. It is a record-keeping and calculation tool, not a
          bank, payment processor, escrow service, financial adviser, or verifier of debts.
          Calculations depend on the completeness and accuracy of user input. A settlement proposal
          or a user marking a payment does not prove that money was transferred. The recipient's
          confirmation records their in-app response; it is not independent verification by Fall
          Split. UPI links and other external payment services are provided by third parties, whose
          terms, fees, availability, and payment outcomes are outside Fall Split's control.
        </p>
      </section>
      <section>
        <h2>Availability and offline synchronization</h2>
        <p>
          Service access may be interrupted, and cached screens can be out of date. Offline expenses
          remain on the device until synchronization succeeds or they are removed. Retries may be
          delayed by network, account, or server errors; review failed or conflicted entries and do
          not assume they have been recorded until the app confirms synchronization. Keep your own
          records where needed.
        </p>
      </section>
      <section>
        <h2>Suspension, termination, and retained records</h2>
        <p>
          Access may be restricted to protect users, comply with law, respond to abuse, or maintain
          the service. You may request account deletion from Profile settings. The intended deletion
          process removes your sign-in identity and personal profile information but may retain
          anonymized shared expense, settlement, and audit records so other participants' histories
          remain consistent. The exact behavior depends on database and server configuration and has
          not yet been runtime-verified.
        </p>
      </section>
      <section>
        <h2>Disputes, liability, and governing law</h2>
        <p>
          Resolve disagreements about an expense or payment directly with the people involved; Fall
          Split does not adjudicate debts or payment disputes. Any enforceable warranty, liability
          limitation, dispute procedure, governing law, and court jurisdiction must be reviewed for
          applicable law and completed by the operator: [[GOVERNING_LAW_AND_JURISDICTION]]. Do not
          publish this draft as final terms until qualified counsel reviews it.
        </p>
      </section>
      <p>Effective date: {effectiveDate}</p>
    </LegalDocument>
  );
}

export function SupportPage() {
  return (
    <LegalDocument title="Contact & Support">
      <section>
        <h2>Get help</h2>
        <p>
          Contact the Fall Split support team at <strong>[[SUPPORT_EMAIL]]</strong>. This address is
          a release placeholder and must be replaced with a monitored support contact before the app
          is published. Do not send passwords, authentication codes, or payment credentials.
        </p>
      </section>
      <section>
        <h2>Account deletion and data requests</h2>
        <p>
          To request account deletion, open Profile → Delete account and follow the confirmation
          steps. The intended process removes personal profile details and the sign-in identity,
          clears this account's queued offline expenses on the current device, and retains
          anonymized shared ledger records where required to preserve other participants' history.
          If you cannot sign in, contact [[SUPPORT_EMAIL]] from the account email address. Deletion
          requires the account-deletion server function and database retention migration to be
          deployed and verified; those deployment checks remain a release blocker.
        </p>
      </section>
      <section>
        <h2>Security reports</h2>
        <p>
          Report suspected security issues privately to [[SECURITY_CONTACT]]. The operator must
          replace this placeholder with a monitored address and publish a response process before
          release. Please do not include passwords, access tokens, or payment information in a
          report.
        </p>
      </section>
    </LegalDocument>
  );
}
