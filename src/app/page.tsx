import { BrandMark } from "@/components/brand-mark";

export default function Home() {
  return (
    <main className="landing" aria-labelledby="page-title" data-testid="timetree-page">
      <div className="landing__content">
        <div className="wordmark" aria-label="TimeTree">
          <BrandMark />
          <span>TimeTree</span>
        </div>

        <h1 id="page-title">Time, organized your way.</h1>
        <p>A private work ledger shaped around the way your work grows.</p>
      </div>
    </main>
  );
}
