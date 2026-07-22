import { SignInButton } from "@/components/auth-buttons";
import { BrandMark } from "@/components/brand-mark";
import { DashboardShell } from "@/components/dashboard-shell";
import { AuthorizationError } from "@/lib/auth/policy";
import { getDashboardData } from "@/lib/server/dashboard";
import { getNodeEntries } from "@/lib/server/time-entries";
import type { TimeEntryPage } from "@/lib/time-entries/contracts";

type HomeProps = {
  searchParams: Promise<{ error?: string; node?: string }>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  const { error, node } = await searchParams;
  let dashboard: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let authorizationFailure: AuthorizationError | null = null;

  try {
    dashboard = await getDashboardData();
  } catch (caught) {
    if (!(caught instanceof AuthorizationError)) {
      throw caught;
    }

    authorizationFailure = caught;
  }

  if (dashboard) {
    const selectedNodeExists = Boolean(node && dashboard.nodes.some((candidate) => candidate.id === node));
    const initialEntryPage: TimeEntryPage = selectedNodeExists
      ? await getNodeEntries(node!)
      : { entries: [], nextCursor: null };
    return (
      <DashboardShell
        email={dashboard.user.email}
        initialEntryPage={initialEntryPage}
        nodes={dashboard.nodes}
        orderedNodes={dashboard.orderedNodes}
        selectedNodeId={node}
      />
    );
  }

  const accessDenied =
    Boolean(authorizationFailure && authorizationFailure.reason !== "missing-session") ||
    error === "ACCOUNT_NOT_ALLOWED" ||
    error === "account_not_allowed";
  const signInFailed = Boolean(error) && !accessDenied;

  return (
    <main className="landing" aria-labelledby="page-title" data-testid="sign-in-page">
      <div className="landing__content">
        <div className="wordmark" aria-label="TimeTree">
          <BrandMark />
          <span>TimeTree</span>
        </div>

        <p className="eyebrow">Hierarchical time tracking</p>
        <h1 id="page-title">See where your time goes.</h1>
        <p>
          {accessDenied
            ? "That Google account can’t access this TimeTree."
            : signInFailed
              ? "Google sign-in wasn’t completed. Please try again."
            : "Organize your work your way, then track time at any level."}
        </p>
        <SignInButton clearExistingSession={accessDenied} />
      </div>
    </main>
  );
}
