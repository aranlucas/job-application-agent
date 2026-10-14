import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../../components/SiteChrome";
import { attentionEnv } from "../../../lib/attention-auth";
import { buyerAttentionStep } from "../../../lib/attention-buyer-flow.mjs";
import { resolveAttentionDesignFixture } from "../../../lib/attention-design-fixtures.mjs";
import { verifyAttentionMagicLink } from "../../../lib/attention-magic-link.mjs";
import { normalizeAttentionQuestions } from "../../../lib/attention-questions.mjs";
import { getAttentionSignal } from "../../../lib/attention-signal-store";
import type { AttentionView } from "./AttentionActions";
import { BuyerFlow } from "./BuyerFlow";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const attentionId = decodeURIComponent((await params).id ?? "").trim();
  const path = attentionId ? `/attention/${encodeURIComponent(attentionId)}` : "/attention";
  return {
    title: "Your applications",
    robots: { index: false, follow: false },
    alternates: { canonical: `https://jobappagent.com${path}` },
  };
}

export default async function AttentionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; design?: string }>;
}) {
  const { id } = await params;
  const attentionId = decodeURIComponent(id ?? "").trim();
  const query = await searchParams;
  // Only the reserved design path and known keys bypass auth, with synthetic data.
  const fixture = resolveAttentionDesignFixture(query, attentionId);
  if (fixture) return <BuyerFlow key={fixture.key} view={fixture.view} initialStep={fixture.step} designFixture />;

  const token = typeof query.token === "string" ? query.token.trim() : "";
  if (!token) {
    return <AttentionError
      title="This link needs a secure token."
      body="Open the newest secure link from your JobAppAgent email."
      home
    />;
  }
  const config = attentionEnv();
  const verified = await verifyAttentionMagicLink(token, config.magicLinkSecret, { attentionId });
  if (!verified.ok) {
    const confirmedPaused = await canConfirmApplicationPaused(verified);
    return <AttentionError
      title="This link has expired"
      body={confirmedPaused
        ? "Your application is still paused and waiting for your answer. Nothing was submitted."
        : "Nothing was submitted from this link."}
      latestEmail
    />;
  }

  // No generic question fallback: only the employer's packaged questions need the buyer.
  const payload = verified.payload;
  if (!payload) {
    return <AttentionError
      title="This link has expired"
      body="Nothing was submitted from this link."
      latestEmail
    />;
  }
  const view: AttentionView = {
    attentionId,
    company: payload.company ?? "Company",
    role: payload.role ?? "Application",
    questions: normalizeAttentionQuestions(payload.questions),
    aiAssistanceDiscouraged: Boolean(payload.aiAssistanceDiscouraged),
    token,
  };
  const signal = await getAttentionSignal(attentionId);
  return <BuyerFlow view={view} initialStep={signal ? "queue" : buyerAttentionStep(view)} initialSignal={signal?.signal} />;
}

async function canConfirmApplicationPaused(verified: {
  ok: boolean;
  error?: string;
  payload?: { attentionId?: string };
}): Promise<boolean> {
  if (verified.error !== "token_expired" || !verified.payload?.attentionId) return false;
  try {
    const signal = await getAttentionSignal(verified.payload.attentionId);
    // A signed-but-expired link proves the pause existed; no buyer signal means it is still waiting.
    return !signal;
  } catch {
    return false;
  }
}

function AttentionError({
  title,
  body,
  home = false,
  latestEmail = false,
}: {
  title: string;
  body: string;
  home?: boolean;
  latestEmail?: boolean;
}) {
  return <div className="site-shell">
    <SiteHeader />
    <main className="attention-page page-width">
      <section className="attention-panel attention-error-panel">
        <h1>{title}</h1>
        <p>{body}</p>
        {latestEmail && <div className="attention-error-help" id="latest-email">
          <h2>Find the newest JobAppAgent email</h2>
          <p>This page cannot open your inbox. Use the newest message from JobAppAgent — older links stop working on purpose.</p>
          <ol>
            <li>Open the inbox where you receive JobAppAgent mail.</li>
            <li>Search for JobAppAgent and sort by newest.</li>
            <li>Open that message and use its Continue applying link.</li>
          </ol>
        </div>}
        <div className="attention-error-actions">
          {latestEmail && <Link className="button button-secondary" href="/">Go to JobAppAgent home</Link>}
          {home && <Link className="button" href="/">Back home</Link>}
        </div>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
