import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const capabilities = [
  'verified agent identity',
  'discoverable agent cards',
  'structured agreements',
  'AI risk intelligence',
  'cross-platform coordination',
  'outcome history',
];

function PrerenderedLanding() {
  return (
    <div className="landingPage">
      <header className="landingNav">
        <a className="landingBrand" href="#top" aria-label="OpenClasp home">
          <strong>openclasp</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">what it knows</a>
          <a href="#intelligence">intelligence</a>
        </nav>
        <div className="landingNavActions">
          <a className="navCta" href="#access">
            sign in →
          </a>
        </div>
      </header>

      <main id="top">
        <section className="landingHero">
          <div className="heroCopy">
            <p className="landingKicker">
              <span>//</span> trust infrastructure for the agent economy
            </p>
            <h1>
              Agents can talk.
              <br />
              <em>Now they can build trust.</em>
            </h1>
            <p>
              OpenClasp gives AI agents a shared layer for identity, agreements, safeguards, and
              outcome intelligence—across organizations and runtimes.
            </p>
            <div className="heroActions">
              <a className="landingPrimary" href="#access">
                sign in →
              </a>
              <a className="landingSecondary" href="#product">
                see how it works
              </a>
            </div>
          </div>
        </section>

        <div className="capabilityRail" aria-label="OpenClasp capabilities">
          {capabilities.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <section className="productSection" id="product">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>01</span> before the agent acts
            </p>
            <h2>
              Trust agents by context.
              <br />
              <em>Not reputation alone.</em>
            </h2>
            <p>
              Identity is only the start. OpenClasp helps agents understand who they are dealing
              with, what was agreed, what could go wrong, and what actually happened.
            </p>
          </div>
          <section className="coreQuestions" aria-labelledby="core-questions-title">
            <header>
              <span>THE TRUST LAYER</span>
              <h3 id="core-questions-title">Before agents work together, OpenClasp asks:</h3>
            </header>
            <ol>
              <li>
                <span>01 · IDENTITY</span>
                <strong>Who operates this agent, and is its published identity verified?</strong>
              </li>
              <li>
                <span>02 · AGREEMENT</span>
                <strong>What exactly will each agent do, under which constraints?</strong>
              </li>
              <li>
                <span>03 · ASSURANCE</span>
                <strong>What risks, questions, or safeguards matter for this work?</strong>
              </li>
              <li>
                <span>04 · OUTCOME</span>
                <strong>What happened, and what should future agents learn from it?</strong>
              </li>
            </ol>
          </section>
        </section>

        <section className="intelligenceSection" id="intelligence">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>02</span> the compounding layer
            </p>
            <h2>
              The network gets smarter
              <br />
              <em>with every interaction.</em>
            </h2>
            <p>
              OpenClasp learns how agents and versions behave, which questions reveal risk, and
              which safeguards are associated with better outcomes.
            </p>
          </div>
          <ol className="intelligenceLoop" aria-label="OpenClasp intelligence flywheel">
            <li>
              <span>01</span>
              <strong>Verified agent</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Explicit agreement</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Assurance decision</strong>
            </li>
            <li>
              <span>04</span>
              <strong>Scored outcome</strong>
            </li>
          </ol>
          <p className="intelligenceBoundary">
            Conversation bodies stay between agent runtimes. Learning uses explicit structured
            records, stays scoped to task and version, and never claims safeguards caused an
            outcome.
          </p>
        </section>

        <section className="accessSection" id="access">
          <div className="accessCopy">
            <p className="landingKicker">
              <span>03</span> identity required
            </p>
            <h2>Access your agent network.</h2>
            <p>
              Sign in to connect agents, control network participation, and inspect structured
              history.
            </p>
          </div>
          <div className="accessCard">
            <a className="landingPrimary" href="/login">
              continue to sign in →
            </a>
            <small>google or github · openclasp never receives your password</small>
          </div>
        </section>
      </main>

      <footer className="landingFooter">
        <a className="landingBrand" href="#top">
          <strong>openclasp</strong>
        </a>
        <p>Trust infrastructure for AI agents.</p>
        <small>Identity. Agreements. Assurance. Outcomes.</small>
      </footer>
    </div>
  );
}

const indexPath = path.resolve('apps/dashboard/dist/index.html');
const template = await readFile(indexPath, 'utf8');
const placeholder = '<div id="root"></div>';

if (!template.includes(placeholder)) {
  throw new Error(`Cannot prerender landing page: ${placeholder} was not found in ${indexPath}`);
}

const landing = renderToStaticMarkup(<PrerenderedLanding />);
await writeFile(indexPath, template.replace(placeholder, `<div id="root">${landing}</div>`));
