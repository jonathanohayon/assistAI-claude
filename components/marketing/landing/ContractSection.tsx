import type { ContractCopy, ContractPart } from "@/lib/marketing/home-content";

import { Reveal } from "../Reveal";
import { CodeBlock } from "./CodeBlock";
import { SectionHeader } from "./SectionHeader";

/** Technical tokens inside prose ("X-Tamara-Signature", "{ role: user | agent, text }")
 *  stay one left-to-right unit, unbroken, inside Hebrew sentences. */
const LTR_TOKEN = /\{[^}]*\}|X-Tamara-Signature|HMAC-SHA256/g;
function withLtrTokens(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LTR_TOKEN)) {
    out.push(text.slice(last, m.index));
    out.push(
      <bdi key={m.index} dir="ltr" className="whitespace-nowrap">
        {m[0]}
      </bdi>,
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function Part({ part, children }: { part: ContractPart; children?: React.ReactNode }) {
  return (
    <Reveal
      className={`grid min-w-0 grid-cols-1 gap-5 border-t border-[#e2e8f0] py-10 first:border-t-0 lg:gap-10 ${
        part.code ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : ""
      }`}
    >
      <div className="min-w-0 max-w-2xl">
        <h3 className="font-display text-2xl tracking-tight text-[#18181b] sm:text-3xl">{part.title}</h3>
        <p className="mt-3 text-base leading-relaxed text-[#475569]">{withLtrTokens(part.body)}</p>
        {children}
      </div>
      {part.code ? (
        <div className="min-w-0">
          <CodeBlock label={part.title} code={part.code} />
        </div>
      ) : null}
    </Reveal>
  );
}

/**
 * The /connect contract, in its own section (#contract, the hero's "Read
 * the contract" anchor): request, reply, time budget, signature.
 */
export function ContractSection(c: ContractCopy) {
  return (
    <section id="contract" aria-labelledby="contract-title" className="relative scroll-mt-20 bg-white py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeader heading={c} id="contract-title" />
        <p className="mx-auto mt-6 max-w-2xl rounded-2xl border border-[#22d3ee]/30 bg-[#ecfeff] px-5 py-3 text-center text-sm leading-relaxed text-[#0e7490]">
          {c.scope}
        </p>
        <div className="mt-10">
          <Part part={c.request}>
            <dl className="mt-5 space-y-2.5">
              {c.request.fields.map((f) => (
                <div key={f.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <dt>
                    <code dir="ltr" className="rounded-md bg-[#fdf2f8] px-1.5 py-0.5 font-mono text-[13px] text-[#be185d]">
                      {f.name}
                    </code>
                  </dt>
                  <dd className="text-sm leading-relaxed text-[#475569]">{withLtrTokens(f.body)}</dd>
                </div>
              ))}
            </dl>
          </Part>
          <Part part={c.reply} />
          <Part part={c.budget} />
          <Part part={c.signature} />
        </div>
      </div>
    </section>
  );
}
