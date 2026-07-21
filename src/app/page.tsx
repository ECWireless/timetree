import { BrandMark } from "@/components/brand-mark";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { AuthorizationError } from "@/lib/auth/policy";
import { getEmptyDashboard } from "@/lib/server/dashboard";

type HomeProps = {
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  const { error } = await searchParams;
  let dashboard: Awaited<ReturnType<typeof getEmptyDashboard>> | null = null;
  let authorizationFailure: AuthorizationError | null = null;

  try {
    dashboard = await getEmptyDashboard();
  } catch (caught) {
    if (!(caught instanceof AuthorizationError)) {
      throw caught;
    }

    authorizationFailure = caught;
  }

  if (dashboard) {
    return (
      <main className="dashboard-empty" aria-labelledby="page-title" data-testid="dashboard-page">
        <header className="dashboard-empty__header">
          <div className="wordmark wordmark--compact" aria-label="TimeTree">
            <BrandMark />
            <span>TimeTree</span>
          </div>
          <SignOutButton />
        </header>

        <section className="dashboard-empty__content">
          <p className="eyebrow">Private work ledger</p>
          <h1 id="page-title">Your workspace is ready.</h1>
          <p>
            Start with a root node. Your projects, tasks, and time will grow from there in the next
            step.
          </p>
          <p className="signed-in-as">Signed in as {dashboard.user.email}</p>
        </section>
      </main>
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
