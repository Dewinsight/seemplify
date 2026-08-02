import Link from "next/link";
import { Mic2, ShieldCheck, Wallet } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.13),transparent_34%),linear-gradient(135deg,#f8fafc_0%,#eef6ff_54%,#f6f7fb_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
              <Mic2 className="h-4 w-4" />
              Standalone AI Interview Platform
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
              Voice-led AI interviews with recruiter controls, wallet billing, and admin governance.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              Create structured AI interviews, send secure candidate links through Brevo, proctor candidate sessions, and review ranked transcripts from a dedicated app.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white shadow-lg">
                Recruiter login
              </Link>
              <Link href="/signup" className="inline-flex h-12 items-center justify-center rounded-2xl border bg-white px-6 text-sm font-semibold text-slate-900 shadow-sm">
                Create recruiter account
              </Link>
              <Link href="/admin/login" className="inline-flex h-12 items-center justify-center rounded-2xl border bg-white px-6 text-sm font-semibold text-blue-700 shadow-sm">
                Admin login
              </Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl">
            <div className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Platform state</span>
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="mt-6 text-3xl font-bold">Production-shaped</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Separate recruiter and admin authentication. Public candidate links remain token-based and do not expose admin tools.
              </p>
            </div>
            <div className="mt-4 grid gap-3">
              {[
                ["Mongo database", "Uses ai_recruiter instead of the recruiter app database."],
                ["Wallet billing", "$1.50 debited per candidate interview."],
                ["Brevo invites", "Candidate links are sent through transactional email."]
              ].map(([title, body]) => (
                <div key={title} className="rounded-2xl border bg-slate-50 p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <Wallet className="h-4 w-4 text-blue-600" />
                    {title}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
