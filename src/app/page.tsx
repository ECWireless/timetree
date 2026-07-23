import { SignInButton } from "@/components/auth-buttons";
import { BrandMark } from "@/components/brand-mark";
import { DashboardShell } from "@/components/dashboard-shell";
import { AuthorizationError } from "@/lib/auth/policy";
import { getDashboardData } from "@/lib/server/dashboard";
import { getNodeEntries } from "@/lib/server/time-entries";
import type { TimeEntryPage } from "@/lib/time-entries/contracts";
import { resolveDashboardPeriodSearchParams } from "@/lib/time-entries/period";

type HomeProps = {
  searchParams: Promise<{
    day?: string | string[];
    error?: string | string[];
    month?: string | string[];
    node?: string | string[];
    period?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const node = typeof params.node === "string" ? params.node : undefined;
  const periodUrl = resolveDashboardPeriodSearchParams(params);
  let dashboard: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let authorizationFailure: AuthorizationError | null = null;

  try {
    dashboard = await getDashboardData(periodUrl.period);
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
        initialNowMilliseconds={dashboard.readAtMilliseconds}
        initialEntryPage={initialEntryPage}
        activeTimers={dashboard.activeTimers}
        nodes={dashboard.nodes}
        orderedNodes={dashboard.orderedNodes}
        period={periodUrl.period}
        periodRequiresCanonicalization={periodUrl.requiresCanonicalization}
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
